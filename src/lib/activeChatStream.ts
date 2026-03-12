type ActiveChatStream = {
  requestId: string | null;
  controller: AbortController | null;
  threadId: string | null;
  sessionId: string | null;
  messageId: string | null;
  streamId: string | null;
  authToken: string | null;
};

export const ACTIVE_CHAT_STREAM_EVENT = "active-chat-stream-change";

const activeChatStream: ActiveChatStream = {
  requestId: null,
  controller: null,
  threadId: null,
  sessionId: null,
  messageId: null,
  streamId: null,
  authToken: null,
};

export function getActiveChatStream() {
  return { ...activeChatStream };
}

function notifyActiveChatStreamChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVE_CHAT_STREAM_EVENT));
}

export function startActiveChatStream(input: {
  requestId: string;
  controller: AbortController;
  threadId: string;
  sessionId: string;
  authToken: string | null;
}) {
  activeChatStream.requestId = input.requestId;
  activeChatStream.controller = input.controller;
  activeChatStream.threadId = input.threadId;
  activeChatStream.sessionId = input.sessionId;
  activeChatStream.messageId = null;
  activeChatStream.streamId = null;
  activeChatStream.authToken = input.authToken;
  notifyActiveChatStreamChanged();
}

export function updateActiveChatStreamMessage(input: {
  requestId: string;
  messageId: string | null;
  streamId: string | null;
}) {
  if (activeChatStream.requestId !== input.requestId) return;
  activeChatStream.messageId = input.messageId;
  activeChatStream.streamId = input.streamId;
  notifyActiveChatStreamChanged();
}

export function clearActiveChatStream(requestId?: string) {
  if (requestId && activeChatStream.requestId !== requestId) return;

  activeChatStream.requestId = null;
  activeChatStream.controller = null;
  activeChatStream.threadId = null;
  activeChatStream.sessionId = null;
  activeChatStream.messageId = null;
  activeChatStream.streamId = null;
  activeChatStream.authToken = null;
  notifyActiveChatStreamChanged();
}
