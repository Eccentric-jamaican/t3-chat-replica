import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ChatUpstreamError,
  executeChatProviderRequest,
  toClientSafeUpstreamError,
} from "./chatProviderRouter";

const ORIGINAL_ENV = { ...process.env };

function createCtx() {
  return {
    runMutation: vi.fn().mockImplementation(async (_ref: unknown, args: any) => {
      if (args && typeof args === "object") {
        if ("maxConcurrent" in args && "leaseTtlMs" in args) {
          return { acquired: true, inFlight: 0, retryAfterMs: 1000 };
        }
        if ("provider" in args && Object.keys(args).length === 1) {
          return { allowed: true, retryAfterMs: 1000 };
        }
      }
      return { ok: true };
    }),
  } as any;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("chatProviderRouter", () => {
  test("fails over from primary to secondary route on retryable upstream error", async () => {
    process.env.FF_PROVIDER_FAILOVER_ENABLED = "true";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("fail", { status: 503 }))
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await executeChatProviderRequest({
      ctx: createCtx(),
      apiKey: "k_test",
      requestedModelId: "openai/gpt-5",
      payload: { messages: [{ role: "user", content: "hello" }] },
    });

    expect(outcome.route.id).toBe("secondary");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("fails over from primary to secondary route on quota exceeded", async () => {
    process.env.FF_PROVIDER_FAILOVER_ENABLED = "true";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("quota", { status: 402 }))
      .mockResolvedValueOnce(
        new Response("ok", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await executeChatProviderRequest({
      ctx: createCtx(),
      apiKey: "k_test",
      requestedModelId: "moonshotai/kimi-k2-thinking",
      payload: { messages: [{ role: "user", content: "hello" }] },
    });

    expect(outcome.route.id).toBe("secondary");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not fail over on non-retryable bad request", async () => {
    process.env.FF_PROVIDER_FAILOVER_ENABLED = "true";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));

    await expect(
      executeChatProviderRequest({
        ctx: createCtx(),
        apiKey: "k_test",
        requestedModelId: "openai/gpt-5",
        payload: { messages: [{ role: "user", content: "hello" }] },
      }),
    ).rejects.toMatchObject({
      name: "ChatUpstreamError",
      code: "upstream_bad_request",
      routeId: "primary",
    });
  });

  test("uses only requested model on primary route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await executeChatProviderRequest({
      ctx: createCtx(),
      apiKey: "k_test",
      requestedModelId: "openai/gpt-5",
      payload: { messages: [{ role: "user", content: "hello" }] },
    });

    const firstCall = fetchMock.mock.calls[0];
    const body = JSON.parse(String(firstCall?.[1]?.body ?? "{}"));
    expect(body.models).toEqual(["openai/gpt-5"]);
  });

  test("maps unknown errors and typed upstream errors", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const safe = toClientSafeUpstreamError(err);
    expect(safe.code).toBe("upstream_error");

    const typed = toClientSafeUpstreamError(
      new ChatUpstreamError({
        code: "upstream_timeout",
        message: "Model provider request timed out.",
        providerId: "openrouter",
        routeId: "primary",
        retryable: true,
        retryAfterMs: 1000,
      }),
    );
    expect(typed.code).toBe("upstream_timeout");
    expect(typed.retryAfterMs).toBe(1000);
  });

  test("does not double-count circuit failures for HTTP status errors", async () => {
    const ctx = createCtx();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("fail", { status: 503 })));

    await expect(
      executeChatProviderRequest({
        ctx,
        apiKey: "k_test",
        requestedModelId: "openai/gpt-5",
        payload: { messages: [{ role: "user", content: "hello" }] },
      }),
    ).rejects.toMatchObject({
      code: "upstream_unavailable",
    });

    const failureCalls = ctx.runMutation.mock.calls.filter(([, args]: any[]) => {
      return args && typeof args === "object" && "error" in args;
    });
    expect(failureCalls).toHaveLength(1);
  });

  test("keeps neutral HTTP statuses out of circuit failure recording", async () => {
    const ctx = createCtx();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate", { status: 429 })));

    await expect(
      executeChatProviderRequest({
        ctx,
        apiKey: "k_test",
        requestedModelId: "openai/gpt-5",
        payload: { messages: [{ role: "user", content: "hello" }] },
      }),
    ).rejects.toMatchObject({
      code: "upstream_rate_limited",
    });

    const failureCalls = ctx.runMutation.mock.calls.filter(([, args]: any[]) => {
      return args && typeof args === "object" && "error" in args;
    });
    expect(failureCalls).toHaveLength(0);
  });
});
