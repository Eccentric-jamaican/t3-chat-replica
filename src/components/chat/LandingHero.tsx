import { motion } from 'framer-motion'
import { ShoppingBag, Scale, Package, Tag } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface LandingHeroProps {
  onSelectPrompt?: (text: string) => void
}

export const LandingHero = ({ onSelectPrompt }: LandingHeroProps) => {
  const isMobile = useIsMobile()
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
      className={cn(
        "max-w-3xl w-full space-y-8 md:space-y-12 text-center transition-all",
        isMobile ? "-mt-24" : "-mt-32"
      )}
    >
      {/* T3 Precise Heading: 30px, 600 weight, 0.24px tracking */}
      <h1 className="text-[30px] font-semibold text-foreground tracking-[0.24px] leading-[36px]">
        How can I help you?
      </h1>

      {/* Action Cards: Pill-shaped, T3 Lavender Oklab transition */}
      <div className="flex justify-center gap-2 overflow-x-auto scrollbar-hide px-2">
        {[
          { icon: <ShoppingBag size={16} />, label: "Shop" },
          { icon: <Scale size={16} />, label: "Compare" },
          { icon: <Package size={16} />, label: "Track" },
          { icon: <Tag size={16} />, label: "Deals" }
        ].map((item, i) => (
          <motion.button
            key={i}
            whileHover={{ backgroundColor: "rgba(242, 225, 244, 0.6)" }}
            className="flex items-center gap-1.5 px-4 py-2 glass-card rounded-full transition-all border border-black/5 shadow-sm group shrink-0"
          >
            <span className="text-t3-berry-deep opacity-90">{item.icon}</span>
            <span className="text-[13px] font-semibold text-foreground/80">{item.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Suggested Prompts: Airy spacing, subtle borders */}
      <div className="max-w-md mx-auto space-y-2 mt-8">
        {[
          "Find me wireless earbuds under $100",
          "What's a good laptop for programming?",
          "Compare prices for Nike Air Force 1s",
          "Show me trending deals today",
        ].map((text, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 * i }}
            onClick={() => onSelectPrompt?.(text)}
            className="w-full text-left p-4 rounded-xl hover:bg-black/[0.03] text-foreground/60 hover:text-foreground transition-all text-[15px] font-medium border-b border-black/[0.02] last:border-0"
          >
            {text}
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}
