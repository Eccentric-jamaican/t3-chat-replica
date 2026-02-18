import { describe, expect, test } from "vitest";
import {
  assertFunctionArgs,
  gmailStoreConnectionArgsSchema,
  incrementalSyncArgsSchema,
  processWhatsappWebhookArgsSchema,
  syncGmailArgsSchema,
} from "./functionBoundaries";

describe("functionBoundaries", () => {
  test("validates storeGmailConnection args", () => {
    const parsed = gmailStoreConnectionArgsSchema.safeParse({
      userId: "user_123",
      email: "user@example.com",
      encryptedRefreshToken: "enc-token",
      accessToken: "access-token",
      accessTokenExpiresAt: Date.now() + 60_000,
      historyId: "12345",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects invalid incrementalSync args", () => {
    const parsed = incrementalSyncArgsSchema.safeParse({
      emailAddress: "not-an-email",
      newHistoryId: "",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects out-of-range syncGmail daysBack", () => {
    const parsed = syncGmailArgsSchema.safeParse({
      userId: "user_123",
      daysBack: 90,
    });
    expect(parsed.success).toBe(false);
  });

  test("validates whatsapp process payload shape", () => {
    const parsed = processWhatsappWebhookArgsSchema.safeParse({
      payload: {
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messages: [
                    {
                      id: "wamid.123",
                      from: "15551234567",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: "hello" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("assertFunctionArgs throws classified message on invalid args", () => {
    expect(() =>
      assertFunctionArgs(
        incrementalSyncArgsSchema,
        { emailAddress: "bad", newHistoryId: "" },
        "integrations.gmail.sync.incrementalSync",
      ),
    ).toThrow("[invalid_function_args:integrations.gmail.sync.incrementalSync]");
  });
});

