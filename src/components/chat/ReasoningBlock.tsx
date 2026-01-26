import { useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface ReasoningBlockProps {
  content: string
  isStreaming?: boolean
}

export const ReasoningBlock = ({ content, isStreaming }: ReasoningBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  // Count tokens/words for display
  const wordCount = content.trim().split(/\s+/).length

  return (
    <div className="mb-3 rounded-xl border border-purple-200/40 bg-gradient-to-br from-purple-50/50 to-fuchsia-50/30 overflow-hidden backdrop-blur-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2.5 flex items-center gap-2.5 text-sm text-purple-700 hover:bg-purple-100/30 transition-colors"
      >
        <Brain
          size={15}
          className={cn(
            "text-purple-500",
            isStreaming && "animate-pulse"
          )}
        />
        <span className="font-semibold">Reasoning</span>
        <span className="text-xs text-purple-400 font-medium">
          {isStreaming ? 'thinking...' : `${wordCount} words`}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "ml-auto text-purple-400 transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1">
          <div className="text-sm text-purple-900/70 whitespace-pre-wrap leading-relaxed font-mono text-[13px] bg-white/50 rounded-lg p-3 border border-purple-100/50 max-h-[300px] overflow-y-auto scrollbar-hide">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}
