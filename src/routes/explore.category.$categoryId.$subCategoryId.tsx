import { createFileRoute, Link } from "@tanstack/react-router";
import { type ShopItem } from "../data/explore";
import { Search, ChevronLeft, Star } from "lucide-react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { getGradientForCategory } from "../data/exploreTaxonomy";
import {
  getExploreItemsCacheKey,
  getOrSetExploreItemsCached,
  peekExploreItemsCached,
} from "../lib/exploreSectionsCache";

export const Route = createFileRoute(
  "/explore/category/$categoryId/$subCategoryId",
)({
  component: SubcategoryPage,
});

function SubcategoryPage() {
  const { categoryId, subCategoryId } = Route.useParams();
  const isMobile = useIsMobile();
  const getExploreItems = useAction(api.explore.getExploreItems);
  const parentCategory = useQuery(api.ebayTaxonomy.getCategoryById, {
    categoryId,
  });
  const subcategories = useQuery(api.ebayTaxonomy.listChildCategories, {
    categoryId,
  });
  const subcategory = subcategories?.find(
    (entry: { categoryId: string }) => entry.categoryId === subCategoryId,
  );
  const itemsKey = getExploreItemsCacheKey({ categoryId: subCategoryId });
  const initialItems = peekExploreItemsCached(itemsKey);
  const hadInitialItemsRef = useRef(initialItems != null);
  const [items, setItems] = useState<ShopItem[]>(() => initialItems ?? []);
  const [isLoading, setIsLoading] = useState(() => !initialItems);
  const bannerGradient = getGradientForCategory(
    subcategory?.categoryName ?? "Category",
  );

  useEffect(() => {
    if (!subcategory) return;
    const fetchData = async () => {
      try {
        if (!hadInitialItemsRef.current) setIsLoading(true);
        const data = await getOrSetExploreItemsCached({
          key: itemsKey,
          fetcher: () =>
            getExploreItems({
              categoryId: subcategory.categoryId,
              categoryName: subcategory.categoryName,
            }),
        });
        setItems(data);
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [subcategory, getExploreItems, itemsKey]);

  if (subcategories !== undefined && !subcategory) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-bold text-foreground/80">
            Subcategory not found
          </h1>
          <Link
            to="/explore/category/$categoryId"
            params={{ categoryId }}
            className="font-bold text-primary hover:underline"
          >
            Back to Category
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
        <div className="flex items-center gap-3">
          {/* Desktop back button - mobile uses Sidebar toggle container */}
          <Link
            to="/explore/category/$categoryId"
            params={{ categoryId }}
            className="hidden rounded-full bg-black/5 p-2 text-foreground/60 transition-colors hover:bg-black/10 md:flex"
          >
            <ChevronLeft size={20} />
          </Link>
          <div className="hidden flex-col md:flex">
            <span className="text-[10px] leading-none font-black tracking-widest text-foreground/30 uppercase">
              {parentCategory?.categoryName ?? "Category"}
            </span>
            <span className="text-sm leading-tight font-bold text-foreground/90 md:text-lg">
              {subcategory?.categoryName ?? "Subcategory"}
            </span>
          </div>
        </div>

        <div className="group relative mx-4 hidden max-w-sm flex-1 md:block">
          <Search
            className="absolute top-1/2 left-4 -translate-y-1/2 text-foreground/30 transition-colors group-focus-within:text-primary"
            size={14}
          />
          <input
            type="text"
            placeholder={`Search in ${subcategory?.categoryName ?? "this subcategory"}...`}
            className="w-full rounded-full border-none bg-black/5 py-1.5 pr-4 pl-10 text-xs transition-all outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden h-8 w-8 rounded-full border border-primary/20 bg-primary/10 md:block" />
        </div>
      </header>

      <main
        className={`mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 pb-24 ${isMobile ? "pt-16" : "pt-8"}`}
      >
        {/* Banner */}
        <section className="group relative h-[200px] overflow-hidden rounded-[32px] shadow-lg shadow-black/5">
          <div
            className={`absolute inset-0 bg-gradient-to-br ${bannerGradient}`}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-center space-y-2 px-10">
            <h1 className="text-4xl font-black text-white">
              {subcategory?.categoryName ?? "Subcategory"}
            </h1>
            <p className="font-medium text-white/60">
              Curated picks sourced from eBay&apos;s marketplace.
            </p>
          </div>
        </section>

        {/* Filters/Tabs (Visual Only) */}
        <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4">
          {["All", "Trending", "New", "Sale", "Eco-Friendly"].map((tab, i) => (
            <button
              key={tab}
              className={`flex-none rounded-full px-5 py-2 text-sm font-bold transition-all ${
                i === 0
                  ? "bg-primary text-white shadow-lg shadow-primary/20"
                  : "bg-black/5 text-foreground/60 hover:bg-black/10"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Items Grid */}
        <div className="grid grid-cols-2 gap-6 md:gap-8 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading
            ? [...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="aspect-[3/4] animate-pulse rounded-[24px] bg-black/5"
                />
              ))
            : items.map((item) => (
                <Link
                  key={item.id}
                  to="."
                  search={{ productId: item.id }}
                  className="group cursor-pointer"
                >
                  <div className="relative mb-4 aspect-[3/4] overflow-hidden rounded-[24px] bg-black/5 shadow-sm transition-all duration-300 group-hover:shadow-xl">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute top-4 right-4 flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[10px] font-black shadow-lg backdrop-blur-md">
                      <Star
                        size={10}
                        className="fill-yellow-400 text-yellow-400"
                      />
                      <span>{item.rating.toFixed(1)}</span>
                    </div>
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-6 opacity-0 transition-opacity group-hover:opacity-100">
                      <div className="w-full translate-y-4 transform rounded-xl bg-white py-2.5 text-center text-xs font-bold text-black shadow-xl transition-transform group-hover:translate-y-0">
                        Quick View
                      </div>
                    </div>
                  </div>
                  <div className="space-y-0.5 px-2 text-left">
                    <h3 className="line-clamp-2 text-sm leading-tight font-bold text-foreground/90 transition-colors group-hover:text-primary">
                      {item.title}
                    </h3>
                    <p className="truncate text-[11px] font-bold tracking-wider text-foreground/40 uppercase">
                      {item.brand}
                    </p>
                    {item.price && (
                      <p className="mt-1 text-sm font-bold text-foreground/80">
                        {item.price}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
        </div>
      </main>

      <footer className="border-t border-black/5 py-12 text-center text-xs text-foreground/30">
        &copy; 2024 Sendcat. {parentCategory?.categoryName ?? "Category"}{" "}
        &rsaquo; {subcategory?.categoryName ?? "Subcategory"}
      </footer>
    </>
  );
}
