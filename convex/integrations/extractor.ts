import type { ExtractionResult } from "./types";
import { extractTrackingNumbers } from "./tracking";

const EXTRACTION_PROMPT = `You are a purchase-data extraction engine. Given the text of an e-commerce email or message, extract these fields as JSON:

{
  "merchant": "string (amazon, shein, ebay, temu, or other store name)",
  "storeName": "string (display name of the store)",
  "orderNumber": "string or null",
  "itemsSummary": "string (brief summary of items purchased) or null",
  "valueTotal": "number (total value in the original currency, as a decimal like 49.99) or null",
  "currency": "string (ISO 4217 code like USD, GBP, JMD) or null",
  "trackingNumbers": ["string array of tracking numbers found"],
  "carrier": "string (ups, usps, fedex, dhl, amazon) or null",
  "invoicePresent": "boolean (true if message contains or references an invoice/receipt)",
  "confidence": "number 0-1 (your confidence in the extraction accuracy)"
}

Rules:
- Only extract data explicitly present in the text
- If a field is not found, use null
- For trackingNumbers, extract ALL tracking numbers found
- confidence should reflect how complete and certain the data is
- Return ONLY valid JSON, no markdown fences or explanation`;

const MODELS = {
  primary: "google/gemini-2.0-flash-001",
  fallback: "mistralai/mistral-small-latest",
} as const;

/**
 * Extracts purchase data from text (email body, WhatsApp text, etc.)
 * using OpenRouter LLM with primary + fallback models.
 */
export async function extractPurchaseData(opts: {
  text: string;
  source: "gmail" | "whatsapp" | "manual";
  apiKey: string;
  merchantHint?: string;
}): Promise<ExtractionResult> {
  const { text, source, apiKey, merchantHint } = opts;

  const userContent = merchantHint
    ? `Source: ${source}\nMerchant hint: ${merchantHint}\n\n${text}`
    : `Source: ${source}\n\n${text}`;

  let rawJson: string | null = null;

  for (const model of [MODELS.primary, MODELS.fallback]) {
    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://sendcat.app",
            "X-Title": "Sendcat Pre-Alert Extraction",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: EXTRACTION_PROMPT },
              { role: "user", content: userContent },
            ],
            temperature: 0.1,
            max_tokens: 1024,
            response_format: { type: "json_object" },
          }),
        },
      );

      if (!response.ok) {
        console.error(`[Extractor] ${model} HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) continue;

      // Validate that the content is parseable JSON before accepting it,
      // so a malformed response from the primary model doesn't prevent
      // the fallback from running.
      const cleaned = content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      JSON.parse(cleaned); // throws if not valid JSON
      rawJson = content;
      break;
    } catch (err) {
      console.error(`[Extractor] ${model} error:`, err);
      continue;
    }
  }

  if (!rawJson) {
    throw new Error("All extraction models failed");
  }

  return normalizeExtractionResult(rawJson, text);
}

/**
 * Extracts purchase data from an image (WhatsApp screenshot, receipt photo, etc.)
 * using vision-capable LLM models.
 */
export async function extractFromImage(opts: {
  imageUrl: string;
  apiKey: string;
}): Promise<ExtractionResult> {
  // For images: Mistral OCR primary, Gemini fallback
  const models = [MODELS.fallback, MODELS.primary];

  for (const model of models) {
    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://sendcat.app",
            "X-Title": "Sendcat Pre-Alert Extraction",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: EXTRACTION_PROMPT },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extract purchase data from this image:",
                  },
                  { type: "image_url", image_url: { url: opts.imageUrl } },
                ],
              },
            ],
            temperature: 0.1,
            max_tokens: 1024,
          }),
        },
      );

      if (!response.ok) continue;
      const data = await response.json();
      const rawJson = data.choices?.[0]?.message?.content;
      if (rawJson) return normalizeExtractionResult(rawJson, "");
    } catch {
      continue;
    }
  }

  throw new Error("All image extraction models failed");
}

/**
 * Normalizes raw LLM JSON output into a structured ExtractionResult.
 * Merges regex-detected tracking numbers with LLM-extracted ones.
 */
function normalizeExtractionResult(
  rawJson: string,
  originalText: string,
): ExtractionResult {
  // Strip markdown fences if present
  const cleaned = rawJson
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  const parsed = JSON.parse(cleaned);

  // Extract tracking numbers from the original text via regex
  const regexTracking = extractTrackingNumbers(originalText);
  const llmTracking = (parsed.trackingNumbers || []).map((n: string) => ({
    number: n.trim().toUpperCase(),
    carrier: parsed.carrier || null,
  }));

  // Merge: prefer regex-detected (more reliable), add LLM-only ones
  const seenNumbers = new Set(regexTracking.map((t) => t.number));
  const mergedTracking = [...regexTracking];
  for (const t of llmTracking) {
    if (t.number && !seenNumbers.has(t.number)) {
      seenNumbers.add(t.number);
      mergedTracking.push(t);
    }
  }

  // Normalize value to USD cents
  const valueUsd =
    parsed.valueTotal != null ? Math.round(parsed.valueTotal * 100) : null;

  // Compute missing fields
  const missingFields: string[] = [];
  if (!parsed.orderNumber) missingFields.push("orderNumber");
  if (parsed.valueTotal == null) missingFields.push("valueUsd");
  if (mergedTracking.length === 0) missingFields.push("trackingNumbers");
  if (!parsed.itemsSummary) missingFields.push("itemsSummary");

  return {
    merchant: parsed.merchant || "unknown",
    storeName: parsed.storeName || parsed.merchant || "Unknown Store",
    orderNumber: parsed.orderNumber || null,
    itemsSummary: parsed.itemsSummary || null,
    valueUsd,
    currency: parsed.currency || null,
    originalValue:
      parsed.valueTotal != null ? Math.round(parsed.valueTotal * 100) : null,
    trackingNumbers: mergedTracking,
    invoicePresent: !!parsed.invoicePresent,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    missingFields,
  };
}
