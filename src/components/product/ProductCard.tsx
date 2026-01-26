import { useNavigate } from "@tanstack/react-router";
import { type Product } from "../../data/mockProducts";
import { motion } from "framer-motion";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    // Add productId to search params to open the drawer
    navigate({ to: ".", search: { productId: product.id } });
  };

  return (
    <button
      onClick={handleClick}
      className="group block text-left w-full"
    >
      <div className="flex flex-col gap-1.5 sm:gap-2 p-2 sm:p-3 rounded-xl transition-all duration-300 hover:bg-white/40 hover:shadow-sm">
        {/* Image Container */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-gray-100">
          <motion.img
            layoutId={`image-${product.id}`}
            src={product.image}
            alt={product.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-0.5 sm:gap-1">
          {(product.badge || product.condition) && (
            <div className="w-fit rounded-md bg-[#e6f4f1] px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold text-[#008a6c]">
              {product.badge || product.condition}
            </div>
          )}
          
          <h3 className="line-clamp-2 text-xs sm:text-sm font-medium text-gray-900 leading-snug group-hover:text-primary transition-colors">
            {product.title}
          </h3>

          <div className="mt-0.5 sm:mt-1 flex items-baseline gap-2">
            <span className="text-sm sm:text-base font-bold text-gray-900">{product.priceRange}</span>
          </div>
          
          <span className="text-[10px] sm:text-xs text-gray-500">{product.moq}</span>

          {/* Supplier/Seller Meta */}
          <div className="mt-1.5 sm:mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-1.5 sm:pt-2 text-[10px] sm:text-xs text-gray-500">
             <div className="flex h-3.5 w-3.5 sm:h-4 sm:w-4 items-center justify-center rounded-sm bg-gray-200 text-[9px] sm:text-[10px] font-bold text-gray-600">
               {product.supplier?.logo || (product.sellerName?.charAt(0).toUpperCase() || 'E')}
             </div>
             <span className="truncate">{product.supplier?.name || product.sellerName}</span>
             {product.supplier && (
                <span className="shrink-0 text-gray-400 hidden sm:inline">{product.supplier.country} {product.supplier.years}yrs</span>
             )}
             {product.sellerFeedback && (
                <span className="shrink-0 text-t3-berry-deep font-semibold">{product.sellerFeedback} positive</span>
             )}
          </div>
        </div>
      </div>
    </button>
  );
}
