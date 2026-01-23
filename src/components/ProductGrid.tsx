import { MOCK_PRODUCTS } from "../data/mockProducts";
import { ProductCard } from "./ProductCard";
import { useIsMobile } from "../hooks/useIsMobile";

interface ProductGridProps {
  onViewMore?: () => void;
}

export function ProductGrid({ onViewMore }: ProductGridProps) {
  const isMobile = useIsMobile();

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8">
      <div className="mb-4 sm:mb-6 px-2 sm:px-0">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900">Recommended for you</h2>
        <p className="text-xs sm:text-sm text-gray-500">Based on your recent search activity</p>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {MOCK_PRODUCTS.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {onViewMore && (
        <div className="mt-8 flex justify-center">
          <button
            onClick={onViewMore}
            className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-gray-900 border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors"
          >
            View more products
          </button>
        </div>
      )}
    </div>
  );
}
