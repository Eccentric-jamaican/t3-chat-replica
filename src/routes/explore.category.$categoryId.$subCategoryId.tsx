import { createFileRoute, Link } from '@tanstack/react-router'
import { subcategoryDetails, type ShopItem } from '../data/explore'
import { Search, ChevronLeft, Star } from 'lucide-react'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useEffect, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'

export const Route = createFileRoute('/explore/category/$categoryId/$subCategoryId')({
  component: SubcategoryPage,
})

function SubcategoryPage() {
  const { categoryId, subCategoryId } = Route.useParams()
  const isMobile = useIsMobile()
  const detail = subcategoryDetails[subCategoryId]
  const getExploreItems = useAction(api.explore.getExploreItems)
  const [items, setItems] = useState<ShopItem[]>(detail?.items || [])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!detail) return
    const fetchData = async () => {
      try {
        const data = await getExploreItems({ 
          categoryId, 
          subCategoryId: detail.id // Use mapped ID or raw ID
        })
        setItems(data)
      } catch (e) {
        console.error(e)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [detail, categoryId, getExploreItems])

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground/80">Subcategory not found</h1>
          <Link to="/explore/category/$categoryId" params={{ categoryId }} className="text-primary hover:underline font-bold">Back to Category</Link>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Sticky Header */}
      <header className={`sticky top-0 z-[60] px-4 flex items-center justify-between transition-all ${isMobile ? 'bg-transparent backdrop-blur-none border-none py-1 pl-32' : 'bg-background/40 backdrop-blur-xl border-b border-black/5 py-3'}`}>
        <div className="flex items-center gap-3">
          {/* Desktop back button - mobile uses Sidebar toggle container */}
          <Link 
            to="/explore/category/$categoryId" 
            params={{ categoryId }}
            className="p-2 rounded-full bg-black/5 text-foreground/60 hover:bg-black/10 transition-colors hidden md:flex"
          >
            <ChevronLeft size={20} />
          </Link>
          <div className="flex-col hidden md:flex">
            <span className="text-[10px] font-black uppercase tracking-widest text-foreground/30 leading-none">
              {detail.parentCategory}
            </span>
            <span className="text-sm md:text-lg font-bold text-foreground/90 leading-tight">
              {detail.name}
            </span>
          </div>
        </div>
        
        <div className="flex-1 max-w-sm mx-4 relative group hidden md:block">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/30 group-focus-within:text-primary transition-colors" size={14} />
          <input 
            type="text" 
            placeholder={`Search in ${detail.name}...`} 
            className="w-full bg-black/5 border-none rounded-full py-1.5 pl-10 pr-4 text-xs focus:ring-2 focus:ring-primary/20 transition-all outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
           <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 hidden md:block" />
        </div>
      </header>

      <main className={`flex-1 max-w-6xl mx-auto w-full px-4 pb-24 space-y-10 ${isMobile ? 'pt-16' : 'pt-8'}`}>
        {/* Banner */}
        <section className="relative h-[200px] rounded-[32px] overflow-hidden group shadow-lg shadow-black/5">
           <img 
            src={detail.image} 
            alt={detail.name} 
            className="absolute inset-0 w-full h-full object-cover grayscale-[0.3] brightness-75"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-center px-10 space-y-2">
             <h1 className="text-4xl font-black text-white">{detail.name}</h1>
             <p className="text-white/60 font-medium">Curated {detail.name.toLowerCase()} essentials</p>
          </div>
        </section>

        {/* Filters/Tabs (Visual Only) */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
           {['All', 'Trending', 'New', 'Sale', 'Eco-Friendly'].map((tab, i) => (
             <button 
              key={tab} 
              className={`flex-none px-5 py-2 rounded-full text-sm font-bold transition-all ${
                i === 0 ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-black/5 text-foreground/60 hover:bg-black/10'
              }`}
             >
               {tab}
             </button>
           ))}
        </div>

        {/* Items Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
          {isLoading ? (
             [...Array(4)].map((_, i) => (
               <div key={i} className="aspect-[3/4] rounded-[24px] bg-black/5 animate-pulse" />
             ))
          ) : items.map((item) => (
            <Link 
              key={item.id} 
              to="."
              search={{ productId: item.id }} 
              className="group cursor-pointer"
            >
              <div className="relative aspect-[3/4] rounded-[24px] overflow-hidden mb-4 bg-black/5 shadow-sm group-hover:shadow-xl transition-all duration-300">
                <img 
                  src={item.image} 
                  alt={item.title} 
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-md px-2 py-1 rounded-full flex items-center gap-1 text-[10px] font-black shadow-lg">
                  <Star size={10} className="fill-yellow-400 text-yellow-400" />
                  <span>{item.rating.toFixed(1)}</span>
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                   <div className="w-full bg-white text-black py-2.5 rounded-xl font-bold text-xs shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-transform text-center">
                      Quick View
                   </div>
                </div>
              </div>
              <div className="px-2 space-y-0.5 text-left">
                <h3 className="text-sm font-bold text-foreground/90 leading-tight group-hover:text-primary transition-colors line-clamp-2">
                  {item.title}
                </h3>
                <p className="text-[11px] text-foreground/40 font-bold uppercase tracking-wider truncate">
                  {item.brand}
                </p>
                {item.price && <p className="text-sm font-bold text-foreground/80 mt-1">{item.price}</p>}
              </div>
            </Link>
          ))}
        </div>
      </main>

      <footer className="py-12 border-t border-black/5 text-center text-foreground/30 text-xs">
         &copy; 2024 T3.chat. {detail.parentCategory} &rsaquo; {detail.name}
      </footer>
    </>
  )
}
