import { useState } from 'react'
import { Globe, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface SearchResult {
  title: string
  link: string
  snippet: string
}

interface SearchToolResultProps {
  isLoading: boolean
  result?: string
}

export function SearchToolResult({ isLoading, result }: SearchToolResultProps) {
  const [isOpen, setIsOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground/60 py-2">
         <div className="w-4 h-4 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
         <span>Searching the web...</span>
      </div>
    )
  }

  let parsedResults: SearchResult[] = []
  try {
    if (result) parsedResults = JSON.parse(result)
  } catch (e) {
    // If it's pure text (legacy) or error
    return (
      <div className="text-xs bg-black/5 p-2 rounded font-mono text-foreground/60">
        {result}
      </div>
    )
  }

  if (!parsedResults || parsedResults.length === 0) return null

  return (
    <div className="my-2 text-sm rounded-lg overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-2.5 hover:bg-black/5 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Globe size={14} className="text-blue-500" />
          <span>Searched the web</span>
        </div>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-2 pt-0 space-y-2">
              {parsedResults.map((item, i) => {
                 const domain = new URL(item.link).hostname;
                 const favicon = `https://www.google.com/s2/favicons?domain=${domain}`;
                 
                 return (
                  <a 
                    key={i} 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block p-2 rounded hover:bg-black/5 transition-colors group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <img src={favicon} alt="" className="w-4 h-4 rounded-sm" />
                      <span className="text-xs text-foreground/50 truncate font-mono">{domain}</span>
                    </div>
                    <div className="font-medium text-blue-600 truncate group-hover:underline">
                      {item.title}
                    </div>
                    <div className="text-xs text-foreground/60 line-clamp-2 mt-0.5">
                      {item.snippet}
                    </div>
                  </a>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
