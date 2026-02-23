import { Zap, Clock, Wrench, Cpu, Info } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface MetadataChipProps {
  label: string;
  icon?: React.ReactNode;
  color?: string;
  className?: string;
  minWidth?: string;
}

export const MetadataChip = ({ label, icon, color = "text-fuchsia-900/60", className = "", minWidth }: MetadataChipProps) => (
  <div
    className={`flex items-center gap-1.5 text-[11.5px] font-medium tracking-tight whitespace-nowrap ${color} ${className}`}
    style={minWidth ? { minWidth } : undefined}
  >
    {icon && <span className="opacity-80 shrink-0">{icon}</span>}
    <span className="tabular-nums">{label}</span>
  </div>
);

export const MessageMetadata = ({ modelName, toolCalls, wordCount }: { modelName: string, toolCalls?: number, wordCount?: number }) => {
  const isMobile = useIsMobile();
  const [isExpanded, setIsExpanded] = useState(false);
  const mobileExpandTransition = isMobile
    ? { width: 0, opacity: 0 }
    : undefined;
  
  // Mock data for visual matching until backend sends real metrics
  const tokens = wordCount ? Math.round(wordCount * 1.3) : 0;
  const time = (tokens / 60).toFixed(1); // Rough estimate

  const toggleExpand = () => {
    if (isMobile) setIsExpanded(prev => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isMobile && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggleExpand();
    }
  };

  return (
    <div 
      className={`flex items-center gap-x-3 ml-0 md:ml-4 select-none group/meta mt-1 overflow-hidden transition-all duration-300 ${isMobile ? 'cursor-pointer' : ''}`}
      onClick={isMobile ? toggleExpand : undefined}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={isMobile ? 0 : -1}
      aria-expanded={isMobile ? isExpanded : undefined}
    >
       {/* Model Name */}
       <MetadataChip
         label={modelName}
         color="text-fuchsia-700 font-bold uppercase tracking-wider shrink-0"
       />

       {/* Separator - Hidden on mobile if collapsed/always? Let's hide it on mobile for cleaner look */}
       <div className="hidden sm:block h-2.5 w-[1.5px] bg-fuchsia-200/60 shrink-0" />

       {/* Metrics */}
       <AnimatePresence mode="wait">
         {(!isMobile || isExpanded) ? (
            <motion.div 
              initial={mobileExpandTransition}
              animate={{ width: "auto", opacity: 1 }}
              exit={mobileExpandTransition}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 shrink-0 overflow-visible"
            >
              {/* Desktop separator was hidden so we need spacing if we just popped in, strictly the items */}
              
              <MetadataChip
                  icon={<Zap size={11.5} />}
                  label={`${(tokens/1.2).toFixed(1)} tok/s`}
                  color="text-fuchsia-800/70 group-hover/meta:text-fuchsia-800"
                  minWidth={isMobile ? "auto" : "70px"}
              />
              <MetadataChip
                  icon={<Cpu size={11.5} />}
                  label={`${tokens} tokens`}
                  color="text-fuchsia-800/70 group-hover/meta:text-fuchsia-800"
                  minWidth={isMobile ? "auto" : "75px"}
              />
              <MetadataChip
                  icon={<Clock size={11.5} />}
                  label={`${time}s`}
                  color="text-fuchsia-800/70 group-hover/meta:text-fuchsia-800"
                  minWidth={isMobile ? "auto" : "40px"}
              />
              {toolCalls ? (
                <MetadataChip
                  icon={<Wrench size={11.5} />}
                  label={`${toolCalls} tool${toolCalls > 1 ? 's' : ''}`}
                  color="text-fuchsia-800/70 group-hover/meta:text-fuchsia-800"
                />
              ) : null}
            </motion.div>
         ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center"
            >
              <Info size={13} className="text-fuchsia-900/40" />
            </motion.div>
         )}
       </AnimatePresence>
    </div>
  );
}
