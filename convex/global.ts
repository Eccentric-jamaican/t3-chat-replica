import { fetchWithRetry } from "./lib/network";

type GlobalSearchOptions = {
  limit?: number;
  location?: string;
};

type GlobalProduct = {
  id: string;
  title: string;
  price: string;
  image: string;
  url: string;
  source: "global";
  merchantName?: string;
  merchantDomain?: string;
  productUrl?: string;
};

export async function searchGlobalItems(
  query: string,
  options: GlobalSearchOptions = {},
) {
  const serperKey = process.env.SERPER_API_KEY;
  const serpApiKey = process.env.SERPAPI_API_KEY;
  if (!serperKey && !serpApiKey) {
    throw new Error("SERPER_API_KEY or SERPAPI_API_KEY is missing");
  }

  const limit = options.limit ?? 6;
  let data: any;
  if (serperKey) {
    const response = await fetchWithRetry(
      "https://google.serper.dev/shopping",
      {
        method: "POST",
        headers: {
          "X-API-KEY": serperKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          num: limit,
          ...(options.location ? { location: options.location } : {}),
        }),
      },
      {
        timeoutMs: 5000,
        retries: 2,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Global search failed: ${response.status} ${errorBody}`);
    }
    data = await response.json();
  } else {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", serpApiKey as string);
    url.searchParams.set("num", limit.toString());
    if (options.location) {
      url.searchParams.set("location", options.location);
    }

    const response = await fetchWithRetry(
      url.toString(),
      undefined,
      {
        timeoutMs: 5000,
        retries: 2,
      },
    );
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Global search failed: ${response.status} ${errorBody}`);
    }
    data = await response.json();
  }

  const results = normalizeGlobalResults(data);

  return results
    .map((item: any, index: number): GlobalProduct | null => {
      const productLink =
        item.product_link ||
        item.productLink ||
        item.product_url ||
        item.productUrl ||
        item.link ||
        item.url ||
        "";
      const merchantLink =
        item.merchant_link ||
        item.merchantLink ||
        item.merchant_url ||
        item.merchantUrl ||
        item.store_link ||
        item.storeLink ||
        item.seller_link ||
        item.sellerLink ||
        item.shop_link ||
        item.shopLink ||
        item.offer_link ||
        item.offerLink ||
        "";
      if (!productLink) return null;

      const rawSource =
        item.source || item.seller || item.merchant || item.store || "";
      const sourceLabel =
        typeof rawSource === "string" ? rawSource.trim() : "";
      const isGoogleLink = (url: string) => {
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
      const getDomain = (url: string) => {
        if (!url) return undefined;
        try {
          return new URL(url).hostname;
        } catch (err) {
          return undefined;
        }
      };

      let merchantDomain: string | undefined;
      if (merchantLink && !isGoogleLink(merchantLink)) {
        merchantDomain = getDomain(merchantLink);
      }
      if (!merchantDomain && productLink && !isGoogleLink(productLink)) {
        merchantDomain = getDomain(productLink);
      }
      if (!merchantDomain && sourceLabel.includes(".")) {
        const domainCandidate = sourceLabel
          .toLowerCase()
          .split(/\s+/)[0]
          .replace(/^www\./, "");
        if (domainCandidate.includes(".")) {
          merchantDomain = domainCandidate;
        }
      }
      if (!merchantDomain && sourceLabel) {
        const simplified = sourceLabel
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (simplified.length > 2) {
          merchantDomain = `${simplified}.com`;
        }
      }

      const merchantHomeUrl = merchantDomain
        ? `https://${merchantDomain}`
        : undefined;
      const searchFallback =
        sourceLabel || item.title
          ? `https://www.google.com/search?q=${encodeURIComponent(
              `${sourceLabel} ${item.title || query}`.trim(),
            )}`
          : undefined;
      const productUrl =
        merchantLink && !isGoogleLink(merchantLink)
          ? merchantLink
          : !isGoogleLink(productLink)
            ? productLink
            : merchantHomeUrl || searchFallback;

      const image =
        item.imageUrl ||
        item.image_url ||
        item.image ||
        item.thumbnail ||
        item.thumbnailUrl ||
        item.thumbnail_url ||
        item.thumbnailImage ||
        item.thumbnailImageUrl ||
        item.thumbnail?.url ||
        item.thumbnail?.src ||
        "";

      return {
        id:
          item.product_id?.toString() ||
          productLink ||
          merchantLink ||
          `${query}-${index}`,
        title: item.title || "Untitled product",
        price: item.price || "",
        image,
        url: productLink,
        source: "global" as const,
        merchantName: sourceLabel || undefined,
        merchantDomain,
        productUrl: productUrl || undefined,
      };
    })
    .filter((item): item is GlobalProduct => item !== null);
}

function normalizeGlobalResults(data: any): any[] {
  if (Array.isArray(data?.shopping_results)) {
    return data.shopping_results;
  }
  if (Array.isArray(data?.shopping)) {
    return data.shopping;
  }
  if (Array.isArray(data?.shopping_results?.results)) {
    return data.shopping_results.results;
  }
  if (Array.isArray(data?.inline_shopping_results)) {
    return data.inline_shopping_results;
  }
  if (Array.isArray(data?.categorized_shopping_results)) {
    return data.categorized_shopping_results.flatMap(
      (category: any) => category?.shopping_results || [],
    );
  }
  return [];
}
