import { motion } from "framer-motion";
import { X, LayoutGrid, List } from "lucide-react";
import { useState } from "react";
import { type Product } from "../../data/mockProducts";
import { ProductCard } from "./ProductCard";
import { ProductTable } from "./ProductTable";
import { Checkbox } from "../ui/checkbox";

interface ProductExpandedViewProps {
  products: Product[];
  onClose: () => void;
  onProductClick: (id: string) => void;
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
}

export function ProductExpandedView({ 
  products = [],
  onClose, 
  onProductClick, 
  selectedIds, 
  onToggleSelection
}: ProductExpandedViewProps) {
  const [view, setView] = useState<"grid" | "table">("grid");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] bg-white flex flex-col w-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-4">
           <h2 className="text-xl font-bold text-gray-900">Search results</h2>
           <div className="flex bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setView("grid")}
                className={`p-1.5 rounded-md transition-all ${view === "grid" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setView("table")}
                className={`p-1.5 rounded-md transition-all ${view === "table" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                <List size={18} />
              </button>
           </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-32">
        {view === "grid" ? (
          <div className="max-w-7xl mx-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {products.map((product) => (
                <div key={product.id} className="relative">
                   <div
                     className="absolute top-4 left-4 z-10"
                     onClick={(e) => e.stopPropagation()}
                   >
                      <Checkbox
                        checked={selectedIds.includes(product.id)}
                        onCheckedChange={() => onToggleSelection(product.id)}
                      />
                   </div>
                   <ProductCard product={product} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6">
            <ProductTable 
              products={products} 
              selectedIds={selectedIds}
              onToggleSelection={onToggleSelection}
              onProductClick={onProductClick}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
