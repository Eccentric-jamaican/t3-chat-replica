import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Markdown } from "./Markdown";
import { useSmoothStreaming } from "../../hooks/useSmoothStreaming";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { SearchToolResult } from "./SearchToolResult";
import { EbayToolResult } from "./EbayToolResult";
import { ProductToolResult } from "./ProductToolResult";
import { GlobalToolResult } from "./GlobalToolResult";
import { type Product } from "../../data/mockProducts";
import { ProductGrid } from "../product/ProductGrid";
import { trackEvent } from "../../lib/analytics";
import {
  CHAT_STREAMING_ABORT,
  type ChatStreamingAbortDetail,
} from "../../lib/chatStreamingEvents";
import {
  clearStreamingMessageCache,
  freezeStreamingMessage,
  getStreamingMessageCache,
  isStreamingMessageFrozen,
} from "../../lib/streamingMessageCache";

interface StreamingMessageProps {
  messageId: string;
  content: string; // From DB (completed)
  reasoningContent?: string; // From DB
  toolCalls?: ToolCall[]; // From DB
  toolResults?: Record<string, string>; // Map of toolCallId -> result content
  products?: Product[]; // From DB
  isStreaming: boolean;
  onOpenExpanded?: (products: Product[]) => void;
}

type ToolCall = {
  id: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  type?: string;
  state?: "streaming" | "completed" | "error";
};

type StreamingContentDetail = { messageId: string; content: string };
type StreamingReasoningDetail = { messageId: string; content: string };
type StreamingToolCallDetail = {
  messageId: string;
  toolCallId: string;
  toolName: string;
  args?: string;
  state?: "streaming" | "completed" | "error";
};
type StreamingToolOutputDetail = {
  messageId: string;
  toolCallId: string;
  output: unknown;
};
type StreamingToolInputUpdateDetail = {
  messageId: string;
  toolCallId: string;
  argsSnapshot?: string;
  argsDelta?: string;
};
function pickLongest(...values: Array<string | null | undefined>) {
  return values.reduce<string>((longest, current) => {
    const next = current ?? "";
    return next.length > longest.length ? next : longest;
  }, "");
}

function isChatStreamingAbortDetail(
  value: unknown,
): value is ChatStreamingAbortDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "messageId" in value &&
    typeof value.messageId === "string"
  );
}

function isStreamingContentDetail(
  value: unknown,
): value is StreamingContentDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "messageId" in value &&
    "content" in value &&
    typeof value.messageId === "string" &&
    typeof value.content === "string"
  );
}

function isStreamingReasoningDetail(
  value: unknown,
): value is StreamingReasoningDetail {
  return isStreamingContentDetail(value);
}

function isStreamingToolCallDetail(
  value: unknown,
): value is StreamingToolCallDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "messageId" in value &&
    "toolCallId" in value &&
    "toolName" in value &&
    typeof value.messageId === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

function isStreamingToolOutputDetail(
  value: unknown,
): value is StreamingToolOutputDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "messageId" in value &&
    "toolCallId" in value &&
    typeof value.messageId === "string" &&
    typeof value.toolCallId === "string"
  );
}

function isStreamingToolInputUpdateDetail(
  value: unknown,
): value is StreamingToolInputUpdateDetail {
  return (
    !!value &&
    typeof value === "object" &&
    "messageId" in value &&
    "toolCallId" in value &&
    typeof value.messageId === "string" &&
    typeof value.toolCallId === "string"
  );
}

