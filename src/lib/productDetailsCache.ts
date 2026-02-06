import type { Product } from "../data/mockProducts";

type CacheEntry = {
  expiresAt: number;
  value: Product;
};

type InflightEntry = {
  expiresAt: number;
  promise: Promise<Product>;
};

const DETAILS_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 200;

// In-memory cache is enough to speed up "open drawer, close, reopen" flows.
// If you later want persistence across reloads, swap this to sessionStorage.
const productDetailsCache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();

export function getCachedProductDetails(productId: string): Product | null {
  const entry = productDetailsCache.get(productId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    productDetailsCache.delete(productId);
    return null;
  }

  // Refresh recency for an LRU-ish eviction policy.
  productDetailsCache.delete(productId);
  productDetailsCache.set(productId, entry);

  return entry.value;
}

export function setCachedProductDetails(productId: string, value: Product) {
  productDetailsCache.set(productId, {
    value,
    expiresAt: Date.now() + DETAILS_TTL_MS,
  });

  // Prevent unbounded growth for long-lived tabs with heavy browsing.
  while (productDetailsCache.size > MAX_ENTRIES) {
    const oldestKey = productDetailsCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    productDetailsCache.delete(oldestKey);
  }
}

/**
 * Dedup concurrent fetches for the same productId.
 * `fetcher` must return a fully mapped `Product` object.
 */
export function getOrSetProductDetails(
  productId: string,
  fetcher: () => Promise<Product>,
): Promise<Product> {
  const cached = getCachedProductDetails(productId);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(productId);
  if (existing && Date.now() <= existing.expiresAt) return existing.promise;

  const promise = fetcher().then((value) => {
    setCachedProductDetails(productId, value);
    inflight.delete(productId);
    return value;
  }).catch((err) => {
    inflight.delete(productId);
    throw err;
  });

  inflight.set(productId, { promise, expiresAt: Date.now() + DETAILS_TTL_MS });
  return promise;
}
