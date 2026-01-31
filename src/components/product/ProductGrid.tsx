import { type Product } from "../../data/mockProducts";
import { ProductCard } from "./ProductCard";

interface ProductGridProps {
  products?: Product[];
  onViewMore?: () => void;
  onOpenExpanded?: (products: Product[]) => void;
  title?: string;
  subtitle?: string;
  hideHeader?: boolean;
}

export function ProductGrid({ 
  products = [], 
  onViewMore, 
  onOpenExpanded,
  title = "Recommended for you",
  subtitle = "Based on your recent search activity",
  hideHeader = false
}: ProductGridProps) {

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
      {!hideHeader && (
        <div className="mb-4 sm:mb-6 px-2 sm:px-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-xs sm:text-sm text-gray-500">{subtitle}</p>
        </div>
      )}
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {(onViewMore || (onOpenExpanded && products.length > 4)) && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => onOpenExpanded ? onOpenExpanded(products) : onViewMore?.()}
            className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-gray-900 border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
          >
            View more products
          </button>
        </div>
      )}
    </div>
  );
}
