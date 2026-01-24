import { useNavigate, useRouter, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { type Product } from "../../data/mockProducts";
import { X, MessageSquare, Star, ExternalLink, Loader2, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface ProductDrawerProps {
  productId: string;
  initialData?: Product;
}

export function ProductDrawer({ productId, initialData }: ProductDrawerProps) {
  const navigate = useNavigate();
  const router = useRouter(); 
  const location = useLocation(); // Hook to get the router's current location
  const getItemDetails = useAction(api.chat.getItemDetails);
  const [product, setProduct] = useState<Product | undefined>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Prevent body scroll when drawer is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    // If we have valid initial data (like from the search bubble), use it
    if (initialData) {
      setProduct(initialData);
      setLoading(false);
      return;
    }

    // Otherwise fetch details from eBay via Convex (handles page refreshes)
    const fetchDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getItemDetails({ itemId: productId });
        
        // Map eBay full item to our Product type
        const mappedProduct: Product = {
          id: data.itemId,
          title: data.title,
          priceRange: `${data.price?.currency} ${data.price?.value}`,
          image: data.image?.imageUrl || data.additionalImages?.[0]?.imageUrl || "",
          url: data.itemWebUrl,
          sellerName: data.seller?.username,
          sellerFeedback: data.seller?.feedbackPercentage ? `${data.seller.feedbackPercentage}%` : undefined,
          condition: data.condition,
          rating: data.product?.averageRating,
          reviews: data.product?.reviewCount,
        };
        
        setProduct(mappedProduct);
      } catch (err) {
        console.error("Failed to fetch product details:", err);
        setError("We couldn't retrieve the details for this item right now.");
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [productId, initialData, getItemDetails]);

  const handleClose = () => {
    // Check if we can go back in history (if the drawer was opened via push)
    if (window.history.length > 2) {
      window.history.back();
    } else {
      // Fallback: stay on current location but remove param
      navigate({
        to: location.pathname,
        search: (old: any) => ({ ...old, productId: undefined }),
        replace: true
      });
    }
  };

  if (!productId) return null;

  return (
    <div className="fixed inset-0 z-[600] flex justify-end isolate">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[3px]"
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
          {loading ? (
             <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
               <Loader2 className="animate-spin" size={32} />
               <p className="text-sm font-medium">Fetching details from eBay...</p>
             </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
              <div className="bg-red-50 p-3 rounded-full text-red-500">
                <Info size={32} />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">Oops!</h3>
              <p className="text-zinc-600 max-w-xs">{error}</p>
              <button 
                onClick={handleClose}
                className="mt-4 px-6 py-2 bg-zinc-900 text-white rounded-full text-sm font-medium"
              >
                Go back
              </button>
            </div>
          ) : product ? (
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
                {product.url && (
                    <a 
                      href={product.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors"
                    >
                      <ExternalLink size={16} />
                      View original listing on eBay
                    </a>
                )}
              </div>

              {/* Right Column: Info */}
              <div className="space-y-8">
                 {/* Header Info */}
                 <div className="space-y-4">
                   <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                     {product.title}
                   </h1>
                   
                   <div className="flex items-center gap-4 text-sm">
                     {product.rating ? (
                        <div className="flex items-center gap-1 text-yellow-500 font-bold">
                          <Star size={16} fill="currentColor" />
                          <span className="font-medium text-gray-900">{product.rating.toFixed(1)}</span>
                          <span className="text-gray-400 font-normal">({product.reviews} reviews)</span>
                        </div>
                     ) : (
                        <div className="flex items-center gap-1 text-zinc-400">
                          <Star size={16} />
                          <span>No ratings yet</span>
                        </div>
                     )}
                     <span className="text-gray-400">|</span>
                     <span className="text-green-600 font-medium">Available</span>
                   </div>

                   <div className="rounded-xl bg-gray-50 p-4 border border-gray-100">
                      <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Price</div>
                      <div className="text-3xl font-bold text-gray-900">{product.priceRange}</div>
                      <div className="text-sm text-zinc-500 mt-1 uppercase text-[10px] tracking-widest font-bold">Condition: {product.condition}</div>
                   </div>
                 </div>

                 {/* Seller Info */}
                 <div className="flex items-center gap-3 p-4 rounded-xl border border-zinc-100 bg-white shadow-sm">
                    <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 font-bold">
                      {product.supplier?.logo || (product.sellerName?.charAt(0).toUpperCase() || 'E')}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 text-sm">{product.supplier?.name || product.sellerName}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {product.supplier ? (
                          <span>{product.supplier.years} years</span>
                        ) : product.sellerFeedback ? (
                          <span className="text-t3-berry-deep font-bold">{product.sellerFeedback} Positive</span>
                        ) : null}
                        <span>•</span>
                        <span>Verified Seller</span>
                      </div>
                    </div>
                 </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 z-10 border-t border-gray-100 bg-white p-4 backdrop-blur-md">
           <div className="flex gap-4 max-w-sm ml-auto">
             <button className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
               <MessageSquare size={18} />
               Ask AI
             </button>
             <button 
                onClick={() => product?.url && window.open(product.url, '_blank')}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/10 hover:bg-black transition-colors"
             >
               <ExternalLink size={18} />
               Check on eBay
             </button>
           </div>
        </div>
      </motion.div>
    </div>
  );
}
