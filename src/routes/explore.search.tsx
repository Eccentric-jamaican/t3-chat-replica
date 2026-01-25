import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { ProductGrid } from '../components/product/ProductGrid'
import { useIsMobile } from '../hooks/useIsMobile'
import { Search } from 'lucide-react'

type SearchParams = {
  q?: string
}

export const Route = createFileRoute('/explore/search')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  component: SearchResults,
})

function SearchResults() {
  const { q } = Route.useSearch()
  const isMobile = useIsMobile()
  const searchAction = useAction(api.explore.getExploreItems)
  const [items, setItems] = useState<any[] | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchResults() {
      setIsLoading(true)
      try {
        const results = await searchAction({ q: q || undefined })
        setItems(results)
      } catch (err) {
        console.error("Search failed:", err)
        setItems([])
      } finally {
        setIsLoading(false)
      }
    }
    fetchResults()
  }, [q, searchAction])

  // We should update convex/explore.ts to handle this properly, but let's see what it does
  // Actually, I'll update explore.ts to handle a 'q' argument properly.

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <main className={`flex-1 max-w-6xl mx-auto w-full px-4 pb-24 ${isMobile ? 'pt-16' : 'pt-12'}`}>
        {/* Filter Chips - Part of the page content */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-4 -mx-4 px-4 border-b border-black/5 mb-6">
          {['Ratings', 'Gender', 'Price', 'Condition', 'Size', 'Color'].map(filter => (
            <button 
              key={filter}
              className="px-4 py-1.5 rounded-full bg-black/5 border border-black/5 hover:bg-black/10 transition-colors text-xs font-semibold whitespace-nowrap flex-shrink-0"
            >
              {filter}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 animate-pulse">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-[3/4] bg-black/5 rounded-[32px]" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <ProductGrid 
            products={items} 
            title="Search results for"
            subtitle={`“${q}”`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
             <div className="p-6 rounded-full bg-black/5 text-foreground/20">
                <Search size={48} />
             </div>
             <div>
                <h3 className="text-xl font-bold">No results found</h3>
                <p className="text-foreground/50">Try searching for something else, like "hoodies" or "tech".</p>
             </div>
          </div>
        )}
      </main>
    </div>
  )
}
