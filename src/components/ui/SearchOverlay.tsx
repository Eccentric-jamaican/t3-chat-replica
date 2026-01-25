import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, TrendingUp, History, ArrowRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'

interface SearchOverlayProps {
  isOpen: boolean
  onClose: () => void
}

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure focus works with the entry animation
      const timer = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    
    // Navigate to results page
    navigate({ 
      to: '/explore/search', 
      search: { q: query.trim() } 
    })
    onClose()
  }

  const suggestedSearches = [
    'Vintage Leather Jackets',
    'Minimalist Home Decor',
    'Mechanical Keyboards',
    'Sustainable Activewear',
    'Smart Home Tech'
  ]

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-md flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Search</h2>
            <button 
              onClick={onClose}
              className="p-2 rounded-full bg-black/5 hover:bg-black/10 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Suggestions Content */}
          <div className="flex-1 px-6 overflow-y-auto">
            <div className="space-y-6">
              <section>
                <div className="flex items-center gap-2 mb-4 text-foreground/40">
                  <TrendingUp size={16} />
                  <span className="text-xs font-bold uppercase tracking-widest">Suggested for you</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedSearches.map((term) => (
                    <button
                      key={term}
                      onClick={() => {
                        setQuery(term)
                        navigate({ to: '/explore/search', search: { q: term } })
                        onClose()
                      }}
                      className="px-4 py-2 rounded-full bg-black/5 hover:bg-black/10 transition-colors text-sm font-medium"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center gap-2 mb-4 text-foreground/40">
                  <History size={16} />
                  <span className="text-xs font-bold uppercase tracking-widest">Recent searches</span>
                </div>
                <div className="space-y-4">
                  {['hoodies', 'denim', 'sneakers'].map((term) => (
                    <div 
                      key={term}
                      onClick={() => {
                        setQuery(term)
                        navigate({ to: '/explore/search', search: { q: term } })
                        onClose()
                      }}
                      className="flex items-center justify-between group cursor-pointer"
                    >
                      <span className="text-foreground/70 group-hover:text-foreground transition-colors">{term}</span>
                      <ArrowRight size={14} className="text-foreground/20 group-hover:text-foreground transition-colors" />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* Bottom Docked Input Field */}
          <div 
            className="p-6 pb-10 mt-auto border-t border-black/5 bg-background/50"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--visual-viewport-bottom, 0px) + 24px)' }}
          >
            <form onSubmit={handleSearch} className="relative group">
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none group-focus-within:text-primary transition-colors">
                <Search size={20} />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What are you looking for?"
                className="w-full h-14 bg-black/5 border-none rounded-2xl pl-14 pr-16 text-lg focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              />
              <button 
                type="submit"
                disabled={!query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-xl bg-primary text-white disabled:opacity-30 disabled:grayscale transition-all"
              >
                  <ArrowRight size={20} />
              </button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
