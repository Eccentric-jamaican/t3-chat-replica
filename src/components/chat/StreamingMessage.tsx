import { useMemo } from 'react';
import { useSmoothStreaming } from '../../hooks/useSmoothStreaming';
import { Markdown } from './Markdown';
import { AnimatedStreamingText } from './AnimatedStreamingText';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export const StreamingMessage = ({ content, isStreaming }: StreamingMessageProps) => {
  const smoothContent = useSmoothStreaming(content, isStreaming);

  // Memoize the rendered content
  const renderedContent = useMemo(() => {
    if (isStreaming) {
      // Use animated text with fade trail during streaming
      return <AnimatedStreamingText content={smoothContent} isStreaming={isStreaming} />;
    }
    // Use regular markdown when not streaming
    return <Markdown content={smoothContent} />;
  }, [smoothContent, isStreaming]);

  return (
    <div
      style={{
        // GPU acceleration hints during streaming
        willChange: isStreaming ? 'contents, opacity' : 'auto',
        // CSS containment to isolate reflows
        contain: isStreaming ? 'layout style paint' : 'none',
        // Force GPU layer
        transform: 'translateZ(0)',
      }}
    >
      {renderedContent}
    </div>
  );
};
