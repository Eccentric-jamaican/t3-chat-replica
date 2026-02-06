import { type ShopItem } from "../data/explore";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, CacheEntry<ShopItem[]>>();
const inflight = new Map<string, Promise<ShopItem[]>>();

export function getExploreItemsCacheKey(input: {
  section?: string;
  categoryId?: string;
}) {
  if (input.section) return `section:${input.section}`;
  if (input.categoryId) return `category:${input.categoryId}`;
  // This should never happen. Returning a fallback key would silently create cache collisions.
  throw new Error("getExploreItemsCacheKey requires section or categoryId");
}

export async function getOrSetExploreItemsCached(opts: {
  key: string;
  fetcher: () => Promise<ShopItem[]>;
  ttlMs?: number;
}): Promise<ShopItem[]> {
  const existing = peekExploreItemsCached(opts.key);
  if (existing) return existing;

  const inflightExisting = inflight.get(opts.key);
  if (inflightExisting) return inflightExisting;

  const p = (async () => {
    try {
      const value = await opts.fetcher();
      cache.set(opts.key, {
        value,
        expiresAt: Date.now() + (opts.ttlMs ?? DEFAULT_TTL_MS),
      });
      return value;
    } finally {
      inflight.delete(opts.key);
    }
  })();

  inflight.set(opts.key, p);
  return p;
}

export function peekExploreItemsCached(key: string): ShopItem[] | null {
  const existing = cache.get(key);
  if (!existing) return null;
  if (existing.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return existing.value;
}

export function clearExploreItemsCache() {
  cache.clear();
  inflight.clear();
}
