/**
 * eBay API Helper for Convex
 * Handles OAuth Client Credentials Flow and Browse API searches.
 */
import { fetchWithRetry } from "./lib/network";

interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Redacts or truncates error bodies for safe logging in production.
 * Only shows full details if DEBUG_EBAY or DEBUG env flag is set.
 */
function logEbayError(context: string, status: number, body: string) {
  const isDebug =
    process.env.DEBUG_EBAY === "true" || process.env.DEBUG === "true";
  const redactedBody = isDebug
    ? body
    : body.length > 100
      ? body.substring(0, 100) + "..."
      : body;

  if (isDebug) {
    console.error(`[DEBUG] ${context} Error (Full):`, body);
  }

  return `eBay ${context} failed: ${status} ${redactedBody}`;
}

/**
 * Gets a fresh Application Access Token from eBay.
 * Uses the Client Credentials grant flow.
 */
export async function getApplicationToken(scopes?: string) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET is missing");
  }

  const auth = btoa(`${clientId}:${clientSecret}`);

  const response = await fetchWithRetry(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: scopes ?? "https://api.ebay.com/oauth/api_scope",
      }),
    },
    {
      timeoutMs: 8000,
      retries: 2,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    const errorMessage = logEbayError(
      "OAuth Token",
      response.status,
      errorBody,
    );
    console.error(`[eBay OAuth Error] Status: ${response.status} (Redacted)`);
    throw new Error(errorMessage);
  }

  const data = (await response.json()) as EbayTokenResponse;
  return data.access_token;
}

/**
 * Searches for items on eBay using the Browse API.
 * Maps results to our internal Product format.
 */
type EbaySearchOptions = {
  limit?: number;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: "new" | "used" | "refurbished" | "open_box";
  shipping?: "free" | "fast";
  minSellerRating?: number;
  location?: string;
  marketplaceId?: string;
};

const CONDITION_IDS: Record<string, string> = {
  new: "1000",
  used: "3000",
  refurbished: "2000",
  open_box: "1500",
};

export async function searchEbayItems(
  query: string,
  options: EbaySearchOptions = {},
) {
  const token = await getApplicationToken();
  const marketplaceId =
    options.marketplaceId || process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const limit = options.limit ?? 6;

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", limit.toString());

  if (options.categoryId) {
    url.searchParams.set("category_ids", options.categoryId);
  }

  const filters: string[] = ["buyingOptions:{FIXED_PRICE}"];

  if (
    typeof options.minPrice === "number" ||
    typeof options.maxPrice === "number"
  ) {
    const min = typeof options.minPrice === "number" ? options.minPrice : "";
    const max = typeof options.maxPrice === "number" ? options.maxPrice : "";
    filters.push(`price:[${min}..${max}]`);
    filters.push("priceCurrency:USD");
  }

  if (options.condition && CONDITION_IDS[options.condition]) {
    filters.push(`conditionIds:{${CONDITION_IDS[options.condition]}}`);
  }

  if (options.shipping === "free") {
    filters.push("shippingOptions:{FREE_SHIPPING}");
  } else if (options.shipping === "fast") {
    filters.push("shippingOptions:{EXPEDITED_SHIPPING}");
  }

  if (typeof options.minSellerRating === "number") {
    const rating = Math.min(Math.max(options.minSellerRating, 0), 100);
    filters.push(`sellerFeedbackPercent:[${rating}..100]`);
  }

  if (options.location && options.location.length === 2) {
    filters.push(`itemLocationCountry:${options.location.toUpperCase()}`);
  }

  if (filters.length > 0) {
    url.searchParams.set("filter", filters.join(","));
  }

  console.log(`[eBay Search] Query: "${query}", URL: ${url.toString()}`);

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        "Content-Type": "application/json",
      },
    },
    {
      timeoutMs: 8000,
      retries: 2,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    const errorMessage = logEbayError("Search", response.status, errorBody);
    console.error(`[eBay Search Error] Status: ${response.status} (Redacted)`);
    throw new Error(errorMessage);
  }

  const data = await response.json();

  if (!data.itemSummaries) return [];

  // Map eBay's complex JSON to our cleaner schema
  return data.itemSummaries.map((item: any) => ({
    id: item.itemId,
    title: item.title,
    price: `${item.price.currency} ${item.price.value}`,
    image: item.image?.imageUrl || item.additionalImages?.[0]?.imageUrl || "",
    url: item.itemWebUrl,
    source: "ebay",
    sellerName: item.seller?.username,
    sellerFeedback: item.seller?.feedbackPercentage
      ? `${item.seller.feedbackPercentage}%`
      : undefined,
    condition: item.condition,
    // Note: Search API doesn't provide these catalog metrics by default
    rating: undefined,
    reviews: undefined,
  }));
}

/**
 * Fetches full details for a single eBay item, including catalog ratings if available.
 */
export async function getEbayItemDetails(itemId: string) {
  const token = await getApplicationToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

  const url = `https://api.ebay.com/buy/browse/v1/item/${itemId}?fieldgroups=PRODUCT`;

  const response = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
    },
    {
      timeoutMs: 8000,
      retries: 2,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    const errorMessage = logEbayError(
      "Item Details",
      response.status,
      errorBody,
    );
    throw new Error(errorMessage);
  }

  return await response.json();
}
