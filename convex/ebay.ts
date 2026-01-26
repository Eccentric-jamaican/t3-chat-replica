
/**
 * eBay API Helper for Convex
 * Handles OAuth Client Credentials Flow and Browse API searches.
 */

interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Gets a fresh Application Access Token from eBay.
 * Uses the Client Credentials grant flow.
 */
async function getApplicationToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET is missing");
  }

  const auth = btoa(`${clientId}:${clientSecret}`);
  
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to get eBay token: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as EbayTokenResponse;
  return data.access_token;
}

/**
 * Searches for items on eBay using the Browse API.
 * Maps results to our internal Product format.
 */
export async function searchEbayItems(query: string, limit: number = 6) {
  const token = await getApplicationToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

  // Using the Browse API's search endpoint
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", limit.toString());
  // Optional: filter for Fixed Price (Buy It Now) items for better UI experience
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("eBay Search Error:", errorBody);
    throw new Error(`eBay API Search failed: ${response.status} ${errorBody}`);
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
    sellerName: item.seller?.username,
    sellerFeedback: item.seller?.feedbackPercentage ? `${item.seller.feedbackPercentage}%` : undefined,
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

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
  });

  if (!response.ok) {
     const errorBody = await response.text();
     throw new Error(`Failed to get eBay item details: ${response.status} ${errorBody}`);
  }

  return await response.json();
}
