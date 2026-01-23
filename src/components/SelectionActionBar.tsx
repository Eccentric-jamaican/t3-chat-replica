import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Send, X } from "lucide-react";

interface SelectionActionBarProps {
  selectedCount: number;
  onClear: () => void;
  onAsk?: () => void;
  onInquiry?: () => void;
}

export function SelectionActionBar({ selectedCount, onClear, onAsk, onInquiry }: SelectionActionBarProps) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[700] w-[calc(100%-2rem)] max-w-xl"
        >
          <div className="bg-[#1a1a1a] text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between gap-4 border border-white/10 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <button
                onClick={onClear}
                aria-label="Clear selection"
                title="Clear selection"
                className="p-1 hover:bg-white/10 rounded-md transition-colors"
              >
                <X size={18} />
              </button>
              <span className="text-sm font-medium">
                {selectedCount} item{selectedCount > 1 ? 's' : ''} selected
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onAsk}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition-colors"
              >
                <MessageSquare size={16} />
                Ask assistant
              </button>
              <button
                onClick={onInquiry}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#a23b67] hover:bg-[#8e335a] text-sm font-semibold transition-colors"
              >
                <Send size={16} />
                Send inquiry
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
