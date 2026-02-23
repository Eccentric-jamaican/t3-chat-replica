import { createFileRoute, Link } from "@tanstack/react-router";
import { type ShopItem } from "../data/explore";
import { Search, ChevronLeft, ArrowUpRight, Star } from "lucide-react";
import { motion } from "framer-motion";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  DEFAULT_SUBCATEGORY_LIMIT,
  getGradientForCategory,
} from "../data/exploreTaxonomy";
import {
  getExploreItemsCacheKey,
  getOrSetExploreItemsCached,
  peekExploreItemsCached,
} from "../lib/exploreSectionsCache";

export const Route = createFileRoute("/explore/category/$categoryId/")({
  component: CategoryIndexPage,
});

function CategoryIndexPage() {
  const { categoryId } = Route.useParams();
  const isMobile = useIsMobile();
  const getExploreItems = useAction(api.explore.getExploreItems);
  const category = useQuery(api.ebayTaxonomy.getCategoryById, { categoryId });
  const subcategories = useQuery(api.ebayTaxonomy.listChildCategories, {
    categoryId,
  });
  const itemsKey = getExploreItemsCacheKey({ categoryId });
  const initialItems = peekExploreItemsCached(itemsKey);
  const [items, setItems] = useState<ShopItem[]>(() => initialItems ?? []);
  const [isLoading, setIsLoading] = useState(() => !initialItems);
  const [showAllSubcategories, setShowAllSubcategories] = useState(false);
  const visibleSubcategories = useMemo(() => {
    if (!subcategories) return [];
    if (showAllSubcategories) return subcategories;
    return subcategories.slice(0, DEFAULT_SUBCATEGORY_LIMIT);
  }, [showAllSubcategories, subcategories]);
  const heroGradient = category
    ? getGradientForCategory(category.categoryName)
    : "from-[#f6d365] via-[#fda085] to-[#fbc2eb]";

  useEffect(() => {
    // If this route stays mounted while the param changes, reset UI state to match the new category.
    const cached = peekExploreItemsCached(itemsKey);
    setItems(cached ?? []);
    setIsLoading(!cached);
    setShowAllSubcategories(false);
  }, [itemsKey]);

  useEffect(() => {
    if (!category) return;
    let stale = false;
    if (!peekExploreItemsCached(itemsKey)) {
      setIsLoading(true);
      setItems([]);
    }
    const fetchData = async () => {
      try {
        const data = await getOrSetExploreItemsCached({
          key: itemsKey,
          fetcher: () =>
            getExploreItems({
              categoryId: category.categoryId,
              categoryName: category.categoryName,
            }),
        });
        if (stale) return;
        setItems(data);
      } catch (e) {
        if (stale) return;
        console.error(e);
      } finally {
        if (!stale) setIsLoading(false);
      }
    };
    fetchData();
    return () => {
      stale = true;
    };
  }, [category, getExploreItems, itemsKey]);

  if (category === null) {
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
            placeholder={`Search in ${category?.categoryName ?? "this category"}...`}
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
          <div
            className={`absolute inset-0 bg-gradient-to-br ${heroGradient}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

          <div className="absolute right-10 bottom-10 left-10 space-y-4 text-left">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl font-black tracking-tight text-white md:text-6xl"
            >
              {category?.categoryName ?? "Category"}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="max-w-2xl text-lg leading-relaxed text-white/70"
            >
              Curated picks sourced from eBay&apos;s marketplace categories.
            </motion.p>
          </div>
        </section>

        {/* Subcategory Grid */}
        <section className="space-y-6">
          <h2 className="px-2 text-left text-2xl font-bold text-foreground/90">
            Subcategories
          </h2>
          {subcategories === undefined ? (
            <div className="grid grid-cols-2 gap-4 px-2 md:grid-cols-4">
              {[...Array(8)].map((_, idx) => (
                <div
                  key={idx}
                  className="aspect-[4/3] animate-pulse rounded-3xl bg-black/5"
                />
              ))}
            </div>
          ) : subcategories.length === 0 ? (
            <div className="rounded-3xl border border-black/5 bg-black/[0.02] p-6 text-sm text-foreground/60">
              No subcategories found for this category yet.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 px-2 md:grid-cols-4">
                {visibleSubcategories.map(
                  (sub: { categoryId: string; categoryName: string }, idx: number) => (
                  <Link
                    key={sub.categoryId}
                    to="/explore/category/$categoryId/$subCategoryId"
                    params={{
                      categoryId: categoryId,
                      subCategoryId: sub.categoryId,
                    }}
                    className="block"
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.05 }}
                      whileHover={{ y: -5 }}
                      className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-3xl"
                    >
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${getGradientForCategory(
                          sub.categoryName,
                        )}`}
                      />
                      <div className="absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/5" />
                      <div className="absolute right-4 bottom-4 left-4 text-center">
                        <span className="text-lg font-bold text-white drop-shadow-md">
                          {sub.categoryName}
                        </span>
                      </div>
                    </motion.div>
                  </Link>
                  ),
                )}
              </div>
              {subcategories.length > DEFAULT_SUBCATEGORY_LIMIT && (
                <div className="flex justify-center">
                  <button
                    onClick={() =>
                      setShowAllSubcategories((prev) => !prev)
                    }
                    className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-foreground/70 transition-colors hover:bg-black/5"
                  >
                    {showAllSubcategories ? "Show fewer" : "View all"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Featured Items (Shop App Style) */}
        <section className="space-y-8">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-2xl font-bold text-foreground/90">
              Featured in {category?.categoryName ?? "this category"}
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
        &copy; 2024 Sendcat. {category?.categoryName ?? "Category"} discovery.
      </footer>
    </>
  );
}
