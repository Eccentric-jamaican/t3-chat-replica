import { describe, expect, test } from "vitest";

import {
  hasOpenFallbackToolCall,
  parseFallbackToolCallsFromContent,
} from "./toolHelpers";

describe("parseFallbackToolCallsFromContent", () => {
  test("parses [[SEARCH: ...]] as search_web when allowed", () => {
    const out = parseFallbackToolCallsFromContent(
      'hi [[SEARCH: "bitcoin price today"]] there',
      { allowWebSearch: true },
    );
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].function.name).toBe("search_web");
    expect(JSON.parse(out.toolCalls[0].function.arguments)).toEqual({
      query: "bitcoin price today",
    });
    expect(out.cleaned).toContain("hi");
    expect(out.cleaned).toContain("there");
    expect(out.cleaned).not.toContain("SEARCH:");
  });

  test("ignores [[SEARCH: ...]] when web search is disabled", () => {
    const out = parseFallbackToolCallsFromContent("[[SEARCH: Tokyo weather]]", {
      allowWebSearch: false,
    });
    expect(out.toolCalls).toHaveLength(0);
  });

  test("parses [search_web: ...] and [search_products: ...]", () => {
    const out = parseFallbackToolCallsFromContent(
      '[search_web: "best programming laptops 2024"]\n[search_products: "MacBook Pro M3 14 inch"]',
      { allowWebSearch: true },
    );
    expect(out.toolCalls).toHaveLength(2);
    expect(out.toolCalls[0].function.name).toBe("search_web");
    expect(out.toolCalls[1].function.name).toBe("search_products");
    expect(out.cleaned).not.toMatch(/search_web|search_products/i);
  });

  test("parses minimax XML-ish tool markup for search_products", () => {
    const out = parseFallbackToolCallsFromContent(
      `Let me search:\n<minimax:tool_call>\n<invoke name=\"search_products\">\n<parameter name=\"query\">MacBook Pro M4 14 inch</parameter>\n</invoke>\n</minimax:tool_call>`,
      { allowWebSearch: true },
    );
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].function.name).toBe("search_products");
    expect(JSON.parse(out.toolCalls[0].function.arguments)).toEqual({
      query: "MacBook Pro M4 14 inch",
    });
    expect(out.cleaned).not.toMatch(/minimax:tool_call/i);
    expect(out.cleaned).not.toMatch(/invoke/i);
  });

  test("parses minimax tool markup when quotes are backslash-escaped", () => {
    const out = parseFallbackToolCallsFromContent(
      // Some models emit literal backslashes: name=\"search_products\"
      `Let me search:\n<minimax:tool_call>\n<invoke name=\\\"search_products\\\">\n<parameter name=\\\"query\\\">MacBook Pro M4 14 inch</parameter>\n</invoke>\n</minimax:tool_call>`,
      { allowWebSearch: true },
    );
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].function.name).toBe("search_products");
    expect(JSON.parse(out.toolCalls[0].function.arguments)).toEqual({
      query: "MacBook Pro M4 14 inch",
    });
    expect(out.cleaned).not.toMatch(/minimax:tool_call/i);
    expect(out.cleaned).not.toMatch(/invoke/i);
  });

  test("hasOpenFallbackToolCall detects incomplete bracket tool call", () => {
    expect(hasOpenFallbackToolCall("[search_products: ")).toBe(true);
    expect(hasOpenFallbackToolCall('[search_products: "x"]')).toBe(false);
  });
});
