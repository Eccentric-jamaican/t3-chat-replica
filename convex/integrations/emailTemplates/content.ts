type EmailContent = {
  html: string;
  text: string;
};

type BaseTemplateInput = {
  title: string;
  previewText: string;
  greeting: string;
  bodyLines: string[];
  ctaLabel: string;
  ctaHref: string;
  footerText: string;
  brandColor?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toSafeText(value: string | null | undefined, fallback: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : fallback;
}

function toSafeUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "#";
    }
    return parsed.toString();
  } catch {
    return "#";
  }
}

function renderBaseTemplate(input: BaseTemplateInput): EmailContent {
  const brandColor = input.brandColor ?? "#111827";
  const safeTitle = escapeHtml(input.title);
  const safePreviewText = escapeHtml(input.previewText);
  const safeGreeting = escapeHtml(input.greeting);
  const safeBody = input.bodyLines.map((line) => escapeHtml(line));
  const safeCtaLabel = escapeHtml(input.ctaLabel);
  const safeFooter = escapeHtml(input.footerText);
  const safeUrl = escapeHtml(toSafeUrl(input.ctaHref));

  const htmlBodyLines = safeBody
    .map((line) => `<p style="font-size:14px;line-height:20px;color:#334155;margin:0 0 12px 0;">${line}</p>`)
    .join("");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="background:#f9fafb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:32px 16px;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreviewText}</div>
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 12px 30px rgba(15,23,42,0.08);">
      <p style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 20px 0;">SendCat</p>
      <p style="font-size:22px;font-weight:600;color:#0f172a;margin:0 0 12px 0;">${safeTitle}</p>
      <p style="font-size:14px;line-height:20px;color:#334155;margin:0 0 12px 0;">${safeGreeting}</p>
      ${htmlBodyLines}
      <p style="margin:20px 0 12px 0;">
        <a href="${safeUrl}" style="display:inline-block;background:${escapeHtml(brandColor)};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;">${safeCtaLabel}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px 0;" />
      <p style="font-size:12px;color:#6b7280;margin:0;">${safeFooter}</p>
    </div>
  </body>
</html>`;

  const textLines = [
    input.title,
    "",
    input.greeting,
    "",
    ...input.bodyLines,
    "",
    `${input.ctaLabel}: ${toSafeUrl(input.ctaHref)}`,
    "",
    input.footerText,
  ];

  return {
    html,
    text: textLines.join("\n"),
  };
}

export function buildWelcomeEmail(input: {
  name?: string | null;
  appUrl: string;
  brandColor?: string;
}): EmailContent {
  const displayName = toSafeText(input.name, "there");
  return renderBaseTemplate({
    title: "Welcome to SendCat",
    previewText: "Thanks for joining SendCat.",
    greeting: `Hi ${displayName},`,
    bodyLines: [
      "Thanks for signing up. You can now track orders, organize updates, and keep everything in one place.",
      "If you ever need help, reach out to support@mail.sendcat.app and we will be happy to assist.",
    ],
    ctaLabel: "Go to SendCat",
    ctaHref: input.appUrl,
    footerText: "Questions? support@mail.sendcat.app",
    brandColor: input.brandColor,
  });
}

export function buildResetPasswordEmail(input: {
  name?: string | null;
  resetUrl: string;
  brandColor?: string;
}): EmailContent {
  const displayName = toSafeText(input.name, "there");
  return renderBaseTemplate({
    title: "Reset your password",
    previewText: "Use this link to reset your SendCat password.",
    greeting: `Hi ${displayName},`,
    bodyLines: [
      "We received a request to reset your SendCat password. If you made this request, click the button below.",
      "If you did not request this, you can safely ignore this email.",
    ],
    ctaLabel: "Reset Password",
    ctaHref: input.resetUrl,
    footerText: "Questions? support@mail.sendcat.app",
    brandColor: input.brandColor,
  });
}
