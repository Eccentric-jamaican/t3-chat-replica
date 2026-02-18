import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchWithRetry, fetchWithTimeout } from "./network";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchWithRetry", () => {
  test("returns immediately on first successful response", async () => {
    const response = new Response("ok", { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    global.fetch = fetchMock as typeof fetch;

    const result = await fetchWithRetry("https://example.com");

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries retryable statuses and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    const result = await fetchWithRetry(
      "https://example.com",
      undefined,
      { retries: 2, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not retry non-retryable statuses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    global.fetch = fetchMock as typeof fetch;

    const result = await fetchWithRetry(
      "https://example.com",
      undefined,
      { retries: 3, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 },
    );

    expect(result.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("retries network errors up to limit", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    const result = await fetchWithRetry(
      "https://example.com",
      undefined,
      { retries: 2, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchWithTimeout", () => {
  test("aborts a hanging request at timeout", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });
    global.fetch = fetchMock as typeof fetch;

    await expect(
      fetchWithTimeout("https://example.com", undefined, 5),
    ).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