export const StreamingMessage = ({
  messageId,
  content,
  reasoningContent,
  toolCalls,
  toolResults = {},
  products = [],
  isStreaming,
  onOpenExpanded,
}: StreamingMessageProps) => {
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([]);
  const [streamingToolResults, setStreamingToolResults] = useState<
    Record<string, unknown>
  >({});
  const [isLocallyAborted, setIsLocallyAborted] = useState(false);
  const cachedStreamingState = getStreamingMessageCache(messageId);

  const effectiveReasoning = pickLongest(
    streamingReasoning,
    cachedStreamingState?.reasoningContent,
    reasoningContent,
  );

  const effectiveContent = pickLongest(
    streamingContent,
    cachedStreamingState?.content,
    content,
  );

  const displayedTextRef = useRef("");
  const effectiveReasoningRef = useRef(effectiveReasoning);
  effectiveReasoningRef.current = effectiveReasoning;
  const effectiveIsStreaming = isStreaming && !isLocallyAborted;

  useEffect(() => {
    if (!effectiveIsStreaming && !isLocallyAborted) {
      return;
    }

    const handleContent: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!isStreamingContentDetail(event.detail)) return;
      const detail = event.detail;
      if (
        detail.messageId === messageId &&
        !isLocallyAborted &&
        !isStreamingMessageFrozen(messageId)
      ) {
        setStreamingContent((prev) => prev + detail.content);
      }
    };

    const handleReasoning: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!isStreamingReasoningDetail(event.detail)) return;
      const detail = event.detail;
      if (
        detail.messageId === messageId &&
        !isLocallyAborted &&
        !isStreamingMessageFrozen(messageId)
      ) {
        setStreamingReasoning((prev) => prev + detail.content);
      }
    };

    const handleToolCall: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!isStreamingToolCallDetail(event.detail)) return;
      const detail = event.detail;
      if (
        detail.messageId === messageId &&
        !isLocallyAborted &&
        !isStreamingMessageFrozen(messageId)
      ) {
        const newTool = {
          id: detail.toolCallId,
          function: {
            name: detail.toolName,
            arguments: detail.args || "",
          },
          type: "function",
          state: detail.state || "streaming",
        };
        setStreamingToolCalls((prev) => {
          if (prev.find((t) => t.id === newTool.id)) return prev;
          return [...prev, newTool];
        });
      }
    };

    const handleToolOutput: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!isStreamingToolOutputDetail(event.detail)) return;
      const detail = event.detail;
      if (
        detail.messageId === messageId &&
        !isLocallyAborted &&
        !isStreamingMessageFrozen(messageId)
      ) {
        setStreamingToolResults((prev) => ({
          ...prev,
          [detail.toolCallId]: detail.output,
        }));
      }
    };

    const handleToolInputUpdate: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!isStreamingToolInputUpdateDetail(event.detail)) return;
      const detail = event.detail;
      if (
        detail.messageId === messageId &&
        !isLocallyAborted &&
        !isStreamingMessageFrozen(messageId)
      ) {
        setStreamingToolCalls((prev) => {
          return prev.map((tc) => {
            if (tc.id === detail.toolCallId) {
              return {
                ...tc,
                function: {
                  ...tc.function,
                  arguments:
                    detail.argsSnapshot ||
                    `${tc.function?.arguments || ""}${detail.argsDelta || ""}`,
                },
              };
            }
            return tc;
          });
        });
      }
    };

    const handleAbort: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      if (!isChatStreamingAbortDetail(event.detail)) return;

      const detail = event.detail;
      if (detail.messageId !== messageId) return;

      freezeStreamingMessage(messageId, {
        content: displayedTextRef.current,
        reasoningContent: effectiveReasoningRef.current,
      });
      setStreamingContent(displayedTextRef.current);
      setStreamingReasoning(effectiveReasoningRef.current ?? "");
      setIsLocallyAborted(true);
    };

    window.addEventListener("chat-streaming-content", handleContent);
    window.addEventListener("chat-streaming-reasoning", handleReasoning);
    window.addEventListener("chat-streaming-tool-call", handleToolCall);
    window.addEventListener("chat-streaming-tool-input-update", handleToolInputUpdate);
    window.addEventListener("chat-streaming-tool-output", handleToolOutput);
    window.addEventListener(
      CHAT_STREAMING_ABORT,
      handleAbort,
    );

    return () => {
      window.removeEventListener("chat-streaming-content", handleContent);
      window.removeEventListener("chat-streaming-reasoning", handleReasoning);
      window.removeEventListener("chat-streaming-tool-call", handleToolCall);
      window.removeEventListener("chat-streaming-tool-input-update", handleToolInputUpdate);
      window.removeEventListener("chat-streaming-tool-output", handleToolOutput);
      window.removeEventListener(
        CHAT_STREAMING_ABORT,
        handleAbort,
      );
    };
  }, [effectiveIsStreaming, isLocallyAborted, messageId]);

  useEffect(() => {
    if (
      !effectiveIsStreaming &&
      content &&
      cachedStreamingState?.content &&
      content.length >= cachedStreamingState.content.length
    ) {
      clearStreamingMessageCache(messageId);
    }
  }, [cachedStreamingState?.content, content, effectiveIsStreaming, messageId]);

  // Filter out the fallback regex pattern from display if it exists
  // Also filter out stray "|" pipes that some models output as separators
  const filteredContent = effectiveContent
    .replace(/\[\[SEARCH:.*?\]\]/g, "")
    .replace(/^\|$/, "")
    .trim();

  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyAnswered, setSurveyAnswered] = useState(false);

  const getEtDateKey = () => {
    if (typeof window === "undefined") return "";
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value ?? "1970";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  };


  // Merge tools
  const mergedToolCalls = useMemo(() => {
    const dbTools = toolCalls || [];
    const dbIds = new Set(dbTools.map((t) => t.id));
    const uniqueStreaming = streamingToolCalls.filter((t) => !dbIds.has(t.id));
    return [...dbTools, ...uniqueStreaming];
  }, [toolCalls, streamingToolCalls]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (effectiveIsStreaming || surveyAnswered || showSurvey) return;
    const hasResponse =
      filteredContent.length > 0 ||
      products.length > 0 ||
      mergedToolCalls.length > 0;
    if (!hasResponse) return;
    const lastPromptDate = localStorage.getItem(
      "sendcat_quality_prompt_date",
    );
    const today = getEtDateKey();
    if (lastPromptDate === today) return;
    if (Math.random() > 0.05) return;

    localStorage.setItem("sendcat_quality_prompt_date", today);
    setShowSurvey(true);
    trackEvent("llm_quality_prompt_shown", { message_id: messageId });
  }, [
    filteredContent.length,
    effectiveIsStreaming,
    mergedToolCalls.length,
    messageId,
    products.length,
    showSurvey,
    surveyAnswered,
  ]);

  const { displayedText, isAnimating } = useSmoothStreaming(
    filteredContent,
    effectiveIsStreaming,
    isLocallyAborted,
  );

  displayedTextRef.current = displayedText;

  const shouldRenderContent = filteredContent.length > 0;

  const renderedContent = useMemo(
    () => (
      <Markdown
        content={displayedText}
        enableHighlight={!effectiveIsStreaming && !isAnimating}
        isStreaming={effectiveIsStreaming || isAnimating}
      />
    ),
    [displayedText, effectiveIsStreaming, isAnimating],
  );

  return (
    <div
      className="flex w-full flex-col gap-2"
      style={{ contain: "layout style" }}
    >
      {/* Reasoning Block */}
      {effectiveReasoning && (
        <ReasoningBlock
          content={effectiveReasoning}
          isStreaming={effectiveIsStreaming && !reasoningContent}
        />
      )}

      {/* Tool Calls */}
      {mergedToolCalls.length > 0 && (
        <div className="mb-2 flex flex-col gap-2">
          {mergedToolCalls.map((tc, i) => {
            // Priority: persistent toolResults > real-time streamingToolResults
            // Note: toolResults comes from DB as JSON strings or formatted content
            // streamingToolResults comes as raw objects (for search) or strings
            const result = toolResults[tc.id] ?? streamingToolResults[tc.id];

            return (
              <ToolCallRenderer
                key={tc.id || i}
                toolCall={tc}
                result={result}
              />
            );
          })}
        </div>
      )}

      {/* Product Results (eBay) */}
      {products.length > 0 && (
        <div className="my-2">
          <ProductGrid
            products={products}
            hideHeader
            showSourceFilters
            maxItems={12}
            onOpenExpanded={onOpenExpanded}
          />
        </div>
      )}

      {/* Content */}
      {shouldRenderContent && (
        <div className="leading-relaxed break-words">{renderedContent}</div>
      )}

      {showSurvey && !surveyAnswered && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-fuchsia-100 bg-fuchsia-50/40 px-3 py-2 text-xs text-foreground/70">
          <span className="font-medium">Was this response helpful?</span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-50"
              onClick={() => {
                setSurveyAnswered(true);
                setShowSurvey(false);
                trackEvent("llm_quality_feedback", {
                  message_id: messageId,
                  response: "yes",
                });
              }}
            >
              Yes
            </button>
            <button
              className="rounded-full border border-rose-200 bg-white px-3 py-1 text-[11px] font-semibold text-rose-600 transition-colors hover:bg-rose-50"
              onClick={() => {
                setSurveyAnswered(true);
                setShowSurvey(false);
                trackEvent("llm_quality_feedback", {
                  message_id: messageId,
                  response: "no",
                });
              }}
            >
              No
            </button>
          </div>
        </div>
      )}

      {/* [AGENTIC] Thinking Indicator - Moved here to respect streaming state */}
      {effectiveIsStreaming &&
        !effectiveContent.trim() &&
        !effectiveReasoning.trim() &&
        mergedToolCalls.length === 0 && (
          <div className="flex items-center gap-2.5 py-2 text-foreground/60">
            <motion.div
              className="flex gap-1.5"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-2 w-2 rounded-full bg-gradient-to-br from-t3-berry to-t3-berry-deep shadow-sm"
                  animate={{
                    y: [0, -6, 0],
                    scale: [1, 1.15, 1],
                    opacity: [0.7, 1, 0.7],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 0.7,
                    delay: i * 0.12,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                />
              ))}
            </motion.div>
            <span className="text-sm font-semibold tracking-tight">
              Thinking...
            </span>
          </div>
        )}
    </div>
  );
};

