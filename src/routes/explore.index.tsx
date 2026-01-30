import { createFileRoute, Link } from "@tanstack/react-router";
import {
  featuredCards,
  categories,
  categoryDetails,
  type ShopSection,
  type ShopItem,
} from "../data/explore";
import {
  Search,
  ChevronRight,
  ArrowUpRight,
  Star,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/explore/")({ component: ExplorePage });

function ExplorePage() {
  const isMobile = useIsMobile();
  const getExploreItems = useAction(api.explore.getExploreItems);
  const [shopSections, setShopSections] = useState<ShopSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const fetchSections = async () => {
      try {
        const [trending, newArrivals] = await Promise.all([
          getExploreItems({ section: "trending" }),
          getExploreItems({ section: "new" }),
        ]);

        setShopSections([
          { id: "trending", title: "Trending Now", items: trending },
          { id: "new", title: "New Arrivals", items: newArrivals },
        ]);
      } catch (error) {
        console.error("Failed to fetch explore items:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSections();
  }, [getExploreItems]);

  return (
    <>
      {/* Sticky Header with Search */}
      <header
        className={`sticky top-0 z-[60] flex items-center justify-center px-4 transition-all ${isMobile ? "border-none bg-transparent py-1 backdrop-blur-none" : "border-b border-black/5 bg-background/40 py-3 backdrop-blur-xl"}`}
      >
        {!isMobile ? (
          <div className="group relative w-full max-w-2xl">
            <Search
              className="absolute top-1/2 left-4 -translate-y-1/2 text-foreground/30 transition-colors group-focus-within:text-primary"
              size={18}
            />
            <input
              type="text"
              placeholder="Search for ideas..."
              className="w-full rounded-full border-none bg-black/5 py-2.5 pr-4 pl-12 text-[15px] transition-all outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        ) : null}
      </header>

      <main
        className={`mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 pb-24 md:space-y-16 ${isMobile ? "pt-16" : "pt-12"}`}
      >
        {/* Hero Section */}
        <section className="space-y-3 text-center md:space-y-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground/90 md:text-6xl">
            Explore what's possible
          </h1>
          <p className="mx-auto max-w-xl px-4 text-base text-foreground/50 md:text-lg">
            Discover the latest trends, creative ideas, and inspiration curated
            just for you.
          </p>
        </section>

        {/* Featured Row */}
        <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {featuredCards.map((card, idx) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              whileHover={!isMobile ? { y: -8 } : {}}
              className="group relative h-[350px] cursor-pointer overflow-hidden rounded-[32px] shadow-xl shadow-black/5 md:h-[450px]"
            >
              <img
                src={card.image}
                alt={card.title}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 transition-opacity group-hover:opacity-80" />

              <div className="absolute top-6 right-6 left-6 flex items-start justify-between">
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold tracking-widest text-white/70 uppercase backdrop-blur-md">
                  {card.subtitle}
                </span>
                <div className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 md:flex">
                  <ArrowUpRight size={20} />
                </div>
              </div>

              <div className="absolute right-8 bottom-8 left-8">
                <h3 className="text-2xl leading-tight font-bold text-white md:text-3xl">
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
            <h2 className="text-2xl font-bold text-foreground/80">
              Browse by category
            </h2>
            <button className="text-sm font-semibold text-primary hover:underline">
              View all
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {categories
              .filter((cat) => Boolean(categoryDetails[cat.id]))
              .map((cat, idx) => (
                <Link
                  key={cat.id}
                  to="/explore/category/$categoryId"
                  params={{
                    categoryId: cat.id,
                  }}
                  className="block"
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    whileHover={{ scale: 1.02, y: -4 }}
                    className="group relative aspect-square cursor-pointer overflow-hidden rounded-3xl shadow-sm"
                  >
                    <img
                      src={cat.image}
                      alt={cat.name}
                      className="absolute inset-0 h-full w-full object-cover grayscale-[0.2] transition-all group-hover:grayscale-0"
                    />
                    <div className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/10" />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                      <span className="text-center text-lg font-bold text-white drop-shadow-md">
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
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        ) : (
          shopSections.map((section: ShopSection) => (
            <section key={section.id} className="space-y-6">
              <div className="group flex w-fit cursor-pointer items-center gap-2">
                <h2 className="text-2xl font-bold text-foreground/90">
                  {section.title}
                </h2>
                <ChevronRight
                  className="text-foreground/40 transition-colors group-hover:text-foreground"
                  size={24}
                />
              </div>

              <div className="scrollbar-hide -mx-4 flex scroll-pl-4 gap-4 overflow-x-auto px-4 pb-6 md:mx-0 md:px-0">
                {section.items.map((item: ShopItem) => (
                  <Link
                    key={item.id}
                    to="."
                    search={{ productId: item.id }}
                    className="group w-[160px] flex-none cursor-pointer md:w-[220px]"
                  >
                    <div className="relative mb-3 aspect-square overflow-hidden rounded-2xl bg-black/5">
                      {item.image?.trim() ? (
                        <img
                          src={item.image}
                          alt={item.title}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-black/5 text-xs font-semibold text-foreground/40">
                          No image
                        </div>
                      )}
                      <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-bold shadow-sm backdrop-blur-sm">
                        <Star
                          size={10}
                          className="fill-yellow-400 text-yellow-400"
                        />
                        <span>{item.rating.toFixed(1)}</span>
                      </div>
                    </div>
                    <div>
                      <h3 className="line-clamp-2 text-sm leading-tight font-bold text-foreground/90 transition-colors group-hover:text-primary">
                        {item.title}
                      </h3>
                      <p className="mt-1 truncate text-xs text-foreground/50">
                        {item.brand}
                      </p>
                      {item.price && (
                        <p className="mt-1 text-sm font-semibold text-foreground/90">
                          {item.price}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="border-t border-black/5 py-12 text-center text-sm text-foreground/30">
        &copy; {currentYear} Sendcat. Discover curated inspiration.
      </footer>
    </>
  );
}
