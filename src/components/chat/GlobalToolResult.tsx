import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trackEvent } from "../../lib/analytics";

interface GlobalToolResultProps {
  isLoading: boolean;
  result?: unknown;
  args?: string;
}

export function GlobalToolResult({
  isLoading,
  result,
  args,
}: GlobalToolResultProps) {
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
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-foreground/60">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <span>
          {query
            ? `Searching global sites for: "${query}"...`
            : "Searching global sites..."}
        </span>
      </div>
    );
  }

  if (!resultText) return null;

  const countMatch = resultText.match(/found\s+(\d+)\s+items?/i);
  const count = countMatch ? Number.parseInt(countMatch[1], 10) : null;

  let summary = resultText;
  if (/limit reached/i.test(resultText)) {
    summary = "Global search limit reached for this turn.";
  } else if (/^error:/i.test(resultText)) {
    summary = resultText.replace(/^error:\s*/i, "");
  } else if (count !== null) {
    summary = `Found ${count} items. Showing product cards below.`;
  }

  useEffect(() => {
    if (hasTrackedResult.current || isLoading || !resultText) return;
    hasTrackedResult.current = true;
    trackEvent("tool_result_render", {
      tool_name: "search_global",
      query,
      total_count: count ?? null,
    });
  }, [count, isLoading, query, resultText]);

  return (
    <div className="my-2 overflow-hidden rounded-lg text-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between p-2.5 text-left transition-colors hover:bg-black/5"
      >
        <div className="flex items-center gap-2 font-medium text-foreground/80">
          <Globe size={14} className="text-emerald-500" />
          <span>Searched global sites</span>
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
              <div className="text-xs text-foreground/60">{summary}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
