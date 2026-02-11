type ToolParseResult = {
  toolCalls: any[];
  cleaned: string;
  hasOpenTag: boolean;
};

type FallbackToolParseOptions = {
  /**
   * If false, we will ignore any web-search tool calls found in text.
   * (Used to avoid running web search when the user has it disabled.)
   */
  allowWebSearch: boolean;
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

function coerceQuotedArg(raw: string): string {
  const s = raw.trim();
  if (
    (s.startsWith("\"") && s.endsWith("\"")) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Parse tool calls for models that don't support native OpenRouter tools.
 *
 * Supported formats (case-insensitive):
 * - [[SEARCH: query]] (legacy web-search only)
 * - [search_web: "query"]
 * - [search_products: "query"]
 *
 * Returns toolCalls plus cleaned content (tool blocks removed).
 */
export function parseFallbackToolCallsFromContent(
  content: string,
  opts: FallbackToolParseOptions,
): { toolCalls: any[]; cleaned: string } {
  const toolCalls: any[] = [];
  let cleaned = content;

  // Legacy / generic web search fallback
  if (opts.allowWebSearch) {
    const legacy = /\[\[\s*SEARCH\s*:\s*([^\]]+?)\s*\]\]/gi;
    cleaned = cleaned.replace(legacy, (_m, qRaw) => {
      const query = coerceQuotedArg(String(qRaw));
      if (query) {
        toolCalls.push({
          id: generateToolCallId(),
          type: "function",
          function: {
            name: "search_web",
            arguments: JSON.stringify({ query }),
          },
        });
      }
      return "";
    });
  }

  // Bracket-style tool hints present in BASE_SYSTEM_PROMPT examples.
  // These appear in the wild for some models (e.g. minimax) even when we
  // also provide [[SEARCH:]] guidance, so we support both.
  const bracket = /\[\s*(search_web|search_products)\s*:\s*([^\]]+?)\s*\]/gi;
  cleaned = cleaned.replace(bracket, (_m, nameRaw, argRaw) => {
    const name = String(nameRaw).toLowerCase();
    const query = coerceQuotedArg(String(argRaw));
    if (!query) return "";

    if (name === "search_web") {
      if (!opts.allowWebSearch) return "";
      toolCalls.push({
        id: generateToolCallId(),
        type: "function",
        function: {
          name: "search_web",
          arguments: JSON.stringify({ query }),
        },
      });
      return "";
    }

    if (name === "search_products") {
      toolCalls.push({
        id: generateToolCallId(),
        type: "function",
        function: {
          name: "search_products",
          arguments: JSON.stringify({ query }),
        },
      });
      return "";
    }

    return "";
  });

  // Minimax-specific tool call markup occasionally appears in content for models
  // without native OpenRouter tool support. Example:
  //
  // <minimax:tool_call>
  //   <invoke name="search_products">
  //     <parameter name="query">MacBook Pro M4 14 inch</parameter>
  //   </invoke>
  // </minimax:tool_call>
  //
  // We parse it and remove it from output so it does not show up as assistant text.
  const minimaxBlock =
    /<minimax:tool_call>\s*([\s\S]*?)\s*<\/minimax:tool_call>/gi;
  cleaned = cleaned.replace(minimaxBlock, (_m, innerRaw) => {
    const inner = String(innerRaw);
    // Some models emit literal backslashes before quotes (e.g. name=\"search_products\").
    // Support both `name="..."` and `name=\"...\"`.
    const invokeRe =
      /<invoke\s+name=\\?(["'])([^"']+?)\\?\1\s*>([\s\S]*?)<\/invoke>/gi;
    let invokeMatch: RegExpExecArray | null;
    while ((invokeMatch = invokeRe.exec(inner)) !== null) {
      const toolName = String(invokeMatch[2] ?? "").trim().toLowerCase();
      const body = String(invokeMatch[3] ?? "");

      const paramRe =
        /<parameter\s+name=\\?(["'])([^"']+?)\\?\1\s*>([\s\S]*?)<\/parameter>/gi;
      const params: Record<string, string> = {};
      let paramMatch: RegExpExecArray | null;
      while ((paramMatch = paramRe.exec(body)) !== null) {
        const k = String(paramMatch[2] ?? "").trim();
        const v = String(paramMatch[3] ?? "").trim();
        if (k) params[k] = v;
      }

      if (toolName === "search_web") {
        if (!opts.allowWebSearch) continue;
        const query = coerceQuotedArg(params.query ?? "");
        if (!query) continue;
        toolCalls.push({
          id: generateToolCallId(),
          type: "function",
          function: {
            name: "search_web",
            arguments: JSON.stringify({ query }),
          },
        });
        continue;
      }

      if (toolName === "search_products") {
        const query = coerceQuotedArg(params.query ?? "");
        if (!query) continue;
        toolCalls.push({
          id: generateToolCallId(),
          type: "function",
          function: {
            name: "search_products",
            arguments: JSON.stringify({ query }),
          },
        });
        continue;
      }
    }

    // Strip the whole minimax block regardless; if we couldn't parse it
    // it's better UX to avoid showing raw markup.
    return "";
  });

  return { toolCalls, cleaned };
}

/**
 * Detect whether a fallback tool call has started but isn't fully present yet.
 * Used to avoid flushing partial tool markup to the DB mid-stream.
 */
export function hasOpenFallbackToolCall(content: string): boolean {
  const lower = content.toLowerCase();

  // Minimax XML-ish wrapper
  if (
    lower.includes("<minimax:tool_call>") &&
    !lower.includes("</minimax:tool_call>")
  ) {
    return true;
  }

  // Legacy [[SEARCH: ...]] wrapper
  const legacyIdx = lower.lastIndexOf("[[search:");
  if (legacyIdx !== -1 && lower.indexOf("]]", legacyIdx) === -1) {
    return true;
  }

  // Bracket style [search_web: ...] / [search_products: ...]
  for (const p of ["[search_web:", "[search_products:"]) {
    const idx = lower.lastIndexOf(p);
    if (idx !== -1 && lower.indexOf("]", idx) === -1) {
      return true;
    }
  }

  return false;
}
