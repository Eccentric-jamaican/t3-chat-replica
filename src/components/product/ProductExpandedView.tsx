import { motion } from "framer-motion";
import { X, LayoutGrid, List } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type Product } from "../../data/mockProducts";
import { ProductCard } from "./ProductCard";
import { ProductTable } from "./ProductTable";
import { Checkbox } from "../ui/checkbox";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../ui/pagination";

interface ProductExpandedViewProps {
  products: Product[];
  onClose: () => void;
  onProductClick?: (id: string) => void;
  onSelect?: (id: string) => void;
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
}

export function ProductExpandedView({
  products = [],
  onClose,
  onProductClick,
  onSelect,
  selectedIds,
  onToggleSelection,
}: ProductExpandedViewProps) {
  const [view, setView] = useState<"grid" | "table">("grid");
  const [page, setPage] = useState(1);
  const pageSize = view === "grid" ? 12 : 10;
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [view, products.length]);

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return products.slice(start, start + pageSize);
  }, [page, pageSize, products]);

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const items: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) items.push("ellipsis");
    for (let i = start; i <= end; i += 1) items.push(i);
    if (end < totalPages - 1) items.push("ellipsis");
    items.push(totalPages);

    return items;
  }, [page, totalPages]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[500] flex w-full flex-col bg-white"
    >
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-100 bg-white/80 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-gray-900">Search results</h2>
          <div className="flex rounded-lg bg-gray-100 p-1">
            <button
              aria-label="Show grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
              className={`rounded-md p-1.5 transition-all ${view === "grid" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              <LayoutGrid size={18} />
            </button>
            <button
              aria-label="Show list view"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              className={`rounded-md p-1.5 transition-all ${view === "table" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              <List size={18} />
            </button>
          </div>
        </div>
        <button
          aria-label="Close"
          onClick={onClose}
          className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X size={24} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-32">
        {view === "grid" ? (
          <div className="mx-auto max-w-7xl p-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {paginatedProducts.map((product) => (
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
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <ProductTable
              products={paginatedProducts}
              selectedIds={selectedIds}
              onToggleSelection={onToggleSelection}
              onProductClick={onSelect || onProductClick || (() => {})}
            />
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-6 pb-10">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={page === 1}
                  />
                </PaginationItem>

                {paginationItems.map((item, index) => (
                  <PaginationItem key={`${item}-${index}`}>
                    {item === "ellipsis" ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationLink
                        isActive={item === page}
                        onClick={() => setPage(item)}
                      >
                        {item}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}

                <PaginationItem>
                  <PaginationNext
                    onClick={() =>
                      setPage((prev) => Math.min(totalPages, prev + 1))
                    }
                    disabled={page === totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </motion.div>
  );
}
