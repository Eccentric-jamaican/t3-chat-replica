import { describe, expect, test, vi } from "vitest";
import { enqueueToolJobAndWait } from "./toolJobClient";

function createCtx() {
  return {
    runMutation: vi.fn(),
    runQuery: vi.fn(),
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe("toolJobClient", () => {
  test("returns queue_saturated backpressure on enqueue saturation", async () => {
    const ctx = createCtx();
    ctx.runMutation.mockRejectedValueOnce(
      new Error("[queue_saturated:search_web] saturated"),
    );

    const outcome = await enqueueToolJobAndWait(ctx, {
      source: "chat_http",
      toolName: "search_web",
      args: { query: "test" },
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.backpressure?.reason).toBe("queue_saturated");
      expect(outcome.backpressure?.retryable).toBe(true);
    }
  });

  test("maps dead-lettered jobs to retryable backpressure failure", async () => {
    const ctx = createCtx();
    ctx.runMutation.mockResolvedValueOnce("job_1");
    ctx.runQuery.mockResolvedValueOnce({
      status: "dead_letter",
      deadLetterReason: "Too many failures",
    });

    const outcome = await enqueueToolJobAndWait(ctx, {
      source: "chat_action",
      toolName: "search_products",
      args: { query: "laptop" },
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.backpressure?.reason).toBe("dead_letter");
      expect(outcome.error).toContain("Too many failures");
    }
  });

  test("returns timeout backpressure when queue wait exceeds timeout", async () => {
    const ctx = createCtx();
    ctx.runMutation.mockResolvedValueOnce("job_2");
    ctx.runQuery.mockResolvedValue({
      status: "queued",
    });

    const outcome = await enqueueToolJobAndWait(ctx, {
      source: "chat_action",
      toolName: "search_global",
      args: { query: "tv" },
      waitTimeoutMs: 500,
    });

    expect(outcome.status).toBe("timeout");
    if (outcome.status === "timeout") {
      expect(outcome.backpressure.reason).toBe("queue_timeout");
      expect(outcome.backpressure.retryable).toBe(true);
      expect(outcome.backpressure.retryAfterMs).toBeGreaterThanOrEqual(1000);
    }
  });
});
