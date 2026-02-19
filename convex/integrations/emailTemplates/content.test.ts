import { describe, expect, test } from "vitest";
import {
  buildResetPasswordEmail,
  buildWelcomeEmail,
} from "./content";

describe("email template content", () => {
  test("buildWelcomeEmail returns html and text with escaped name", () => {
    const result = buildWelcomeEmail({
      name: "<script>alert(1)</script>",
      appUrl: "https://www.sendcat.app/",
    });

    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.text).toContain("Hi <script>alert(1)</script>,");
    expect(result.html).toContain("Go to SendCat");
  });

  test("buildResetPasswordEmail includes reset URL in text and html", () => {
    const resetUrl = "https://www.sendcat.app/reset-password?token=abc123";
    const result = buildResetPasswordEmail({
      name: "Alicia",
      resetUrl,
    });

    expect(result.text).toContain(`Reset Password: ${resetUrl}`);
    expect(result.html).toContain("Reset Password");
    expect(result.html).toContain("href=\"https://www.sendcat.app/reset-password?token=abc123\"");
  });

  test("buildResetPasswordEmail blocks unsafe URL protocols", () => {
    const result = buildResetPasswordEmail({
      name: "Alicia",
      resetUrl: "javascript:alert(1)",
    });

    expect(result.html).toContain("href=\"#\"");
    expect(result.text).toContain("Reset Password: #");
  });
});
