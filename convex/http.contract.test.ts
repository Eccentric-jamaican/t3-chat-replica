import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createHmac } from "node:crypto";
import { chatHandler } from "./chatHttp";
import {
  chatOptionsHandler,
  chatPostHandler,
  gmailOAuthCallbackHandler,
  gmailPushHandler,
  whatsappWebhookVerifyHandler,
  whatsappWebhookPostHandler,
} from "./http";
import { HTTP_ERROR_CODE_HEADER } from "./lib/httpErrors";

const ORIGINAL_ENV = { ...process.env };
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  process.env = { ...ORIGINAL_ENV };
});

function createCtx(input?: {
  userId?: string | null;
  rateLimitResult?: { allowed: boolean; retryAfterMs: number };
}) {
  const rateLimitResult = input?.rateLimitResult ?? {
    allowed: true,
    retryAfterMs: 0,
  };
  return {
    auth: {
      getUserIdentity: vi
        .fn()
        .mockResolvedValue(
          input?.userId === null ? null : { subject: input?.userId ?? "user_1" },
        ),
    },
    runMutation: vi.fn().mockImplementation(async () => rateLimitResult),
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function signWhatsappBody(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("/api/chat contract", () => {
  test("returns method_not_allowed for non-POST", async () => {
    const response = await chatHandler(
      createCtx(),
      new Request("https://example.com/api/chat", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("method_not_allowed");
  });

  test("returns unauthorized when auth identity is missing", async () => {
    const response = await chatHandler(
      createCtx({ userId: null }),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "t_1" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("unauthorized");
  });

  test("returns invalid_json for malformed JSON", async () => {
    const response = await chatHandler(
      createCtx(),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("invalid_json");
  });

  test("returns invalid_request for schema violations", async () => {
    const response = await chatHandler(
      createCtx(),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("invalid_request");
  });

  test("returns unsupported_media_type for non-json chat body", async () => {
    const response = await chatHandler(
      createCtx(),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      }),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe(
      "unsupported_media_type",
    );
  });

  test("returns payload_too_large for oversized chat body", async () => {
    const response = await chatHandler(
      createCtx(),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(128 * 1024),
        },
        body: JSON.stringify({ threadId: "t_1" }),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("payload_too_large");
  });

  test("returns misconfigured when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const response = await chatHandler(
      createCtx(),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "t_1" }),
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("misconfigured");
  });

  test("returns rate_limited with Retry-After when limiter blocks", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const response = await chatHandler(
      createCtx({ rateLimitResult: { allowed: false, retryAfterMs: 1500 } }),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "t_1" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("rate_limited");
    expect(response.headers.get("Retry-After")).toBe("2");
  });

  test("maps thrown handler failures to internal_error in route wrapper", async () => {
    const response = await chatPostHandler(
      {} as any,
      new Request("https://example.com/api/chat", { method: "POST" }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("internal_error");
  });

  test("rejects chat POST from disallowed browser origin", async () => {
    const response = await chatPostHandler(
      createCtx(),
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { Origin: "https://not-allowed.invalid" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("forbidden");
  });

  test("chat OPTIONS returns CORS headers for allowed origin", async () => {
    const allowedOrigin =
      process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() ||
      "http://localhost:3000";
    const response = await chatOptionsHandler(
      {} as any,
      new Request("https://example.com/api/chat", {
        method: "OPTIONS",
        headers: { Origin: allowedOrigin },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
  });

  test("chat OPTIONS omits CORS headers for unknown origin", async () => {
    const response = await chatOptionsHandler(
      {} as any,
      new Request("https://example.com/api/chat", {
        method: "OPTIONS",
        headers: { Origin: "https://not-allowed.invalid" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("/api/gmail/push contract", () => {
  test("returns forbidden when verify token mismatches", async () => {
    process.env.GMAIL_PUBSUB_VERIFY_TOKEN = "expected-token";
    const response = await gmailPushHandler(
      createCtx(),
      new Request("https://example.com/api/gmail/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("forbidden");
  });

  test("returns invalid_request for invalid push envelope", async () => {
    delete process.env.GMAIL_PUBSUB_VERIFY_TOKEN;
    const response = await gmailPushHandler(
      createCtx(),
      new Request("https://example.com/api/gmail/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("invalid_request");
  });

  test("returns invalid_json for malformed JSON body", async () => {
    delete process.env.GMAIL_PUBSUB_VERIFY_TOKEN;
    const response = await gmailPushHandler(
      createCtx(),
      new Request("https://example.com/api/gmail/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad json",
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("invalid_json");
  });

  test("returns unsupported_media_type for non-json content type", async () => {
    const response = await gmailPushHandler(
      createCtx(),
      new Request("https://example.com/api/gmail/push", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe(
      "unsupported_media_type",
    );
  });

  test("returns payload_too_large for oversized body", async () => {
    const response = await gmailPushHandler(
      createCtx(),
      new Request("https://example.com/api/gmail/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(300 * 1024),
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("payload_too_large");
  });

  test("returns rate_limited with Retry-After when limiter blocks", async () => {
    const response = await gmailPushHandler(
      createCtx({ rateLimitResult: { allowed: false, retryAfterMs: 1200 } }),
      new Request("https://example.com/api/gmail/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("rate_limited");
    expect(response.headers.get("Retry-After")).toBe("2");
  });
});

describe("/api/whatsapp/webhook contract", () => {
  test("verification GET returns challenge when token matches", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
    const response = await whatsappWebhookVerifyHandler(
      {} as any,
      new Request(
        "https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123",
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  test("verification GET returns forbidden on token mismatch", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token";
    const response = await whatsappWebhookVerifyHandler(
      {} as any,
      new Request(
        "https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("forbidden");
  });

  test("returns forbidden when signature or secret is missing", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const response = await whatsappWebhookPostHandler(
      createCtx(),
      new Request("https://example.com/api/whatsapp/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("forbidden");
  });

  test("returns invalid_json when body is malformed JSON", async () => {
    process.env.WHATSAPP_APP_SECRET = "test-secret";
    const body = "{bad json";
    const response = await whatsappWebhookPostHandler(
      createCtx(),
      new Request("https://example.com/api/whatsapp/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": signWhatsappBody(body, process.env.WHATSAPP_APP_SECRET),
        },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("invalid_json");
  });

  test("returns invalid_request for schema violations", async () => {
    process.env.WHATSAPP_APP_SECRET = "test-secret";
    const body = JSON.stringify({ entry: "not-an-array" });
    const response = await whatsappWebhookPostHandler(
      createCtx(),
      new Request("https://example.com/api/whatsapp/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": signWhatsappBody(body, process.env.WHATSAPP_APP_SECRET),
          "Content-Type": "application/json",
        },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("invalid_request");
  });

  test("returns rate_limited with Retry-After when limiter blocks", async () => {
    const response = await whatsappWebhookPostHandler(
      createCtx({ rateLimitResult: { allowed: false, retryAfterMs: 1800 } }),
      new Request("https://example.com/api/whatsapp/webhook", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("rate_limited");
    expect(response.headers.get("Retry-After")).toBe("2");
  });

  test("returns unsupported_media_type for non-json content type", async () => {
    process.env.WHATSAPP_APP_SECRET = "test-secret";
    const response = await whatsappWebhookPostHandler(
      createCtx(),
      new Request("https://example.com/api/whatsapp/webhook", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "raw",
      }),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe(
      "unsupported_media_type",
    );
  });

  test("returns payload_too_large for oversized body", async () => {
    const response = await whatsappWebhookPostHandler(
      createCtx(),
      new Request("https://example.com/api/whatsapp/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(300 * 1024),
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("payload_too_large");
  });
});

describe("/api/gmail/auth/callback contract", () => {
  test("returns rate_limited when limiter blocks", async () => {
    const response = await gmailOAuthCallbackHandler(
      createCtx({ rateLimitResult: { allowed: false, retryAfterMs: 1300 } }),
      new Request("https://example.com/api/gmail/auth/callback", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("rate_limited");
    expect(response.headers.get("Retry-After")).toBe("2");
  });

  test("redirects to gmail=error when required params are missing", async () => {
    const response = await gmailOAuthCallbackHandler(
      createCtx(),
      new Request("https://example.com/api/gmail/auth/callback", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("gmail=error");
  });

  test("redirects to gmail=error for invalid state token", async () => {
    const response = await gmailOAuthCallbackHandler(
      createCtx(),
      new Request(
        "https://example.com/api/gmail/auth/callback?code=abc&state=not-valid",
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("gmail=error");
  });

  test("redirects to gmail=error when state is overly long", async () => {
    const longState = "a".repeat(5000);
    const response = await gmailOAuthCallbackHandler(
      createCtx(),
      new Request(
        `https://example.com/api/gmail/auth/callback?code=abc&state=${longState}`,
        { method: "GET" },
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("gmail=error");
  });
});
