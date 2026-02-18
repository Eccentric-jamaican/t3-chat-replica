import { fetchWithRetry } from "../lib/network";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
};

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  from,
}: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const resolvedFrom = from || process.env.EMAIL_FROM;

  if (!apiKey) {
    throw new Error("Missing required env var RESEND_API_KEY");
  }
  if (!resolvedFrom) {
    throw new Error("Missing required env var EMAIL_FROM");
  }

  const response = await fetchWithRetry(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resolvedFrom,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    },
    {
      timeoutMs: 10_000,
      // Email send is non-idempotent; avoid automatic retries to reduce
      // duplicate-send risk without an explicit idempotency key.
      retries: 0,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Resend email failed (${response.status}): ${errorText || "Unknown error"}`,
    );
  }
}
