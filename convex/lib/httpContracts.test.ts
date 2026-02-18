import { describe, expect, test } from "vitest";
import {
  chatRequestSchema,
  gmailHistoryPayloadSchema,
  gmailPushEnvelopeSchema,
  whatsappWebhookSchema,
} from "./httpContracts";

describe("httpContracts", () => {
  test("accepts valid /api/chat body", () => {
    const parsed = chatRequestSchema.safeParse({
      threadId: "thread_123",
      modelId: "moonshotai/kimi-k2.5",
      webSearch: true,
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects invalid /api/chat body", () => {
    const parsed = chatRequestSchema.safeParse({
      threadId: "",
      webSearch: "yes",
    });

    expect(parsed.success).toBe(false);
  });

  test("accepts valid gmail push envelope and payload", () => {
    const envelope = gmailPushEnvelopeSchema.safeParse({
      message: { data: "eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaGlzdG9yeUlkIjoiMTIzIn0=" },
    });
    const payload = gmailHistoryPayloadSchema.safeParse({
      emailAddress: "test@example.com",
      historyId: "123",
    });

    expect(envelope.success).toBe(true);
    expect(payload.success).toBe(true);
  });

  test("applies default array for whatsapp webhook entry", () => {
    const parsed = whatsappWebhookSchema.parse({});
    expect(parsed.entry).toEqual([]);
  });
});

