# Chat Stream Abort Design

## Goal

When the user clicks stop during an assistant stream:

- the stream should stop immediately
- the UI should keep the last visible token
- no extra buffered tokens should continue animating in after the click
- the partially generated assistant message should remain visible after the query refresh

This behavior is intentionally modeled after `t3.chat`, which preserves partial assistant text after cancel and issues a dedicated abort request for the active stream.

## Previous Failure Mode

The old implementation had three separate problems:

- the client mostly relied on aborting the local `fetch`, which can still allow already-buffered SSE data to render
- the active stream state lived inside a single `ChatInput` instance, but the route navigates during send, so the stop button could end up in a different `ChatInput` instance than the one that started the stream
- the server marked the assistant message as `aborted` before the final partial content flush, and `internalAppendContent` refused to write to aborted messages, leaving empty assistant content in the database

The net effect was:

- stop felt delayed
- some extra visible tokens could still appear after clicking stop
- the partial assistant response could disappear from the UI entirely

## Current Design

### 1. Dedicated Abort Endpoint

The app now has a dedicated HTTP abort route:

- `POST /api/chat/abort`

It is handled by:

- [convex/http.ts](../convex/http.ts)
- [convex/chatHttp.ts](../convex/chatHttp.ts)

The client sends:

- `threadId`
- `messageId`
- `sessionId`
- `streamId`

This aborts the live HTTP stream on the server side instead of relying only on browser transport cancellation.

### 2. Shared Active Stream State

The currently active stream is tracked in:

- [src/lib/activeChatStream.ts](../src/lib/activeChatStream.ts)

This exists because the stream may start in one `ChatInput` instance and the user may click stop in another after navigation. The shared state stores:

- request id
- active `AbortController`
- thread id
- session id
- message id
- stream id
- auth token

The stop button reads from this shared state so it always targets the real live stream.

### 2.1 Send Button vs Stop Button State

There was a follow-up regression after moving abort logic into shared state:

- the real active stream lived in shared state
- but the bottom-right button still decided between send vs stop using only local `isGenerating` and `isThreadStreaming`
- after route navigation, a new `ChatInput` instance could render while the original stream was still active
- this made the UI show the send button even though the stream was live

The fix was:

- make [src/lib/activeChatStream.ts](../src/lib/activeChatStream.ts) broadcast change events
- have [src/components/chat/ChatInput.tsx](../src/components/chat/ChatInput.tsx) subscribe to those changes
- render the stop button whenever the current thread has an active shared stream, not only when local component state says it is generating
- make the bottom-right control visually flip to stop immediately when the shared active stream event says the current thread is live

The effective abort-visible condition is now:

- local generation in progress
- or backend-reported thread streaming
- or shared active stream attached to the current thread

### 3. Immediate UI Freeze

The UI now freezes the currently visible text at abort time.

Relevant files:

- [src/components/chat/ChatInput.tsx](../src/components/chat/ChatInput.tsx)
- [src/components/chat/StreamingMessage.tsx](../src/components/chat/StreamingMessage.tsx)
- [src/hooks/useSmoothStreaming.ts](../src/hooks/useSmoothStreaming.ts)
- [src/lib/streamingMessageCache.ts](../src/lib/streamingMessageCache.ts)

Flow:

- `ChatInput` dispatches a `chat-streaming-abort` event with the active `messageId`
- `StreamingMessage` captures the exact currently displayed text and reasoning
- that content is frozen in the local cache
- `useSmoothStreaming` stops animating immediately when freeze is active
- later streaming deltas are ignored once the message is frozen

This is what prevents the “extra token generation comes through after stop” effect in the UI.

### 4. Abort-Time Content Persistence

The server now allows the final abort-time partial content flush to persist even if the message is already marked aborted.

Relevant files:

- [convex/messages.ts](../convex/messages.ts)
- [convex/chatHttp.ts](../convex/chatHttp.ts)
- [convex/chat.ts](../convex/chat.ts)

`internalAppendContent` now supports an abort-safe final flush path via `allowAborted`.

This ensures the DB retains the partial assistant message instead of ending up with:

- `status: "aborted"`
- `content: ""`

## Tool Wait Abort

Queued tool waits are also abort-aware now.

Relevant files:

- [convex/lib/toolJobClient.ts](../convex/lib/toolJobClient.ts)
- [convex/chat.ts](../convex/chat.ts)
- [convex/chatHttp.ts](../convex/chatHttp.ts)

This does not hard-kill an already running worker action, but it does stop the chat stream from continuing to wait on queued tool work once the user has cancelled.

## Anonymous Session Support

The `/api/chat` HTTP path must support anonymous session-owned threads, not only authenticated users.

Relevant file:

- [convex/chatHttp.ts](../convex/chatHttp.ts)

The handler now accepts either:

- authenticated user identity
- anonymous `sessionId`

and verifies thread access before streaming.

## Known Remaining Noise

The browser can still log:

- `GET /api/auth/convex/token => 401`

for anonymous users before falling back to the session-based path.

That does not block streaming, but it is still console noise and can be cleaned up separately if desired.
