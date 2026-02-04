import { useEffect, useMemo, useRef, useState } from 'react'
import { Wrench, ChevronDown, Check, Loader2, Globe } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { trackEvent } from '../../lib/analytics'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface ToolCallBlockProps {
  toolName: string
  args: string
  result?: string
  state?: "streaming" | "completed" | "error"
}

export const ToolCallBlock = ({ toolName, args, result, state = "completed" }: ToolCallBlockProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const isWebSearch = toolName === "search_web"
  const isSearchTool = toolName.includes("search")
  const displayName = isWebSearch ? "Searched the web" : `Used tool: ${toolName}`
  const Icon = isWebSearch ? Globe : Wrench
  const hasTrackedCall = useRef(false)
  const hasTrackedResult = useRef(false)

  const parsedArgs = useMemo(() => {
    if (!args) return null
    try {
      return JSON.parse(args)
    } catch {
      return null
    }
  }, [args])

  const searchQuery = typeof parsedArgs?.query === "string" ? parsedArgs.query : ""

  // Format args for display
  let displayArgs = args
  try {
     const parsed = JSON.parse(args)
     if (isWebSearch && parsed.query) displayArgs = `"${parsed.query}"`
     else displayArgs = JSON.stringify(parsed, null, 2)
  } catch {}

  useEffect(() => {
    if (hasTrackedCall.current) return
    trackEvent("tool_call", {
      tool_name: toolName,
      state,
    })
    if (isSearchTool && searchQuery) {
      trackEvent("search_submitted", {
        query: searchQuery,
        search_type: isWebSearch ? "web" : "products",
      })
    }
    hasTrackedCall.current = true
  }, [isSearchTool, isWebSearch, searchQuery, state, toolName])

  useEffect(() => {
    if (hasTrackedResult.current || result == null) return
    trackEvent("tool_result_render", {
      tool_name: toolName,
      has_result: true,
    })
    hasTrackedResult.current = true
  }, [result, toolName])

  return (
    <div className="mb-3 rounded-xl border border-blue-200/40 bg-gradient-to-br from-blue-50/50 to-cyan-50/30 overflow-hidden backdrop-blur-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2.5 flex items-center gap-2.5 text-sm text-blue-700 hover:bg-blue-100/30 transition-colors"
      >
        <div className="relative">
             <Icon
               size={15}
               className={cn(
                 "text-blue-500",
                 state === "streaming" && "animate-pulse"
               )}
             />
             {state === "completed" && (
                 <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-[1px]">
                     <Check size={8} className="text-green-500" />
                 </div>
             )}
        </div>
        
        <span className="font-semibold">{displayName}</span>
        
        <span className="text-xs text-blue-400 font-medium truncate max-w-[200px]">
          {displayArgs}
        </span>

        {state === "streaming" && <Loader2 size={12} className="animate-spin text-blue-400 ml-2" />}

        <ChevronDown
          size={16}
          className={cn(
            "ml-auto text-blue-400 transition-transform duration-200",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-2">
            {/* Args */}
            <div className="text-xs font-semibold text-blue-800/60 uppercase tracking-wider">Input</div>
            <div className="text-sm text-blue-900/70 font-mono text-[12px] bg-white/50 rounded-lg p-2 border border-blue-100/50 overflow-x-auto">
                {displayArgs}
            </div>

            {/* Result */}
            {result && (
                <>
                    <div className="text-xs font-semibold text-blue-800/60 uppercase tracking-wider mt-3">Result</div>
                    <div className="text-sm text-blue-900/70 whitespace-pre-wrap leading-relaxed font-mono text-[12px] bg-white/50 rounded-lg p-2 border border-blue-100/50 max-h-[200px] overflow-y-auto scrollbar-hide">
                        {result}
                    </div>
                </>
            )}
        </div>
      )}
    </div>
  )
}
