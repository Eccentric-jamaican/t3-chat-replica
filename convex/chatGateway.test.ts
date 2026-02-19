import { afterEach, describe, expect, test } from "vitest";
import {
  chatGatewayHealthHandler,
  resolveAdmissionModeForGateway,
  resolveChatGatewayMode,
  runChatGatewayRequest,
} from "./chatGateway";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("chatGateway", () => {
  test("defaults to legacy mode and shadow admission", () => {
    delete process.env.FF_CHAT_GATEWAY_ENABLED;
    delete process.env.FF_CHAT_GATEWAY_SHADOW;
    delete process.env.FF_ADMISSION_ENFORCE;
    delete process.env.ADMISSION_REDIS_SHADOW_MODE;

    expect(resolveChatGatewayMode()).toBe("legacy");
    expect(resolveAdmissionModeForGateway()).toBe("shadow");
  });

  test("resolves shadow and authoritative modes", () => {
    process.env.FF_CHAT_GATEWAY_ENABLED = "true";
    process.env.FF_CHAT_GATEWAY_SHADOW = "true";
    expect(resolveChatGatewayMode()).toBe("shadow");

    process.env.FF_CHAT_GATEWAY_SHADOW = "false";
    expect(resolveChatGatewayMode()).toBe("authoritative");
  });

  test("admission enforce flag overrides configured shadow mode", () => {
    process.env.ADMISSION_REDIS_SHADOW_MODE = "true";
    process.env.FF_ADMISSION_ENFORCE = "true";
    expect(resolveAdmissionModeForGateway()).toBe("enforce");
  });

  test("gateway wrapper forwards runtime options and headers", async () => {
    process.env.FF_CHAT_GATEWAY_ENABLED = "true";
    process.env.FF_CHAT_GATEWAY_SHADOW = "false";
    process.env.FF_ADMISSION_ENFORCE = "true";

    let received: any;
    const response = await runChatGatewayRequest(
      {},
      new Request("https://example.com/api/chat", { method: "POST" }),
      async (_ctx, _request, options) => {
        received = options;
        return new Response("ok");
      },
    );

    expect(received).toMatchObject({
      gatewayMode: "authoritative",
      forceAdmissionMode: "enforce",
    });
    expect(response.headers.get("X-Sendcat-Chat-Gateway")).toBe(
      "authoritative",
    );
    expect(response.headers.get("X-Sendcat-Admission-Mode")).toBe("enforce");
  });

  test("health endpoint returns 200 when ready", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.FF_CHAT_GATEWAY_HEALTH_ENABLED = "true";

    const response = await chatGatewayHealthHandler(
      {},
      new Request("https://example.com/api/chat/health", { method: "GET" }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
  });

  test("health endpoint returns 503 when fail-closed and redis creds missing", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.FF_CHAT_GATEWAY_HEALTH_ENABLED = "true";
    process.env.FF_FAIL_CLOSED_ON_REDIS_ERROR = "true";
    process.env.ADMISSION_REDIS_ENABLED = "true";
    process.env.ADMISSION_REDIS_URL = "";
    process.env.ADMISSION_REDIS_TOKEN = "";

    const response = await chatGatewayHealthHandler(
      {},
      new Request("https://example.com/api/chat/health", { method: "GET" }),
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.ok).toBe(false);
  });
});

