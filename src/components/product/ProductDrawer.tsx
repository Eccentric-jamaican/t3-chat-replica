import { useNavigate, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { type Product } from "../../data/mockProducts";
import {
  X,
  MessageSquare,
  Star,
  ExternalLink,
  Loader2,
  Info,
  Heart,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { cn } from "../../lib/utils";
import {
  getProductImageFallback,
  getProductImageUrl,
} from "./productImage";
import { FavoriteListSelector } from "./FavoriteListSelector";
import { buildEpnUrl, isEbayUrl } from "../../lib/affiliate";
import { trackEvent } from "../../lib/analytics";
import { getCachedProductDetails, getOrSetProductDetails } from "../../lib/productDetailsCache";
import { mapEbayItemDetailsToProduct } from "../../lib/mapEbayItemDetailsToProduct";

interface ProductDrawerProps {
  productId: string;
  initialData?: Product;
}

export function ProductDrawer({ productId, initialData }: ProductDrawerProps) {
  const navigate = useNavigate();
  const location = useLocation(); // Hook to get the router's current location
  const getItemDetails = useAction(api.chat.getItemDetails);
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = localStorage.getItem("sendcat_session_id");
    if (saved) return saved;
    const newId = crypto.randomUUID();
    localStorage.setItem("sendcat_session_id", newId);
    return newId;
  });
  const epnConfig = useQuery(api.affiliate.getEpnConfig, {
    sessionId: sessionId || undefined,
  });
  const [product, setProduct] = useState<Product | undefined>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const trackedProductRef = useRef<string | null>(null);
  const isGlobal = product?.source === "global";
  const merchantLabel =
    product?.merchantName ||
    product?.merchantDomain ||
    product?.supplier?.name ||
    product?.sellerName ||
    "Unknown merchant";
  const merchantFavicon = product?.merchantDomain
    ? `https://www.google.com/s2/favicons?domain=${product.merchantDomain}&sz=32`
    : null;
  const supplierLogo = product?.supplier?.logo;
  const supplierLogoIsUrl =
    typeof supplierLogo === "string" && /^(https?:)?\/\//i.test(supplierLogo);
  const priceLabel = product?.priceRange || product?.price || "-";
  const imageFallback = product ? getProductImageFallback(product) : "";
  const imageSrc = product
    ? getProductImageUrl(product) || imageFallback
    : "";
  const primaryUrl = product?.productUrl || product?.url;
  const isEbayListing = isEbayUrl(primaryUrl);
  const affiliateUrl = isEbayListing
    ? buildEpnUrl(primaryUrl || "", epnConfig)
    : primaryUrl;
  const isGoogleShoppingUrl = (url?: string) => {
    if (!url) return false;
    try {
      const host = new URL(url).hostname;
      return (
        host.includes("google.com") ||
        host.includes("shopping.google.") ||
        host.includes("googleusercontent.com")
      );
    } catch (err) {
      return false;
    }
  };
  const isGoogleShopping = isGlobal && isGoogleShoppingUrl(primaryUrl);
  const primaryLabel = isGlobal
    ? isGoogleShopping
      ? "View buying options"
      : "Open on merchant"
    : "Check on eBay";
  const listingLabel = isGlobal
    ? isGoogleShopping
      ? "View on Google Shopping"
      : "View listing on merchant"
    : "View original listing on eBay";

  useEffect(() => {
    // Prevent body scroll when drawer is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  useEffect(() => {
    if (!product || trackedProductRef.current === product.id) return;
    trackedProductRef.current = product.id;
    trackEvent("product_drawer_open", {
      product_id: product.id,
      source: product.source,
      price: priceLabel,
      merchant_domain: product.merchantDomain,
    });
  }, [priceLabel, product]);

  useEffect(() => {
    // If we have valid initial data (like from the search bubble), use it
    if (initialData) {
      setProduct(initialData);
      setLoading(false);
      return;
    }

    const cached = getCachedProductDetails(productId);
    if (cached) {
      setProduct(cached);
      setLoading(false);
      return;
    }

    // Otherwise fetch details from eBay via Convex (handles page refreshes).
    // Cache results to speed up reopen / back-and-forth navigation.
    const fetchDetails = async () => {
      try {
        setLoading(true);
        setError(null);

        const mappedProduct = await getOrSetProductDetails(productId, async () => {
          const data = await getItemDetails({ itemId: productId });
          return mapEbayItemDetailsToProduct(data) satisfies Product;
        });

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

  const favoritesSelection = useQuery(api.favorites.getUserFavoritesIds);
  const isFavorited = favoritesSelection?.some(
    (f: any) => f.externalId === productId && f.type === "product",
  );

  const handleClose = () => {
    // Check if we can go back in history (if the drawer was opened via push)
    if (window.history.length > 2) {
      window.history.back();
    } else {
      // Fallback: stay on current location but remove param
      navigate({
        to: location.pathname,
        search: (old: any) => ({ ...old, productId: undefined }),
        replace: true,
      });
    }
  };

  const handleVisitMerchant = () => {
    if (!product) return;
    trackEvent("visit_merchant_click", {
      product_id: product.id,
      source: product.source,
      merchant_domain: product.merchantDomain,
      is_affiliate: isEbayListing,
    });
  };

  if (!productId) return null;

  return (
    <div className="fixed inset-0 isolate z-[600] flex justify-end">
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
        className="relative flex h-full w-full max-w-4xl flex-col bg-white pt-[env(safe-area-inset-top)] shadow-2xl"
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/80 px-6 py-4 backdrop-blur-md">
          <h2 className="text-lg font-semibold text-gray-900">
            Product details
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
              <Loader2 className="animate-spin" size={32} />
              <p className="text-sm font-medium">
                Fetching details from eBay...
              </p>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="rounded-full bg-red-50 p-3 text-red-500">
                <Info size={32} />
              </div>
              <h3 className="text-lg font-bold text-zinc-900">Oops!</h3>
              <p className="max-w-xs text-zinc-600">{error}</p>
              <button
                onClick={handleClose}
                className="mt-4 rounded-full bg-zinc-900 px-6 py-2 text-sm font-medium text-white"
              >
                Go back
              </button>
            </div>
          ) : product ? (
            <div className="grid grid-cols-1 gap-8 p-6 md:grid-cols-2 md:p-8">
              {/* Left Column: Gallery */}
              <div className="space-y-4">
                <motion.div
                  layoutId={`image-${product.id}`}
                  className="relative aspect-square w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50"
                >
                  <img
                    src={imageSrc}
                    alt={product.title}
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
                  <FavoriteListSelector
                    product={product}
                    trigger={
                      <button
                        className={cn(
                          "absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm transition-all hover:bg-white hover:scale-110 shadow-md",
                          isFavorited ? "text-primary" : "text-gray-400",
                        )}
                      >
                        <Heart
                          size={20}
                          fill={isFavorited ? "currentColor" : "none"}
                          className="transition-colors"
                        />
                      </button>
                    }
                  />
                </motion.div>
                {primaryUrl && (
                  <a
                    href={affiliateUrl}
                    target="_blank"
                    rel={`noopener noreferrer${isEbayListing ? " sponsored" : ""}`}
                    onClick={handleVisitMerchant}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 py-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
                  >
                    <ExternalLink size={16} />
                    {listingLabel}
                  </a>
                )}
              </div>

              {/* Right Column: Info */}
              <div className="space-y-8">
                {/* Header Info */}
                <div className="space-y-4">
                  <h1 className="text-2xl leading-tight font-bold text-gray-900">
                    {product.title}
                  </h1>

                  <div className="flex items-center gap-4 text-sm">
                    {product.rating ? (
                      <div className="flex items-center gap-1 font-bold text-yellow-500">
                        <Star size={16} fill="currentColor" />
                        <span className="font-medium text-gray-900">
                          {product.rating.toFixed(1)}
                        </span>
                        <span className="font-normal text-gray-400">
                          ({product.reviews} reviews)
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-zinc-400">
                        <Star size={16} />
                        <span>No ratings yet</span>
                      </div>
                    )}
                    <span className="text-gray-400">|</span>
                    <span className="font-medium text-green-600">
                      Available
                    </span>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="mb-1 text-xs font-medium tracking-wider text-gray-500 uppercase">
                      Price
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                      {priceLabel}
                    </div>
                    {product.condition ? (
                      <div className="mt-1 text-sm text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                        Condition: {product.condition}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Seller Info */}
                <div className="flex items-center gap-3 rounded-xl border border-zinc-100 bg-white p-4 shadow-sm">
                  {merchantFavicon ? (
                    <img
                      src={merchantFavicon}
                      alt=""
                      className="h-10 w-10 rounded-lg"
                    />
                  ) : supplierLogoIsUrl ? (
                    <img
                      src={supplierLogo}
                      alt=""
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 font-bold text-zinc-600">
                      {(typeof supplierLogo === "string" &&
                      !supplierLogoIsUrl
                        ? supplierLogo
                        : "") ||
                        merchantLabel?.charAt(0).toUpperCase() ||
                        "E"}
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {merchantLabel}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {product.supplier ? (
                        <span>{product.supplier.years} years</span>
                      ) : product.sellerFeedback ? (
                        <span className="font-bold text-t3-berry-deep">
                          {product.sellerFeedback} Positive
                        </span>
                      ) : null}
                      <span>•</span>
                      <span>
                        {isGlobal ? "Verified Merchant" : "Verified Seller"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 z-10 border-t border-gray-100 bg-white p-4 backdrop-blur-md">
          {isEbayListing && affiliateUrl ? (
            <div className="mb-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-[11px] font-medium text-zinc-500">
              As an eBay Partner, we may be compensated for purchases.
            </div>
          ) : null}
          <div className="ml-auto flex max-w-sm gap-4">
            <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">
              <MessageSquare size={18} />
              Ask AI
            </button>
            {affiliateUrl && (
              <a
                href={affiliateUrl}
                target="_blank"
                rel={`noopener noreferrer${isEbayListing ? " sponsored" : ""}`}
                onClick={handleVisitMerchant}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/10 transition-colors hover:bg-black"
              >
                <ExternalLink size={18} />
                {primaryLabel}
              </a>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
