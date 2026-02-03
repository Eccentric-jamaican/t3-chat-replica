type ToolParseResult = {
  toolCalls: any[];
  cleaned: string;
  hasOpenTag: boolean;
};

function generateToolCallId() {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoObj?.randomUUID) {
    return `call_${cryptoObj.randomUUID()}`;
  }
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function buildFallbackKey(item: any) {
  const title =
    typeof item?.title === "string" ? item.title.trim().toLowerCase() : "";
  const price =
    typeof item?.price === "string" ? item.price.trim().toLowerCase() : "";
  const merchant =
    typeof item?.merchantName === "string"
      ? item.merchantName.trim().toLowerCase()
      : typeof item?.merchantDomain === "string"
        ? item.merchantDomain.trim().toLowerCase()
        : "";
  const image =
    typeof item?.image === "string" ? item.image.trim().toLowerCase() : "";
  const combined = [title, price, merchant, image].filter(Boolean).join("|");
  if (combined) return combined;
  try {
    return JSON.stringify({
      title: title || undefined,
      price: price || undefined,
      merchant: merchant || undefined,
      image: image || undefined,
    });
  } catch {
    return "";
  }
}

export function dedupeProducts(items: any[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    let key =
      typeof item?.url === "string"
        ? item.url
        : typeof item?.productUrl === "string"
          ? item.productUrl
          : typeof item?.id === "string"
            ? item.id
            : "";

    if (!key) {
      key = buildFallbackKey(item);
      if (key) {
        console.warn(
          "[dedupeProducts] Missing primary key, falling back to derived key.",
        );
      }
    }

    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseFunctionCallsFromContent(content: string): ToolParseResult {
  if (!content.includes("<function_calls")) {
    return { toolCalls: [], cleaned: content, hasOpenTag: false };
  }

  const hasOpenTag =
    content.includes("<function_calls") && !content.includes("</function_calls>");
  const regex = /<function_calls>([\s\S]*?)<\/function_calls>/gi;
  const toolCalls: any[] = [];
  let cleaned = content;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) {
      cleaned = cleaned.replace(match[0], "");
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const name =
          typeof item.name === "string"
            ? item.name
            : typeof item.type === "string"
              ? item.type
              : "";
        if (!name) continue;
        const argumentsIsObject =
          typeof item.arguments === "object" &&
          item.arguments !== null &&
          !Array.isArray(item.arguments);
        const args = argumentsIsObject
          ? item.arguments
          : (() => {
              const nextArgs = { ...item };
              delete nextArgs.name;
              delete nextArgs.type;
              delete nextArgs.arguments;
              return nextArgs;
            })();
        toolCalls.push({
          id: generateToolCallId(),
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(args),
          },
        });
      }
    } catch {}
    cleaned = cleaned.replace(match[0], "");
  }

  return { toolCalls, cleaned, hasOpenTag };
}
