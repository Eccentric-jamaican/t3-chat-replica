import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/layout/Sidebar'
import { useEffect, useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'
import { AnimatePresence } from 'framer-motion'
import { ProductDrawer } from '../components/product/ProductDrawer'
import { ScrollFloatingSearch } from '../components/ui/ScrollFloatingSearch'
import { SearchOverlay } from '../components/ui/SearchOverlay'

type ExploreSearchParams = {
  productId?: string
}

export const Route = createFileRoute('/explore')({
  validateSearch: (search: Record<string, unknown>): ExploreSearchParams => ({
    productId: typeof search.productId === 'string' ? search.productId : undefined,
  }),
  component: ExploreLayout,
})

function ExploreLayout() {
  const isMobile = useIsMobile()
  const { productId } = Route.useSearch()
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(!isMobile)
  }, [isMobile])

  return (
    <div className="flex h-dvh min-h-screen overflow-hidden bg-background relative">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <div className="flex-1 flex flex-col relative min-w-0 overflow-y-auto scrollbar-hide">
        <Outlet />
      </div>

      {/* Product Details Drawer */}
      <AnimatePresence>
        {productId && <ProductDrawer productId={productId} />}
      </AnimatePresence>
      
      {/* Search Overlay */}
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Floating Search (Mobile) - Hidden when overlay is open to avoid overlap */}
      {!searchOpen && <ScrollFloatingSearch onOpenSearch={() => setSearchOpen(true)} />}
    </div>
  )
}
