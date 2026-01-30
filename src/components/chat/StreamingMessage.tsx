import { useMemo, useState, useEffect } from "react";
import { Markdown } from "./Markdown";
import { useSmoothStreaming } from "../../hooks/useSmoothStreaming";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { SearchToolResult } from "./SearchToolResult";
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
  const [streamingToolResults, setStreamingToolResults] = useState<Record<string, any>>({});

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
             function: { name: event.detail.toolName, arguments: event.detail.args || "" },
             type: "function",
             state: event.detail.state || "streaming"
          };
          setStreamingToolCalls(prev => {
             if (prev.find(t => t.id === newTool.id)) return prev;
             return [...prev, newTool];
          });
       }
    };

    const handleToolOutput = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        setStreamingToolResults(prev => ({
          ...prev,
          [event.detail.toolCallId]: event.detail.output
        }));
      }
    };

    const handleToolInputUpdate = (event: CustomEvent) => {
      if (event.detail.messageId === messageId) {
        setStreamingToolCalls(prev => {
          return prev.map(tc => {
            if (tc.id === event.detail.toolCallId) {
              return {
                 ...tc,
                 function: {
                    ...tc.function,
                    arguments: event.detail.argsSnapshot || (tc.function.arguments + event.detail.argsDelta)
                 }
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
    window.addEventListener("chat-streaming-tool-input-update" as any, handleToolInputUpdate);
    window.addEventListener("chat-streaming-tool-output" as any, handleToolOutput);

    return () => {
      window.removeEventListener("chat-streaming-content" as any, handleContent);
      window.removeEventListener("chat-streaming-reasoning" as any, handleReasoning);
      window.removeEventListener("chat-streaming-tool-call" as any, handleToolCall);
      window.removeEventListener("chat-streaming-tool-input-update" as any, handleToolInputUpdate);
      window.removeEventListener("chat-streaming-tool-output" as any, handleToolOutput);
    };
  }, [messageId, isStreaming]);

  const effectiveReasoning = (streamingReasoning.length > (reasoningContent?.length || 0))
     ? streamingReasoning
     : reasoningContent || "";

  const effectiveContent = (streamingContent.length > content.length)
     ? streamingContent
     : content;

  // Merge tools
  const mergedToolCalls = useMemo(() => {
     const dbTools = toolCalls || [];
     const dbIds = new Set(dbTools.map((t: any) => t.id));
     const uniqueStreaming = streamingToolCalls.filter(t => !dbIds.has(t.id));
     return [...dbTools, ...uniqueStreaming];
  }, [toolCalls, streamingToolCalls]);

  const { displayedText, isAnimating } = useSmoothStreaming(
    effectiveContent,
    isStreaming,
  );

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
    <div className="flex flex-col gap-2 w-full" style={{ contain: "layout style" }}>
      
      {/* Reasoning Block */}
      {effectiveReasoning && (
         <ReasoningBlock 
            content={effectiveReasoning} 
            isStreaming={isStreaming && !reasoningContent} 
         />
      )}

      {/* Tool Calls */}
      {mergedToolCalls.length > 0 && (
        <div className="flex flex-col gap-2 mb-2">
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
             <ProductGrid products={products} hideHeader onOpenExpanded={onOpenExpanded} />
         </div>
      )}

      {/* Content */}
      <div className="leading-relaxed break-words">
          {renderedContent}
      </div>
    </div>
  );
};

const ToolCallRenderer = ({ toolCall, result }: { toolCall: any, result?: any }) => {
   if (toolCall.function?.name === "search_web") {
       return <SearchToolResult isLoading={!result} result={result} args={toolCall.function?.arguments} />;
   }
   return (
      <ToolCallBlock 
         toolName={toolCall.function?.name} 
         args={toolCall.function?.arguments} 
         state={toolCall.state} 
         result={result} 
      />
   );
};
