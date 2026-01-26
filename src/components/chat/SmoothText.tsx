import { motion } from 'framer-motion';
import { Markdown } from './Markdown';

interface SmoothTextProps {
  content: string;
}

export const SmoothText = ({ content }: SmoothTextProps) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <Markdown content={content} />
    </motion.div>
  );
};
