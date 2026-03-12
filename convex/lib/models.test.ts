import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  getModelCapabilities,
  resetModelCatalogCacheForTests,
  resolveModelCapabilities,
} from "./models";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  resetModelCatalogCacheForTests();
  vi.unstubAllGlobals();
});

describe("models", () => {
  test("falls back to regex tool parsing for unknown models without catalog data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const capabilities = await resolveModelCapabilities("acme/unknown-model");

    expect(capabilities).toEqual(getModelCapabilities("acme/unknown-model"));
    expect(capabilities.supportsTools).toBe(false);
    expect(capabilities.toolFallback).toBe("regex");
  });

  test("uses OpenRouter supported_parameters to enable native tools for new models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "acme/new-tool-model",
                supported_parameters: ["tools", "tool_choice", "reasoning"],
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      ),
    );

    const capabilities = await resolveModelCapabilities("acme/new-tool-model");

    expect(capabilities.supportsTools).toBe(true);
    expect(capabilities.toolFallback).toBe("none");
    expect(capabilities.isThinking).toBe(true);
    expect(capabilities.promptStrategy).toBe("reasoning");
  });
});
