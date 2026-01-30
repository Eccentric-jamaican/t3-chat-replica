import { useMemo, useState, useEffect } from "react";
import { Markdown } from "./Markdown";
import { useSmoothStreaming } from "../../hooks/useSmoothStreaming";

interface StreamingMessageProps {
  messageId: string;
  content: string;
  isStreaming: boolean;
}

export const StreamingMessage = ({
  messageId,
  content,
  isStreaming,
}: StreamingMessageProps) => {
  const [streamingContent, setStreamingContent] = useState("");

  useEffect(() => {
    // Only listen if isStreaming is true OR if we have data in the buffer that hasn't been superseded by DB content
    const shouldListen = isStreaming || (streamingContent.length > 0 && streamingContent.length > content.length);
    
    if (!shouldListen && !isStreaming) {
      setStreamingContent("");
      return;
    }

    const handler = (event: any) => {
      if (event.detail.messageId === messageId) {
        setStreamingContent((prev) => prev + event.detail.content);
      }
    };

    window.addEventListener("chat-streaming-content" as any, handler);
    return () => {
      window.removeEventListener("chat-streaming-content" as any, handler);
    };
  }, [messageId, isStreaming, content.length]); // Re-evaluate when content length changes

  // Prioritize streamingContent if it's currently longer than database content
  // This avoids flickering when database persistence lags behind SSE
  const effectiveContent = (streamingContent.length > content.length) 
    ? streamingContent 
    : content;

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
    <div
      style={{
        contain: "layout style",
      }}
    >
      {renderedContent}
    </div>
  );
};
