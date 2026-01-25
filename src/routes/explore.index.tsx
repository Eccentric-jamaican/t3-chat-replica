import { createFileRoute, Link } from '@tanstack/react-router'
import { featuredCards, categories, type ShopSection, type ShopItem } from '../data/explore'
import { Search, ChevronRight, ArrowUpRight, Star, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useIsMobile } from '../hooks/useIsMobile'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/explore/')({ component: ExplorePage })

function ExplorePage() {
  const isMobile = useIsMobile()
  const getExploreItems = useAction(api.explore.getExploreItems)
  const [shopSections, setShopSections] = useState<ShopSection[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const [trending, newArrivals] = await Promise.all([
          getExploreItems({ section: 'trending' }),
          getExploreItems({ section: 'new' })
        ])

        setShopSections([
          { id: 'trending', title: 'Trending Now', items: trending },
          { id: 'new', title: 'New Arrivals', items: newArrivals }
        ])
      } catch (error) {
        console.error('Failed to fetch explore items:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSections()
  }, [getExploreItems])

  return (
    <>
      {/* Sticky Header with Search */}
      <header className={`sticky top-0 z-[60] px-4 flex items-center justify-center transition-all ${isMobile ? 'bg-transparent backdrop-blur-none border-none py-1' : 'bg-background/40 backdrop-blur-xl border-b border-black/5 py-3'}`}>
        {!isMobile ? (
          <div className="max-w-2xl w-full relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/30 group-focus-within:text-primary transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="Search for ideas..." 
              className="w-full bg-black/5 border-none rounded-full py-2.5 pl-12 pr-4 text-[15px] focus:ring-2 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
        ) : null}
      </header>

      <main className={`flex-1 max-w-6xl mx-auto w-full px-4 pb-24 space-y-12 md:space-y-16 ${isMobile ? 'pt-16' : 'pt-12'}`}>
        {/* Hero Section */}
        <section className="text-center space-y-3 md:space-y-4">
          <h1 className="text-3xl md:text-6xl font-bold tracking-tight text-foreground/90">
            Explore what's possible
          </h1>
          <p className="text-base md:text-lg text-foreground/50 max-w-xl mx-auto px-4">
            Discover the latest trends, creative ideas, and inspiration curated just for you.
          </p>
        </section>

        {/* Featured Row */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredCards.map((card, idx) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              whileHover={!isMobile ? { y: -8 } : {}}
              className="group relative rounded-[32px] overflow-hidden cursor-pointer shadow-xl shadow-black/5 h-[350px] md:h-[450px]"
            >
              <img 
                src={card.image} 
                alt={card.title} 
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
              
              <div className="absolute top-6 left-6 right-6 flex justify-between items-start">
                <span className="text-xs font-bold uppercase tracking-widest text-white/70 bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                  {card.subtitle}
                </span>
                <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex">
                  <ArrowUpRight size={20} />
                </div>
              </div>

              <div className="absolute bottom-8 left-8 right-8">
                <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight">
                  {card.title}
                </h3>
              </div>
            </motion.div>
          ))}
        </section>

        {/* See More Button */}
        <div className="flex justify-center">
          <button className="glass-pill px-8 py-3 text-base shadow-lg shadow-primary/5 hover:scale-105 active:scale-95">
            <span>See more</span>
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Categories Grid */}
        <section className="space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground/80">Browse by category</h2>
            <button className="text-sm font-semibold text-primary hover:underline">View all</button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {categories.map((cat, idx) => (
                <Link
                  key={cat.id}
                  to="/explore/category/$categoryId"
                  params={{ 
                    categoryId: cat.id
                  }}
                  className="block"
                >
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.05 }}
                  whileHover={{ scale: 1.02, y: -4 }}
                  className="group relative aspect-square rounded-3xl overflow-hidden cursor-pointer shadow-sm"
                >
                  <img 
                    src={cat.image} 
                    alt={cat.name} 
                    className="absolute inset-0 w-full h-full object-cover grayscale-[0.2] transition-all group-hover:grayscale-0"
                  />
                  <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors" />
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <span className="text-lg font-bold text-white text-center drop-shadow-md">
                      {cat.name}
                    </span>
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>
        </section>

        {/* Shop App Style Sections */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
          </div>
        ) : (
          shopSections.map((section: ShopSection) => (
            <section key={section.id} className="space-y-6">
              <div className="flex items-center gap-2 cursor-pointer group w-fit">
                <h2 className="text-2xl font-bold text-foreground/90">{section.title}</h2>
                <ChevronRight className="text-foreground/40 group-hover:text-foreground transition-colors" size={24} />
              </div>
              
              <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 scroll-pl-4">
                {section.items.map((item: ShopItem) => (
                  <Link 
                    key={item.id} 
                    to="." 
                    search={{ productId: item.id }} 
                    className="flex-none w-[160px] md:w-[220px] group cursor-pointer"
                  >
                    <div className="relative aspect-square rounded-2xl overflow-hidden mb-3 bg-black/5">
                      <img 
                        src={item.image} 
                        alt={item.title} 
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded-md flex items-center gap-0.5 text-[10px] font-bold shadow-sm">
                        <Star size={10} className="fill-yellow-400 text-yellow-400" />
                        <span>{item.rating.toFixed(1)}</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground/90 leading-tight group-hover:text-primary transition-colors line-clamp-2">{item.title}</h3>
                      <p className="text-xs text-foreground/50 mt-1 truncate">{item.brand}</p>
                      {item.price && <p className="text-sm font-semibold text-foreground/90 mt-1">{item.price}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="py-12 border-t border-black/5 text-center text-foreground/30 text-sm">
         &copy; 2024 T3.chat. Discover curated inspiration.
      </footer>
    </>
  )
}
