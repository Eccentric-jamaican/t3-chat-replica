import { useEffect, useMemo, useRef, useState } from "react";
import { ShoppingBag, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trackEvent } from "../../lib/analytics";

interface EbayToolResultProps {
  isLoading: boolean;
  result?: unknown;
  args?: string;
  title?: string;
  loadingText?: string;
}

export function EbayToolResult({
  isLoading,
  result,
  args,
  title = "Searched products",
  loadingText,
}: EbayToolResultProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasTrackedResult = useRef(false);

  const parsedArgs = useMemo(() => {
    if (!args) return null;
    try {
      return JSON.parse(args);
    } catch (e) {
      return null;
    }
  }, [args]);

  const query = typeof parsedArgs?.query === "string" ? parsedArgs.query : "";

  const filters = useMemo(() => {
    if (!parsedArgs) return [] as string[];
    const list: string[] = [];

    if (typeof parsedArgs.condition === "string") {
      const label = parsedArgs.condition
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      list.push(label);
    }

    if (typeof parsedArgs.shipping === "string") {
      list.push(
        parsedArgs.shipping === "free" ? "Free shipping" : "Fast shipping",
      );
    }

    const minPrice = Number(parsedArgs.minPrice);
    const maxPrice = Number(parsedArgs.maxPrice);
    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      const minLabel = Number.isFinite(minPrice) ? `$${minPrice}` : "";
      const maxLabel = Number.isFinite(maxPrice) ? `$${maxPrice}` : "";
      if (minLabel && maxLabel) list.push(`${minLabel}-${maxLabel}`);
      else if (minLabel) list.push(`Over ${minLabel}`);
      else if (maxLabel) list.push(`Under ${maxLabel}`);
    }

    const sellerRating = Number(parsedArgs.sellerRating);
    if (Number.isFinite(sellerRating)) {
      list.push(`${Math.round(sellerRating)}%+ seller`);
    }

    if (
      typeof parsedArgs.categoryName === "string" &&
      parsedArgs.categoryName
    ) {
      list.push(`Category: ${parsedArgs.categoryName}`);
    } else if (
      typeof parsedArgs.categoryId === "string" &&
      parsedArgs.categoryId
    ) {
      list.push(`Category: ${parsedArgs.categoryId}`);
    }

    if (typeof parsedArgs.location === "string" && parsedArgs.location) {
      list.push(`Location: ${parsedArgs.location}`);
    }

    return list;
  }, [parsedArgs]);

  const resultText = useMemo(() => {
    if (typeof result === "string") return result;
    if (result == null) return "";
    try {
      return JSON.stringify(result);
    } catch (e) {
      return String(result);
    }
  }, [result]);

  if (isLoading) {
    const loadingLabel =
      loadingText ||
      (query
        ? `Searching products for: \"${query}\"...`
        : "Searching products...");
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-foreground/60">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  if (!resultText) return null;

  const countMatch = resultText.match(/found\s+(\d+)\s+items?/i);
  const count = countMatch ? Number.parseInt(countMatch[1], 10) : null;
  const ebayCountMatch = resultText.match(
    /(\d+)\s+(?:items\s+on\s+eBay|eBay items)/i,
  );
  const globalCountMatch = resultText.match(/(\d+)\s+global/i);
  const ebayCount = ebayCountMatch
    ? Number.parseInt(ebayCountMatch[1], 10)
    : undefined;
  const globalCount = globalCountMatch
    ? Number.parseInt(globalCountMatch[1], 10)
    : undefined;
  const combinedCount =
    (typeof ebayCount === "number" ? ebayCount : 0) +
    (typeof globalCount === "number" ? globalCount : 0);

  useEffect(() => {
    if (hasTrackedResult.current || isLoading || !resultText) return;
    hasTrackedResult.current = true;
    trackEvent("tool_result_render", {
      tool_name: "search_products",
      query,
      total_count: combinedCount > 0 ? combinedCount : count ?? null,
      ebay_count: ebayCount,
      global_count: globalCount,
    });
  }, [combinedCount, count, ebayCount, globalCount, isLoading, query, resultText]);

  let summary = resultText;
  if (/limit reached/i.test(resultText)) {
    summary = "eBay search limit reached for this turn.";
  } else if (/skipped duplicate/i.test(resultText)) {
    summary = "Duplicate eBay search skipped to reduce costs.";
  } else if (/^error:/i.test(resultText)) {
    summary = resultText.replace(/^error:\s*/i, "");
  } else if (combinedCount > 0) {
    summary = `Found ${combinedCount} items. Showing product cards below.`;
  } else if (count !== null) {
    summary = `Found ${count} items. Showing product cards below.`;
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg text-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-2.5 text-left transition-colors hover:bg-black/5"
      >
        <div className="flex items-center gap-2 font-medium text-foreground/80">
          <ShoppingBag size={14} className="text-amber-500" />
          <span>{title}</span>
        </div>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 p-2 pt-0">
              {query && (
                <div className="font-mono text-xs text-foreground/50">
                  Query: {query}
                </div>
              )}
              {filters.length > 0 && (
                <div className="text-xs text-foreground/60">
                  Filters: {filters.join(" · ")}
                </div>
              )}
              <div className="text-xs text-foreground/60">{summary}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
