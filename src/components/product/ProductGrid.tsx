import { useEffect, useMemo, useState } from "react";
import { type Product } from "../../data/mockProducts";
import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  products?: Product[];
  onViewMore?: () => void;
  onOpenExpanded?: (products: Product[]) => void;
  title?: string;
  subtitle?: string;
  hideHeader?: boolean;
  showSourceFilters?: boolean;
  maxItems?: number;
}

export function ProductGrid({ 
  products = [], 
  onViewMore, 
  onOpenExpanded,
  title = "Recommended for you",
  subtitle = "Based on your recent search activity",
  hideHeader = false,
  showSourceFilters = false,
  maxItems
}: ProductGridProps) {
  const [sourceFilter, setSourceFilter] = useState<"all" | "ebay" | "global">(
    "all",
  );
  const hasSource = useMemo(
    () => products.some((product) => !!product.source),
    [products],
  );

  useEffect(() => {
    if (!showSourceFilters || !hasSource) {
      if (sourceFilter !== "all") setSourceFilter("all");
      return;
    }
    if (
      sourceFilter !== "all" &&
      !products.some((p) => p.source === sourceFilter)
    ) {
      setSourceFilter("all");
    }
  }, [showSourceFilters, hasSource, products, sourceFilter]);

  const filteredProducts = useMemo(() => {
    if (!showSourceFilters || !hasSource || sourceFilter === "all") {
      return products;
    }
    return products.filter((product) => product.source === sourceFilter);
  }, [products, showSourceFilters, hasSource, sourceFilter]);
  const displayLimit =
    typeof maxItems === "number" && Number.isFinite(maxItems)
      ? Math.max(1, Math.floor(maxItems))
      : null;
  const visibleProducts = useMemo(() => {
    if (!displayLimit) return filteredProducts;
    return filteredProducts.slice(0, displayLimit);
  }, [filteredProducts, displayLimit]);
  const showViewMoreButton =
    !!(onViewMore || onOpenExpanded) &&
    (filteredProducts.length > visibleProducts.length ||
      (!!onOpenExpanded && filteredProducts.length > 4));

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
      {!hideHeader && (
        <div className="mb-4 sm:mb-6 px-2 sm:px-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-xs sm:text-sm text-gray-500">{subtitle}</p>
        </div>
      )}

      {showSourceFilters && hasSource && (
        <div className="mb-4 flex flex-wrap items-center gap-2 px-2 sm:px-0">
          {[
            { id: "all", label: "All" },
            { id: "ebay", label: "eBay" },
            { id: "global", label: "Global sites" },
          ].map((chip) => (
            <button
              key={chip.id}
              onClick={() =>
                setSourceFilter(chip.id as "all" | "ebay" | "global")
              }
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                sourceFilter === chip.id
                  ? "border-t3-berry/30 bg-t3-berry/10 text-t3-berry"
                  : "border-black/5 bg-black/5 text-gray-600 hover:bg-black/10"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {visibleProducts.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {showViewMoreButton && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() =>
              onOpenExpanded
                ? onOpenExpanded(products)
                : onViewMore?.()
            }
            className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-gray-900 border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
          >
            View more products
          </button>
        </div>
      )}
    </div>
  );
}
