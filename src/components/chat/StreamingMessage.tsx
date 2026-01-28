import { useMemo } from 'react';
import { Markdown } from './Markdown';
import { useSmoothStreaming } from '../../hooks/useSmoothStreaming';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export const StreamingMessage = ({ content, isStreaming }: StreamingMessageProps) => {
  const { displayedText, isAnimating } = useSmoothStreaming(content, isStreaming);

  // Keep showing plain text while streaming OR while the animation is still catching up.
  // Only switch to Markdown once streaming is done AND animation has finished.
  const showPlainText = isStreaming || isAnimating;

  const renderedContent = useMemo(() => {
    if (showPlainText) {
      return (
        <div className="prose max-w-none dark:prose-invert whitespace-pre-wrap break-words">
          {displayedText}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-0.5 bg-foreground/70 animate-pulse" />
          )}
        </div>
      );
    }
    // Full markdown rendering only when complete and animation is done
    return <Markdown content={content} />;
  }, [displayedText, content, isStreaming, showPlainText]);

  return (
    <div
      style={{
        contain: showPlainText ? 'layout style' : 'none',
      }}
    >
      {renderedContent}
    </div>
  );
};
