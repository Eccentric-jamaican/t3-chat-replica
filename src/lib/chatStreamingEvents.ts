export const CHAT_STREAMING_CONTENT = "chat-streaming-content";
export const CHAT_STREAMING_REASONING = "chat-streaming-reasoning";
export const CHAT_STREAMING_TOOL_CALL = "chat-streaming-tool-call";
export const CHAT_STREAMING_TOOL_INPUT_UPDATE =
  "chat-streaming-tool-input-update";
export const CHAT_STREAMING_TOOL_OUTPUT = "chat-streaming-tool-output";
export const CHAT_STREAMING_ABORT = "chat-streaming-abort";

export interface ChatStreamingContentDetail {
  messageId: string;
  content: string;
}

export interface ChatStreamingReasoningDetail {
  messageId: string;
  content: string;
}

export interface ChatStreamingToolCallDetail {
  messageId: string;
  toolCallId: string;
  toolName: string;
  args?: string;
  state?: "streaming" | "completed" | "error";
}

export interface ChatStreamingToolInputUpdateDetail {
  messageId: string;
  toolCallId: string;
  argsSnapshot?: string;
  argsDelta?: string;
}

export interface ChatStreamingToolOutputDetail {
  messageId: string;
  toolCallId: string;
  output: unknown;
}

export interface ChatStreamingAbortDetail {
  messageId: string;
}
