import { useMemo, useState, useEffect } from "react";
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

interface StreamingMessageProps {
  messageId: string;
  content: string; // From DB (completed)
  reasoningContent?: string; // From DB
  toolCalls?: any[]; // From DB
  toolResults?: Record<string, string>; // Map of toolCallId -> result content
  products?: Product[]; // From DB
  isStreaming: boolean;
  onOpenExpanded?: (products: Product[]) => void;
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
  const [streamingToolCalls, setStreamingToolCalls] = useState<any[]>([]);
  const [streamingToolResults, setStreamingToolResults] = useState<
    Record<string, any>
  >({});

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const handleContent = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        setStreamingContent((prev) => prev + event.detail.content);
      }
    };

    const handleReasoning = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        setStreamingReasoning((prev) => prev + event.detail.content);
      }
    };

    const handleToolCall = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        const newTool = {
          id: event.detail.toolCallId,
          function: {
            name: event.detail.toolName,
            arguments: event.detail.args || "",
          },
          type: "function",
          state: event.detail.state || "streaming",
        };
        setStreamingToolCalls((prev) => {
          if (prev.find((t) => t.id === newTool.id)) return prev;
          return [...prev, newTool];
        });
      }
    };

    const handleToolOutput = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        setStreamingToolResults((prev) => ({
          ...prev,
          [event.detail.toolCallId]: event.detail.output,
        }));
      }
    };

    const handleToolInputUpdate = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        setStreamingToolCalls((prev) => {
          return prev.map((tc) => {
            if (tc.id === event.detail.toolCallId) {
              return {
                ...tc,
                function: {
                  ...tc.function,
                  arguments:
                    event.detail.argsSnapshot ||
                    tc.function.arguments + event.detail.argsDelta,
                },
              };
            }
            return tc;
          });
        });
      }
    };

    window.addEventListener("chat-streaming-content" as any, handleContent);
    window.addEventListener("chat-streaming-reasoning" as any, handleReasoning);
    window.addEventListener("chat-streaming-tool-call" as any, handleToolCall);
    window.addEventListener(
      "chat-streaming-tool-input-update" as any,
      handleToolInputUpdate,
    );
    window.addEventListener(
      "chat-streaming-tool-output" as any,
      handleToolOutput,
    );

    return () => {
      window.removeEventListener(
        "chat-streaming-content" as any,
        handleContent,
      );
      window.removeEventListener(
        "chat-streaming-reasoning" as any,
        handleReasoning,
      );
      window.removeEventListener(
        "chat-streaming-tool-call" as any,
        handleToolCall,
      );
      window.removeEventListener(
        "chat-streaming-tool-input-update" as any,
        handleToolInputUpdate,
      );
      window.removeEventListener(
        "chat-streaming-tool-output" as any,
        handleToolOutput,
      );
    };
  }, [messageId, isStreaming]);

  const effectiveReasoning =
    streamingReasoning.length > (reasoningContent?.length || 0)
      ? streamingReasoning
      : reasoningContent || "";

  const effectiveContent =
    streamingContent.length > content.length ? streamingContent : content;

  // Filter out the fallback regex pattern from display if it exists
  // Also filter out stray "|" pipes that some models output as separators
  const filteredContent = effectiveContent
    .replace(/\[\[SEARCH:.*?\]\]/g, "")
    .replace(/^\|$/, "")
    .trim();

  // Merge tools
  const mergedToolCalls = useMemo(() => {
    const dbTools = toolCalls || [];
    const dbIds = new Set(dbTools.map((t: any) => t.id));
    const uniqueStreaming = streamingToolCalls.filter((t) => !dbIds.has(t.id));
    return [...dbTools, ...uniqueStreaming];
  }, [toolCalls, streamingToolCalls]);

  const { displayedText, isAnimating } = useSmoothStreaming(
    filteredContent,
    isStreaming,
  );

  const shouldRenderContent = filteredContent.length > 0;

  const renderedContent = useMemo(
    () => (
      <Markdown
        content={displayedText}
        enableHighlight={!isStreaming && !isAnimating}
        isStreaming={isStreaming || isAnimating}
      />
    ),
    [displayedText, isStreaming, isAnimating],
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
          isStreaming={isStreaming && !reasoningContent}
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

      {/* [AGENTIC] Thinking Indicator - Moved here to respect streaming state */}
      {isStreaming &&
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
  toolCall: any;
  result?: any;
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
      result={result}
    />
  );
};
