import { action } from './_generated/server'
import { v } from 'convex/values'
import { searchEbayItems } from './ebay'

export const getExploreItems = action({
  args: {
    section: v.optional(v.string()), // "trending" | "new"
    categoryId: v.optional(v.string()),
    subCategoryId: v.optional(v.string()),
    q: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    let query = args.q || 'trending products'

    // 1. Handle Navigation-based queries
    if (args.subCategoryId) {
      // Map subcategory IDs to search terms
      const map: Record<string, string> = {
        w1: 'women clothing',
        w2: 'women shoes',
        w3: 'women accessories',
        w4: 'women luxury bags',
        m1: 'men clothing',
        m2: 'men shoes',
        m3: 'men watches',
        m4: 'men grooming kit',
        home: 'home decor',
        tech: 'consumer electronics',
      }
      query = map[args.subCategoryId] || `${args.categoryId || ''} ${args.subCategoryId} products`
    } else if (args.categoryId) {
      // Category Landing Page
      query = `${args.categoryId} fashion trending`
    }
    // 2. Handle Home Page sections
    else if (args.section === 'trending') {
      query = 'trending technology gadgets'
    } else if (args.section === 'new') {
      query = 'new arrivals home decor'
    }

    // Reuse existing efficient eBay search helper
    const items = await searchEbayItems(query, args.limit ?? 60)

    return items.map(
      (item: {
        id: string
        title: string
        image: string
        sellerName?: string
        price: string
        url: string
      }) => ({
        id: item.id,
        title: item.title,
        image: item.image,
        brand: item.sellerName || 'eBay Seller',
        rating: Math.random() * 1.5 + 3.5,
        price: item.price,
        url: item.url,
      }),
    )
  },
})
