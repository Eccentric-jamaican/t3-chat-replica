import { describe, expect, test, vi } from "vitest";
import { enforceFunctionRateLimit } from "./functionRateLimit";

describe("functionRateLimit", () => {
  test("allows request when limiter allows it", async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
      }),
    };

    await expect(
      enforceFunctionRateLimit(ctx as any, {
        functionName: "integrations.whatsapp.requestLinkingCode",
        key: "bucket:user:1",
        max: 5,
        windowMs: 60_000,
      }),
    ).resolves.toBeUndefined();
  });

  test("throws classified rate_limited error when denied", async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterMs: 2000,
      }),
    };

    await expect(
      enforceFunctionRateLimit(ctx as any, {
        functionName: "integrations.whatsapp.requestLinkingCode",
        key: "bucket:user:1",
        max: 5,
        windowMs: 60_000,
      }),
    ).rejects.toThrow(
      "[rate_limited:integrations.whatsapp.requestLinkingCode]",
    );
  });

  test("maps OCC contention to classified rate_limited error", async () => {
    const ctx = {
      runMutation: vi.fn().mockRejectedValue(
        new Error(
          "Document in table rateLimitWindows changed while this mutation was being run",
        ),
      ),
    };

    await expect(
      enforceFunctionRateLimit(ctx as any, {
        functionName: "integrations.whatsapp.requestLinkingCode",
        key: "bucket:user:1",
        max: 5,
        windowMs: 60_000,
      }),
    ).rejects.toThrow(
      "[rate_limited:integrations.whatsapp.requestLinkingCode]",
    );
  });
});
