import { type Product } from "../data/mockProducts";
import { Checkbox } from "@/components/ui/checkbox";

interface ProductTableProps {
  products: Product[];
  selectedIds: string[];
  onToggleSelection: (id: string) => void;
  onProductClick: (id: string) => void;
}

export function ProductTable({ products, selectedIds, onToggleSelection, onProductClick }: ProductTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-gray-50/80 backdrop-blur-sm border-b border-gray-200">
          <tr>
            <th className="w-12 p-4">
              {/* Header checkbox would go here for select all */}
            </th>
            <th className="p-4 font-semibold text-gray-900">Product</th>
            <th className="p-4 font-semibold text-gray-900">Supplier</th>
            <th className="p-4 font-semibold text-gray-900">Price</th>
            <th className="p-4 font-semibold text-gray-900">MOQ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {products.map((product) => (
            <tr 
              key={product.id}
              className="group hover:bg-gray-50/50 transition-colors"
            >
              <td className="p-4">
                <Checkbox 
                  checked={selectedIds.includes(product.id)}
                  onCheckedChange={() => onToggleSelection(product.id)}
                  className="rounded-md h-5 w-5 border-gray-300 data-[state=checked]:bg-[#a23b67] data-[state=checked]:border-[#a23b67]"
                />
              </td>
              <td className="p-4">
                <div 
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => onProductClick(product.id)}
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-gray-100 border border-gray-200">
                    <img src={product.image} alt={`${product.title} image`} className="h-full w-full object-cover" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900 group-hover:text-[#a23b67] transition-colors leading-tight line-clamp-1">
                      {product.title}
                    </span>
                    {product.badge && (
                      <span className="text-[10px] text-[#008a6c] font-semibold">{product.badge}</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="p-4">
                <div className="flex items-center gap-2 text-gray-600">
                  <div className="h-5 w-5 flex items-center justify-center rounded bg-gray-100 text-[10px] font-bold">
                    {product.supplier.logo}
                  </div>
                  <span className="truncate max-w-[120px]">{product.supplier.name}</span>
                  <span className="text-gray-300 text-[10px] shrink-0 font-medium">{product.supplier.country} {product.supplier.years}yrs</span>
                </div>
              </td>
              <td className="p-4">
                <span className="font-bold text-gray-900">{product.priceRange}</span>
              </td>
              <td className="p-4">
                <span className="text-gray-500 whitespace-nowrap">{product.moq}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
