import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { MOCK_PRODUCTS } from "../data/mockProducts";
import { X, MessageSquare, Send, Star } from "lucide-react";
import { useEffect } from "react";

interface ProductDrawerProps {
  productId: string;
}

export function ProductDrawer({ productId }: ProductDrawerProps) {
  const navigate = useNavigate();
  const product = MOCK_PRODUCTS.find((p) => p.id === productId);

  useEffect(() => {
    // Prevent body scroll when drawer is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  if (!product) return null;

  const handleClose = () => {
    // Clear the productId search param to close the drawer
    navigate({ to: ".", search: {} });
  };

  return (
    <div className="fixed inset-0 z-[600] flex justify-end isolate">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
      />

      {/* Drawer */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative h-full w-full max-w-4xl bg-white shadow-2xl flex flex-col pt-[env(safe-area-inset-top)]"
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/80 px-6 py-4 backdrop-blur-md">
          <h2 className="text-lg font-semibold text-gray-900">Product details</h2>
          <button
            onClick={handleClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-6 md:p-8">
            {/* Left Column: Gallery */}
            <div className="space-y-4">
              <motion.div
                layoutId={`image-${product.id}`}
                className="aspect-square w-full overflow-hidden rounded-2xl bg-gray-50 border border-gray-100"
              >
                <img
                  src={product.image}
                  alt={product.title}
                  className="h-full w-full object-cover"
                />
              </motion.div>
              <div className="grid grid-cols-4 gap-2">
                 {/* Mock thumbnails */}
                 {[...Array(3)].map((_, i) => (
                   <div key={i} className="aspect-square rounded-lg bg-gray-100 border border-gray-200 overflow-hidden opacity-60"></div>
                 ))}
              </div>
            </div>

            {/* Right Column: Info */}
            <div className="space-y-8">
               {/* Header Info */}
               <div className="space-y-4">
                 <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                   {product.title}
                 </h1>
                 
                 <div className="flex items-center gap-4 text-sm">
                   <div className="flex items-center gap-1 text-yellow-500">
                     <Star size={16} fill="currentColor" />
                     <span className="font-medium text-gray-900">{product.rating}</span>
                   </div>
                   <span className="text-gray-400">|</span>
                   <span className="text-gray-500">{product.reviews} Reviews</span>
                   <span className="text-gray-400">|</span>
                   <span className="text-green-600 font-medium">In Stock</span>
                 </div>

                 <div className="rounded-xl bg-gray-50 p-4 border border-gray-100">
                    <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Price Range</div>
                    <div className="text-3xl font-bold text-gray-900">{product.priceRange}</div>
                    <div className="text-sm text-gray-500 mt-1">Min. Order: {product.moq}</div>
                 </div>
               </div>

               {/* Variations Mock */}
               <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Variations</h3>
                  <div className="flex flex-wrap gap-2">
                    {["Small", "Medium", "Large"].map(opt => (
                      <button key={opt} className="px-4 py-2 rounded-full border border-gray-200 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900">
                        {opt}
                      </button>
                    ))}
                  </div>
               </div>

               {/* Attributes Table */}
               <div>
                 <h3 className="text-sm font-semibold text-gray-900 mb-3">Key Attributes</h3>
                 <div className="overflow-hidden rounded-lg border border-gray-200 text-sm">
                   <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50">
                     <div className="p-3 font-medium text-gray-500">Material</div>
                     <div className="p-3 text-gray-900 border-l border-gray-200 bg-white">Eco-friendly blend</div>
                   </div>
                   <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50">
                     <div className="p-3 font-medium text-gray-500">Style</div>
                     <div className="p-3 text-gray-900 border-l border-gray-200 bg-white">Modern Industrial</div>
                   </div>
                   <div className="grid grid-cols-2 bg-gray-50">
                     <div className="p-3 font-medium text-gray-500">Origin</div>
                     <div className="p-3 text-gray-900 border-l border-gray-200 bg-white">{product.supplier.country}</div>
                   </div>
                 </div>
               </div>

               {/* Supplier Info */}
               <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 bg-white shadow-sm">
                  <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 font-bold">
                    {product.supplier.logo}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 text-sm">{product.supplier.name}</div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{product.supplier.years} years</span>
                      <span>Verified Supplier</span>
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 z-10 border-t border-gray-100 bg-white p-4 backdrop-blur-md">
           <div className="flex gap-4 max-w-sm ml-auto">
             <button className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
               <MessageSquare size={18} />
               Chat now
             </button>
             <button className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#a23b67] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-900/10 hover:bg-[#8e335a] transition-colors">
               <Send size={18} />
               Send inquiry
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
