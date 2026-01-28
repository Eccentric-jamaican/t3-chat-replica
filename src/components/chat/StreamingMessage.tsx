import { useMemo } from "react";
import { Markdown } from "./Markdown";
import { useSmoothStreaming } from "../../hooks/useSmoothStreaming";

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export const StreamingMessage = ({
  content,
  isStreaming,
}: StreamingMessageProps) => {
  const { displayedText, isAnimating } = useSmoothStreaming(
    content,
    isStreaming,
  );

  const renderedContent = useMemo(
    () => (
      <>
        <Markdown
          content={displayedText}
          enableHighlight={!isStreaming && !isAnimating}
        />
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/70 align-baseline" />
        )}
      </>
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
