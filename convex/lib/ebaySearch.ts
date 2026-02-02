type EbaySearchArgs = {
  query?: unknown;
  limit?: unknown;
  categoryId?: unknown;
  categoryName?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  condition?: unknown;
  shipping?: unknown;
  sellerRating?: unknown;
  location?: unknown;
};

const ALLOWED_CONDITIONS = new Set(["new", "used", "refurbished", "open_box"]);
const ALLOWED_SHIPPING = new Set(["free", "fast"]);

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function normalizeEbaySearchArgs(args: EbaySearchArgs) {
  const query = typeof args.query === "string" ? args.query.trim() : "";

  const limitRaw = parseNumber(args.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(36, Math.round(limitRaw!)))
    : 36;

  const minPriceRaw = parseNumber(args.minPrice);
  const maxPriceRaw = parseNumber(args.maxPrice);
  let minPrice = minPriceRaw;
  let maxPrice = maxPriceRaw;
  if (
    typeof minPrice === "number" &&
    typeof maxPrice === "number" &&
    minPrice > maxPrice
  ) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  const condition =
    typeof args.condition === "string" &&
    ALLOWED_CONDITIONS.has(args.condition.toLowerCase())
      ? (args.condition.toLowerCase() as
          | "new"
          | "used"
          | "refurbished"
          | "open_box")
      : undefined;

  const shipping =
    typeof args.shipping === "string" &&
    ALLOWED_SHIPPING.has(args.shipping.toLowerCase())
      ? (args.shipping.toLowerCase() as "free" | "fast")
      : undefined;

  const sellerRatingRaw = parseNumber(args.sellerRating);
  const sellerRating = Number.isFinite(sellerRatingRaw)
    ? Math.max(95, Math.min(100, Math.round(sellerRatingRaw!)))
    : 95;

  const location =
    typeof args.location === "string" && args.location.trim()
      ? args.location.trim()
      : undefined;

  const categoryId =
    typeof args.categoryId === "string" && args.categoryId.trim()
      ? args.categoryId.trim()
      : undefined;

  const categoryName =
    typeof args.categoryName === "string" && args.categoryName.trim()
      ? args.categoryName.trim()
      : undefined;

  return {
    query,
    limit,
    categoryId,
    categoryName,
    minPrice,
    maxPrice,
    condition,
    shipping,
    sellerRating,
    location,
  };
}
