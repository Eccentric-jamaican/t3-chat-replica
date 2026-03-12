type StreamingMessageCacheEntry = {
  content: string;
  reasoningContent: string;
  updatedAt: number;
  frozen: boolean;
};

const STREAMING_MESSAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const STREAMING_MESSAGE_CACHE_CLEANUP_THROTTLE_MS = 60 * 1000;
const streamingMessageCache = new Map<string, StreamingMessageCacheEntry>();
let lastCleanupAt = 0;

function cleanupExpiredEntries(now = Date.now()) {
  if (now - lastCleanupAt < STREAMING_MESSAGE_CACHE_CLEANUP_THROTTLE_MS) {
    return;
  }

  lastCleanupAt = now;
  for (const [messageId, entry] of streamingMessageCache.entries()) {
    if (now - entry.updatedAt > STREAMING_MESSAGE_CACHE_TTL_MS) {
      streamingMessageCache.delete(messageId);
    }
  }
}

function getOrCreateEntry(messageId: string) {
  cleanupExpiredEntries();
  const existing = streamingMessageCache.get(messageId);
  if (existing) return existing;

  const next: StreamingMessageCacheEntry = {
    content: "",
    reasoningContent: "",
    updatedAt: Date.now(),
    frozen: false,
  };
  streamingMessageCache.set(messageId, next);
  return next;
}

export function appendStreamingMessageContent(messageId: string, delta: string) {
  if (!messageId || !delta) return;
  const entry = getOrCreateEntry(messageId);
  if (entry.frozen) return;
  entry.content += delta;
  entry.updatedAt = Date.now();
}

export function appendStreamingMessageReasoning(
  messageId: string,
  delta: string,
) {
  if (!messageId || !delta) return;
  const entry = getOrCreateEntry(messageId);
  if (entry.frozen) return;
  entry.reasoningContent += delta;
  entry.updatedAt = Date.now();
}

export function freezeStreamingMessage(
  messageId: string,
  input: { content: string; reasoningContent: string },
) {
  if (!messageId) return;
  streamingMessageCache.set(messageId, {
    content: input.content,
    reasoningContent: input.reasoningContent,
    updatedAt: Date.now(),
    frozen: true,
  });
}

export function getStreamingMessageCache(messageId: string) {
  cleanupExpiredEntries();
  return streamingMessageCache.get(messageId) ?? null;
}

export function isStreamingMessageFrozen(messageId: string) {
  return streamingMessageCache.get(messageId)?.frozen === true;
}

export function clearStreamingMessageCache(messageId: string) {
  streamingMessageCache.delete(messageId);
}
