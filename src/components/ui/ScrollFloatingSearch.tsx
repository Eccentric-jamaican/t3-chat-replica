import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useIsMobile } from '../../hooks/useIsMobile'

interface ScrollFloatingSearchProps {
  onOpenSearch: () => void
}

export function ScrollFloatingSearch({ onOpenSearch }: ScrollFloatingSearchProps) {
  const isMobile = useIsMobile()
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>

    const handleScroll = () => {
      // If we're already hidden, just reset the timer
      setIsVisible(false)
      
      clearTimeout(timeout)
      
      timeout = setTimeout(() => {
        setIsVisible(true)
      }, 250) // Show button 250ms after scrolling stops
    }

    // Use capture phase to catch scroll events from inside the scroll container
    window.addEventListener('scroll', handleScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true })
      clearTimeout(timeout)
    }
  }, [])

  // Only show on mobile
  if (!isMobile) return null

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.button
          key="scroll-search-fab"
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          transition={{ 
            type: "spring",
            damping: 20,
            stiffness: 300
          }}
          className="fixed bottom-8 right-6 z-[100] p-5 rounded-full bg-primary text-white shadow-2xl hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
          onClick={onOpenSearch}
        >
          <Search size={24} />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
