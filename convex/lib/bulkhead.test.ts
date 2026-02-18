import { describe, expect, test } from "vitest";
import { BulkheadSaturatedError, isBulkheadSaturatedError } from "./bulkhead";

describe("bulkhead helpers", () => {
  test("detects BulkheadSaturatedError", () => {
    const err = new BulkheadSaturatedError({
      provider: "serper_search",
      retryAfterMs: 1500,
      inFlight: 12,
      maxConcurrent: 12,
    });

    expect(isBulkheadSaturatedError(err)).toBe(true);
    expect(isBulkheadSaturatedError(new Error("x"))).toBe(false);
  });
});
