type ProductSearchCacheKeyInput = {
  query: string;
  limit?: number;
  categoryId?: string;
  categoryName?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  shipping?: string;
  sellerRating?: number;
  location?: string;
  marketplaceId?: string;
};

export function normalizeToolCacheText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeOptionalText(value?: string) {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function normalizeOptionalNumber(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(value);
}

export function buildProductSearchCacheKey(input: ProductSearchCacheKeyInput) {
  return [
    ["q", normalizeToolCacheText(input.query)],
    ["limit", normalizeOptionalNumber(input.limit)],
    ["categoryId", normalizeOptionalText(input.categoryId)],
    ["categoryName", normalizeOptionalText(input.categoryName)],
    ["minPrice", normalizeOptionalNumber(input.minPrice)],
    ["maxPrice", normalizeOptionalNumber(input.maxPrice)],
    ["condition", normalizeOptionalText(input.condition)],
    ["shipping", normalizeOptionalText(input.shipping)],
    ["sellerRating", normalizeOptionalNumber(input.sellerRating)],
    ["location", normalizeOptionalText(input.location)],
    ["marketplaceId", normalizeOptionalText(input.marketplaceId)],
  ]
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}
