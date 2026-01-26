import { createFileRoute, Link } from "@tanstack/react-router";
import { categoryDetails, type ShopItem } from "../data/explore";
import { Search, ChevronLeft, ArrowUpRight, Star } from "lucide-react";
import { motion } from "framer-motion";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";

export const Route = createFileRoute("/explore/category/$categoryId/")({
  component: CategoryIndexPage,
});

function CategoryIndexPage() {
  const { categoryId } = Route.useParams();
  const isMobile = useIsMobile();
  const detail = categoryDetails[categoryId];
  const getExploreItems = useAction(api.explore.getExploreItems);
  const [items, setItems] = useState<ShopItem[]>(detail?.featuredItems || []);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!detail) return;
    const fetchData = async () => {
      try {
        const data = await getExploreItems({ categoryId: detail.id });
        setItems(data);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [detail, getExploreItems]);

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-bold text-foreground/80">
            Category not found
          </h1>
          <Link
            to="/explore"
            className="font-bold text-primary hover:underline"
          >
            Back to Explore
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Sticky Header */}
      <header
        className={`sticky top-0 z-[60] flex items-center justify-between px-4 transition-all ${isMobile ? "border-none bg-transparent py-1 pl-32 backdrop-blur-none" : "border-b border-black/5 bg-background/40 py-3 backdrop-blur-xl"}`}
      >
        {/* Desktop back button - mobile uses Sidebar toggle container */}
        <Link
          to="/explore"
          className="hidden rounded-full bg-black/5 p-2 text-foreground/60 transition-colors hover:bg-black/10 md:flex"
        >
          <ChevronLeft size={20} />
        </Link>

        <div className="group relative mx-4 hidden max-w-lg flex-1 md:block">
          <Search
            className="absolute top-1/2 left-4 -translate-y-1/2 text-foreground/30 transition-colors group-focus-within:text-primary"
            size={16}
          />
          <input
            type="text"
            placeholder={`Search in ${detail.name}...`}
            className="w-full rounded-full border-none bg-black/5 py-2 pr-4 pl-10 text-sm transition-all outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden h-8 w-8 rounded-full border border-primary/20 bg-primary/10 md:block" />
        </div>
      </header>

      <main
        className={`mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 pb-24 md:space-y-16 ${isMobile ? "pt-16" : "pt-12"}`}
      >
        {/* Category Hero */}
        <section className="group relative h-[300px] overflow-hidden rounded-[40px] shadow-2xl shadow-black/5 md:h-[400px]">
          <img
            src={detail.image}
            alt={detail.name}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

          <div className="absolute right-10 bottom-10 left-10 space-y-4 text-left">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl font-black tracking-tight text-white md:text-6xl"
            >
              {detail.name}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="max-w-2xl text-lg leading-relaxed text-white/70"
            >
              {detail.description}
            </motion.p>
          </div>
        </section>

        {/* Subcategory Grid */}
        <section className="space-y-6">
          <h2 className="px-2 text-left text-2xl font-bold text-foreground/90">
            Subcategories
          </h2>
          <div className="grid grid-cols-2 gap-4 px-2 md:grid-cols-4">
            {detail.subcategories.map((sub, idx) => (
              <Link
                key={sub.id}
                to="/explore/category/$categoryId/$subCategoryId"
                params={{
                  categoryId: categoryId,
                  subCategoryId: sub.id,
                }}
                className="block"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.1 }}
                  whileHover={{ y: -5 }}
                  className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-3xl bg-black/5"
                >
                  <img
                    src={sub.image}
                    alt={sub.name}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/40 transition-colors group-hover:bg-black/20" />
                  <div className="absolute right-4 bottom-4 left-4 text-center">
                    <span className="text-lg font-bold text-white drop-shadow-md">
                      {sub.name}
                    </span>
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured Items (Shop App Style) */}
        <section className="space-y-8">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-2xl font-bold text-foreground/90">
              Featured in {detail.name}
            </h2>
            <button className="flex items-center gap-1 text-sm font-bold text-primary hover:underline">
              View all <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-6 px-2 md:gap-8 lg:grid-cols-4">
            {isLoading
              ? // Loading Skeletons
                [...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square animate-pulse rounded-[32px] bg-black/5"
                  />
                ))
              : items.map((item) => (
                  <Link
                    key={item.id}
                    to="."
                    search={{ productId: item.id }}
                    className="group cursor-pointer"
                  >
                    <div className="relative mb-4 aspect-square overflow-hidden rounded-[32px] bg-black/5 shadow-sm transition-all duration-300 group-hover:shadow-xl">
                      <img
                        src={item.image}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                      />
                      <div className="absolute top-4 right-4 flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-black shadow-lg backdrop-blur-md">
                        <Star
                          size={12}
                          className="fill-yellow-400 text-yellow-400"
                        />
                        <span>{item.rating.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="space-y-1 px-2 text-left">
                      <h3 className="line-clamp-2 text-[15px] leading-tight font-bold text-foreground/90 transition-colors group-hover:text-primary">
                        {item.title}
                      </h3>
                      <p className="truncate text-[12px] font-medium tracking-wider text-foreground/40 uppercase">
                        {item.brand}
                      </p>
                      {item.price && (
                        <p className="text-sm font-bold text-foreground/80">
                          {item.price}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-black/5 py-12 text-center text-sm text-foreground/30">
        &copy; 2024 Sendcat. {detail.name} discovery.
      </footer>
    </>
  );
}
