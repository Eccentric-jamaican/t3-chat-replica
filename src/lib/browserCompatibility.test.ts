import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getMarkdownCompatibilityMode,
  isLegacySafariMarkdownBrowser,
} from "./browserCompatibility";

const ORIGINAL_NAVIGATOR = globalThis.navigator;

function setUserAgent(userAgent: string) {
  vi.stubGlobal("navigator", { userAgent });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_NAVIGATOR) {
    vi.stubGlobal("navigator", ORIGINAL_NAVIGATOR);
  }
});

describe("browserCompatibility", () => {
  test("marks iOS 15 Safari as legacy markdown browser", () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.6 Mobile/15E148 Safari/604.1",
    );

    expect(isLegacySafariMarkdownBrowser()).toBe(true);
    expect(getMarkdownCompatibilityMode()).toBe("legacy_no_gfm");
  });

  test("keeps modern Chrome on the full markdown path", () => {
    setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    );

    expect(isLegacySafariMarkdownBrowser()).toBe(false);
    expect(getMarkdownCompatibilityMode()).toBe("full");
  });
});
