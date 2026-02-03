import { type Product } from "../../data/mockProducts";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getProductImageFallback,
  getProductImageUrl,
} from "./productImage";

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
            <th className="p-4 font-semibold text-gray-900">Seller</th>
            <th className="p-4 font-semibold text-gray-900">Price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {products.map((product) => {
            const sourceLabel =
              product.source === "global"
                ? "Global sites"
                : product.source === "ebay"
                  ? "eBay"
                  : null;
            const merchantLabel =
              product.merchantName ||
              product.merchantDomain ||
              product.supplier?.name ||
              product.sellerName ||
              "Unknown merchant";
            const merchantFavicon = product.merchantDomain
              ? `https://www.google.com/s2/favicons?domain=${product.merchantDomain}&sz=32`
              : null;
            const supplierLogo = product.supplier?.logo;
            const supplierLogoIsUrl =
              typeof supplierLogo === "string" &&
              /^(https?:)?\/\//i.test(supplierLogo);
            const priceLabel = product.priceRange || product.price || "-";
            const imageFallback = getProductImageFallback(product);
            const imageSrc = getProductImageUrl(product) || imageFallback;

            return (
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
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={`${product.title} image`}
                        className="h-full w-full object-cover"
                        onError={(event) => {
                          if (!imageFallback) {
                            event.currentTarget.classList.add("hidden");
                            return;
                          }
                          const target = event.currentTarget;
                          if (target.src === imageFallback) return;
                          target.src = imageFallback;
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gray-400">
                        —
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900 group-hover:text-[#a23b67] transition-colors leading-tight line-clamp-1">
                      {product.title}
                    </span>
                    {(sourceLabel || product.badge || product.condition) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {sourceLabel && (
                          <span className="rounded-md border border-black/5 bg-black/5 px-1.5 py-0.5 font-semibold text-gray-600">
                            {sourceLabel}
                          </span>
                        )}
                        {(product.badge || product.condition) && (
                          <span className="rounded-md bg-[#e6f4f1] px-1.5 py-0.5 font-semibold text-[#008a6c]">
                            {product.badge || product.condition}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="p-4">
                <div className="flex items-center gap-2 text-gray-600">
                  {merchantFavicon ? (
                    <img
                      src={merchantFavicon}
                      alt=""
                      className="h-5 w-5 rounded"
                    />
                  ) : supplierLogoIsUrl ? (
                    <img
                      src={supplierLogo}
                      alt=""
                      className="h-5 w-5 rounded object-cover"
                    />
                  ) : (
                    <div className="h-5 w-5 flex items-center justify-center rounded bg-gray-100 text-[10px] font-bold">
                      {(typeof supplierLogo === "string" &&
                      !supplierLogoIsUrl
                        ? supplierLogo
                        : "") ||
                        (merchantLabel?.charAt(0).toUpperCase() || "E")}
                    </div>
                  )}
                  <span className="truncate max-w-[120px]">
                    {merchantLabel}
                  </span>
                  {product.supplier && (
                    <span className="text-gray-300 text-[10px] shrink-0 font-medium">{product.supplier.country} {product.supplier.years}yrs</span>
                  )}
                  {product.sellerFeedback && (
                    <span className="text-t3-berry-deep text-[10px] shrink-0 font-bold">{product.sellerFeedback}</span>
                  )}
                </div>
              </td>
              <td className="p-4">
                <span className="font-bold text-gray-900">{priceLabel}</span>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
