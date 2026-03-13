export type MarkdownCompatibilityMode = "full" | "legacy_no_gfm";

function getUserAgent() {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function isLegacySafariMarkdownBrowser() {
  const ua = getUserAgent();
  if (!ua) return false;

  const isAppleMobile =
    /\b(iPhone|iPad|iPod)\b/i.test(ua) ||
    (/\bMacintosh\b/i.test(ua) && /\bMobile\b/i.test(ua));
  const isSafari =
    /\bSafari\b/i.test(ua) &&
    !/\b(CriOS|Chrome|FxiOS|Firefox|EdgiOS|EdgA|OPiOS|DuckDuckGo)\b/i.test(ua);
  const safariVersionMatch = ua.match(/\bVersion\/(\d+)(?:\.(\d+))?/i);

  if (!isAppleMobile || !isSafari || !safariVersionMatch) {
    return false;
  }

  const major = Number.parseInt(safariVersionMatch[1] ?? "", 10);
  return Number.isFinite(major) && major <= 15;
}

export function getMarkdownCompatibilityMode(): MarkdownCompatibilityMode {
  return isLegacySafariMarkdownBrowser() ? "legacy_no_gfm" : "full";
}
