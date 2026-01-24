import { createFileRoute, Link } from '@tanstack/react-router'
import { categoryDetails, type ShopItem } from '../data/explore'
import { Search, ChevronLeft, ArrowUpRight, Star, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/explore/category/$categoryId/')({
  component: CategoryIndexPage,
})

function CategoryIndexPage() {
  const { categoryId } = Route.useParams()
  const detail = categoryDetails[categoryId]
  const getExploreItems = useAction(api.explore.getExploreItems)
  const [items, setItems] = useState<ShopItem[]>(detail?.featuredItems || [])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!detail) return
    const fetchData = async () => {
      try {
        const data = await getExploreItems({ categoryId: detail.id })
        setItems(data)
      } catch (e) {
        console.error(e)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [detail, getExploreItems])

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground/80">Category not found</h1>
          <Link to="/explore" className="text-primary hover:underline font-bold">Back to Explore</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Sticky Header */}
      <header className="sticky top-0 z-[60] px-4 py-3 flex items-center justify-between bg-background/40 backdrop-blur-xl border-b border-black/5">
        <Link 
          to="/explore" 
          className="p-2 rounded-full bg-black/5 text-foreground/60 hover:bg-black/10 transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        
        <div className="flex-1 max-w-lg mx-4 relative group hidden md:block">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/30 group-focus-within:text-primary transition-colors" size={16} />
          <input 
            type="text" 
            placeholder={`Search in ${detail.name}...`} 
            className="w-full bg-black/5 border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
           <button className="md:hidden p-2 rounded-full bg-black/5 text-foreground/60">
              <Search size={20} />
            </button>
           <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20" />
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pt-8 md:pt-12 pb-24 space-y-12 md:space-y-16">
        {/* Category Hero */}
        <section className="relative h-[300px] md:h-[400px] rounded-[40px] overflow-hidden group shadow-2xl shadow-black/5">
          <img 
            src={detail.image} 
            alt={detail.name} 
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          
          <div className="absolute bottom-10 left-10 right-10 space-y-4 text-left">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-black text-white tracking-tight"
            >
              {detail.name}
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-white/70 text-lg max-w-2xl leading-relaxed"
            >
              {detail.description}
            </motion.p>
          </div>
        </section>

        {/* Subcategory Grid */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-foreground/90 px-2 text-left">Subcategories</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-2">
            {detail.subcategories.map((sub, idx) => (
              <Link
                key={sub.id}
                to="/explore/category/$categoryId/$subCategoryId"
                params={{ 
                  categoryId: categoryId,
                  subCategoryId: sub.id
                }}
                className="block"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.1 }}
                  whileHover={{ y: -5 }}
                  className="group relative aspect-[4/3] rounded-3xl overflow-hidden cursor-pointer bg-black/5"
                >
                  <img 
                    src={sub.image} 
                    alt={sub.name} 
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
                  <div className="absolute bottom-4 left-4 right-4 text-center">
                    <span className="text-white font-bold text-lg drop-shadow-md">{sub.name}</span>
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured Items (Shop App Style) */}
        <section className="space-y-8">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-2xl font-bold text-foreground/90">Featured in {detail.name}</h2>
            <button className="text-sm font-bold text-primary hover:underline flex items-center gap-1">
              View all <ArrowUpRight size={14} />
            </button>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 px-2">
            {isLoading ? (
               // Loading Skeletons
               [...Array(4)].map((_, i) => (
                 <div key={i} className="aspect-square rounded-[32px] bg-black/5 animate-pulse" />
               ))
            ) : items.map((item) => (
              <Link 
                key={item.id} 
                to="." 
                search={{ productId: item.id }} 
                className="group cursor-pointer"
              >
                <div className="relative aspect-square rounded-[32px] overflow-hidden mb-4 bg-black/5 shadow-sm group-hover:shadow-xl transition-all duration-300">
                  <img 
                    src={item.image} 
                    alt={item.title} 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 text-[11px] font-black shadow-lg">
                    <Star size={12} className="fill-yellow-400 text-yellow-400" />
                    <span>{item.rating.toFixed(1)}</span>
                  </div>
                </div>
                <div className="px-2 space-y-1 text-left">
                  <h3 className="text-[15px] font-bold text-foreground/90 leading-tight group-hover:text-primary transition-colors line-clamp-2">
                    {item.title}
                  </h3>
                  <p className="text-[12px] text-foreground/40 font-medium uppercase tracking-wider truncate">
                    {item.brand}
                  </p>
                  {item.price && <p className="text-sm font-bold text-foreground/80">{item.price}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="py-12 border-t border-black/5 text-center text-foreground/30 text-sm">
         &copy; 2024 T3.chat. {detail.name} discovery.
      </footer>
    </>
  )
}
