import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createHttpErrorResponse,
  formatValidationIssues,
  HTTP_ERROR_CODE_HEADER,
} from "./httpErrors";

describe("httpErrors", () => {
  test("sets status, body, and error code header", async () => {
    const response = createHttpErrorResponse({
      status: 429,
      code: "rate_limited",
      message: "Too many requests",
      headers: { "Retry-After": "1" },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(response.headers.get(HTTP_ERROR_CODE_HEADER)).toBe("rate_limited");
    expect(await response.text()).toBe("Too many requests");
  });

  test("formats zod issues into a single message", () => {
    const schema = z.object({
      id: z.string().min(1),
      enabled: z.boolean(),
    });
    const parsed = schema.safeParse({ id: "", enabled: "yes" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const message = formatValidationIssues(parsed.error).toLowerCase();
    expect(message).toContain(">=1 characters");
    expect(message).toContain("expected boolean");
  });
});
