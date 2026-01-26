import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, TrendingUp, History, ArrowRight } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchOverlay({ isOpen, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure focus works with the entry animation
      const timer = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    // Navigate to results page
    navigate({
      to: "/explore/search",
      search: { q: query.trim() },
    });
    onClose();
  };

  const suggestedSearches = [
    "Vintage Leather Jackets",
    "Minimalist Home Decor",
    "Mechanical Keyboards",
    "Sustainable Activewear",
    "Smart Home Tech",
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex flex-col bg-background/95 backdrop-blur-md"
        >
          {/* Header */}
          <div className="mb-8 flex items-center justify-between px-6 pt-6">
            <h2 className="text-2xl font-bold tracking-tight">Search</h2>
            <button
              onClick={onClose}
              className="rounded-full bg-black/5 p-2 transition-colors hover:bg-black/10"
            >
              <X size={20} />
            </button>
          </div>

          {/* Suggestions Content */}
          <div className="flex-1 overflow-y-auto px-6">
            <div className="space-y-6">
              <section>
                <div className="mb-4 flex items-center gap-2 text-foreground/40">
                  <TrendingUp size={16} />
                  <span className="text-xs font-bold tracking-widest uppercase">
                    Suggested for you
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedSearches.map((term) => (
                    <button
                      key={term}
                      onClick={() => {
                        setQuery(term);
                        navigate({
                          to: "/explore/search",
                          search: { q: term },
                        });
                        onClose();
                      }}
                      className="rounded-full bg-black/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-black/10"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-4 flex items-center gap-2 text-foreground/40">
                  <History size={16} />
                  <span className="text-xs font-bold tracking-widest uppercase">
                    Recent searches
                  </span>
                </div>
                <div className="space-y-4">
                  {["hoodies", "denim", "sneakers"].map((term) => (
                    <button
                      key={term}
                      type="button"
                      aria-label={`Search for ${term}`}
                      onClick={() => {
                        setQuery(term);
                        navigate({
                          to: "/explore/search",
                          search: { q: term },
                        });
                        onClose();
                      }}
                      className="group flex cursor-pointer items-center justify-between rounded-lg focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
                    >
                      <span className="text-foreground/70 transition-colors group-hover:text-foreground">
                        {term}
                      </span>
                      <ArrowRight
                        size={14}
                        className="text-foreground/20 transition-colors group-hover:text-foreground"
                      />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* Bottom Docked Input Field */}
          <div
            className="mt-auto border-t border-black/5 bg-background/50 p-6 pb-10"
            style={{
              paddingBottom:
                "calc(env(safe-area-inset-bottom, 0px) + var(--visual-viewport-bottom, 0px) + 24px)",
            }}
          >
            <form onSubmit={handleSearch} className="group relative">
              <div className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-foreground/30 transition-colors group-focus-within:text-primary">
                <Search size={20} />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What are you looking for?"
                className="h-14 w-full rounded-2xl border-none bg-black/5 pr-16 pl-14 text-lg transition-all outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="submit"
                disabled={!query.trim()}
                className="absolute top-1/2 right-2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-primary text-white transition-all disabled:opacity-30 disabled:grayscale"
              >
                <ArrowRight size={20} />
              </button>
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
