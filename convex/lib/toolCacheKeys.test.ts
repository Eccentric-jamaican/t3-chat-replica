import { describe, expect, test } from "vitest";
import {
  buildProductSearchCacheKey,
  normalizeToolCacheText,
} from "./toolCacheKeys";

describe("toolCacheKeys", () => {
  test("normalizes free text keys", () => {
    expect(normalizeToolCacheText("  Gaming Laptops  ")).toBe("gaming laptops");
  });

  test("builds deterministic product cache keys", () => {
    const a = buildProductSearchCacheKey({
      query: "  iPhone 15  ",
      limit: 12,
      categoryId: "9355",
      minPrice: 100,
      maxPrice: 800,
      condition: "new",
      location: "US",
      marketplaceId: "EBAY_US",
    });

    const b = buildProductSearchCacheKey({
      query: "iphone 15",
      limit: 12,
      categoryId: "9355",
      minPrice: 100,
      maxPrice: 800,
      condition: "new",
      location: "us",
      marketplaceId: "ebay_us",
    });

    expect(a).toBe(b);
  });
});