const ToolCallRenderer = ({
  toolCall,
  result,
}: {
  toolCall: ToolCall;
  result?: unknown;
}) => {
  const originalName = toolCall.function?.name || "";
  let name = originalName;
  let args = toolCall.function?.arguments || "";

  if (name.startsWith("{")) {
    try {
      const parsed = JSON.parse(name);
      // If name is valid JSON and has a 'query' but no name, it's likely a search tool
      if (parsed.query && !args) {
        name = "search_web";
        args = originalName; // Keep the whole JSON as args for downstream parsing
      }
    } catch (e) {}
  }

  if (name === "search_web") {
    return <SearchToolResult isLoading={!result} result={result} args={args} />;
  }
  if (name === "search_global") {
    return <GlobalToolResult isLoading={!result} result={result} args={args} />;
  }
  if (name === "search_products") {
    return (
      <ProductToolResult isLoading={!result} result={result} args={args} />
    );
  }
  if (name === "search_ebay") {
    return (
      <EbayToolResult
        isLoading={!result}
        result={result}
        args={args}
        title="Searched eBay"
        loadingText="Searching eBay..."
      />
    );
  }
  return (
    <ToolCallBlock
      toolName={name}
      args={args}
      state={toolCall.state}
      result={
        typeof result === "string"
          ? result
          : result == null
            ? undefined
            : JSON.stringify(result)
      }
    />
  );
};
