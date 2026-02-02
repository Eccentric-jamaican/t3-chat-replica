import type { Product } from "../../data/mockProducts";

function normalizeUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export function getProductImageUrl(product: Product) {
  const raw = typeof product.image === "string" ? product.image.trim() : "";
  if (!raw) return "";
  const normalized = normalizeUrl(raw);
  if (!normalized) return "";
  return normalized;
}

export function getProductImageFallback(product: Product) {
  if (product.merchantDomain) {
    return `https://www.google.com/s2/favicons?domain=${product.merchantDomain}&sz=64`;
  }
  return "";
}
