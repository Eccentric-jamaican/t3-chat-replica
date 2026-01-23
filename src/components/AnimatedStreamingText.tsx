import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Markdown } from './Markdown';

interface AnimatedStreamingTextProps {
  content: string;
  isStreaming: boolean;
}

export const AnimatedStreamingText = ({ content, isStreaming }: AnimatedStreamingTextProps) => {
  // Memoize markdown rendering
  const renderedMarkdown = useMemo(() => (
    <Markdown content={content} />
  ), [content]);

  return (
    <motion.div
      className="animated-streaming-text"
      initial={isStreaming ? { opacity: 0.7 } : { opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: 0.2,
        ease: [0.2, 0, 0, 1],
      }}
    >
      {renderedMarkdown}
    </motion.div>
  );
};
