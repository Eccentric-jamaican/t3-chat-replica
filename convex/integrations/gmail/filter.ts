import { merchantConfigs, type MerchantKey } from "./merchantConfig";
import type { GmailMessageLite } from "./types";

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

function rootDomainFromHost(host: string): string {
  const h = normalizeDomain(host);
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

function getHeader(headers: { name: string; value: string }[], name: string): string | null {
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function extractEmailAddressDomain(value: string): string | null {
  // Handles: "Name <user@domain.com>" or "user@domain.com"
  const v = value.trim();
  const m = v.match(/@([^>\s]+)/);
  if (!m) return null;
  return rootDomainFromHost(m[1]!);
}

export function extractDkimHeaderDomainsFromAuthResults(authResults: string): string[] {
  // Gmail often includes: dkim=pass header.d=example.com
  // Sometimes: dkim=pass header.i=@example.com; d=example.com
  const domains = new Set<string>();

  const lower = authResults.toLowerCase();
  if (!lower.includes("dkim=pass")) return [];

  // header.d=domain
  for (const m of authResults.matchAll(/header\.d=([^;\s]+)/gi)) {
    domains.add(rootDomainFromHost(m[1]!));
  }

  // fallback: d=domain
  for (const m of authResults.matchAll(/\bd=([^;\s]+)/gi)) {
    domains.add(rootDomainFromHost(m[1]!));
  }

  return [...domains].filter(Boolean);
}

export function extractLikelyDkimDomains(headers: { name: string; value: string }[]): string[] {
  // Prefer Authentication-Results, fall back to ARC-Authentication-Results.
  const domains = new Set<string>();

  const auth = getHeader(headers, "Authentication-Results");
  if (auth) {
    for (const d of extractDkimHeaderDomainsFromAuthResults(auth)) domains.add(d);
  }

  const arc = getHeader(headers, "ARC-Authentication-Results");
  if (arc) {
    for (const d of extractDkimHeaderDomainsFromAuthResults(arc)) domains.add(d);
  }

  return [...domains];
}

function textIncludesAny(haystack: string, needles: string[]): boolean {
  const s = haystack.toLowerCase();
  return needles.some((n) => s.includes(n.toLowerCase()));
}

function stripHtmlToText(html: string): string {
  // Very small HTML -> text utility: remove tags and collapse whitespace.
  // This is intentionally lightweight; we can replace with a more robust transformer later.
  return html
    .replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, " ")
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, " ")
    .replace(/<\s*head[^>]*>[\s\S]*?<\s*\/\s*head\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<\s*\/(td|th|tr|li|div|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export type MerchantMatchResult =
  | { matched: true; merchant: MerchantKey; reason: string }
  | { matched: false; reason: string };

export function shouldProcessGmailMessage(opts: {
  message: GmailMessageLite;
  bodyText?: string; // Prefer full decoded body text
  bodyHtml?: string; // Optional, we will strip to text
}): MerchantMatchResult {
  const { message } = opts;

  // We used to hard-block CATEGORY_PROMOTIONS, but legitimate transactional
  // receipts can land there. Keep using merchant + intent checks below to
  // avoid most marketing noise.

  const headers = message.payload?.headers ?? [];
  const subject = getHeader(headers, "Subject") ?? "";

  const dkimDomains = extractLikelyDkimDomains(headers);
  const fromDomain = (() => {
    const from = getHeader(headers, "From");
    return from ? extractEmailAddressDomain(from) : null;
  })();
  const replyToDomain = (() => {
    const reply = getHeader(headers, "Reply-To");
    return reply ? extractEmailAddressDomain(reply) : null;
  })();

  const snippet = message.snippet ?? "";
  // Prefer plain-text bodies when present, but fall back to HTML-derived text if the
  // text body is empty (common when Gmail returns only HTML parts).
  const bodyText = (() => {
    const t = opts.bodyText ?? "";
    if (t.trim().length > 0) return t;
    return opts.bodyHtml ? stripHtmlToText(opts.bodyHtml) : "";
  })();
  const combinedText = `${subject}\n${snippet}\n${bodyText}`.trim();

  // Evaluate against each merchant config; return first strong match.
  for (const merchant of Object.values(merchantConfigs)) {
    const allow = merchant.dkimAllow.map(rootDomainFromHost);
    const deny = (merchant.dkimDeny ?? []).map(rootDomainFromHost);

    const dkimMatch = dkimDomains.some((d) => allow.includes(rootDomainFromHost(d)));
    const dkimDenied = dkimDomains.some((d) => deny.includes(rootDomainFromHost(d)));

    if (dkimDenied) {
      continue;
    }

    // If we have DKIM, prefer it. If not, fall back to From/Reply-To allowlists.
    const fromAllow = (merchant.fromAllow ?? allow).map(rootDomainFromHost);
    const fromMatch =
      (fromDomain ? fromAllow.includes(rootDomainFromHost(fromDomain)) : false) ||
      (replyToDomain ? fromAllow.includes(rootDomainFromHost(replyToDomain)) : false);

    const identityOk = dkimDomains.length > 0 ? dkimMatch : fromMatch;
    if (!identityOk) continue;

    // Intent filters: must include transactional signals, and must NOT look like promo.
    if (textIncludesAny(subject, merchant.subjectExclude)) {
      continue;
    }

    const hasInclude = textIncludesAny(subject, merchant.subjectInclude) || textIncludesAny(combinedText, merchant.subjectInclude);
    if (!hasInclude) continue;

    const hasBodyMarker = textIncludesAny(combinedText, merchant.requiredBodyMarkers);
    if (!hasBodyMarker) continue;

    return { matched: true, merchant: merchant.key, reason: "merchant_match" };
  }

  return { matched: false, reason: "no_merchant_match" };
}
