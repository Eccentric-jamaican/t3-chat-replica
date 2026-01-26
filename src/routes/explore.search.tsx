import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ProductGrid } from "../components/product/ProductGrid";
import { useIsMobile } from "../hooks/useIsMobile";
import { Search } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";

type SearchParams = {
  q?: string;
};

export const Route = createFileRoute("/explore/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: SearchResults,
});

function SearchResults() {
  const { q } = Route.useSearch();
  const isMobile = useIsMobile();
  const searchAction = useAction(api.explore.getExploreItems);
  const [items, setItems] = useState<any[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil((items?.length ?? 0) / pageSize));

  useEffect(() => {
    setPage(1);
  }, [q, items?.length]);

  useEffect(() => {
    async function fetchResults() {
      setIsLoading(true);
      try {
        const results = await searchAction({ q: q || undefined });
        setItems(results);
      } catch (err) {
        console.error("Search failed:", err);
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchResults();
  }, [q, searchAction]);

  // We should update convex/explore.ts to handle this properly, but let's see what it does
  // Actually, I'll update explore.ts to handle a 'q' argument properly.

  const paginatedItems = useMemo(() => {
    if (!items) return [];
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const entries: Array<number | "ellipsis"> = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) entries.push("ellipsis");
    for (let i = start; i <= end; i += 1) entries.push(i);
    if (end < totalPages - 1) entries.push("ellipsis");
    entries.push(totalPages);

    return entries;
  }, [page, totalPages]);

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <main
        className={`mx-auto w-full max-w-6xl flex-1 px-4 pb-24 ${isMobile ? "pt-16" : "pt-12"}`}
      >
        {/* Filter Chips - Part of the page content */}
        <div className="scrollbar-hide -mx-4 mb-6 flex items-center gap-2 overflow-x-auto border-b border-black/5 px-4 py-4">
          {["Ratings", "Gender", "Price", "Condition", "Size", "Color"].map(
            (filter) => (
              <button
                key={filter}
                className="flex-shrink-0 rounded-full border border-black/5 bg-black/5 px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors hover:bg-black/10"
              >
                {filter}
              </button>
            ),
          )}
        </div>

        {isLoading ? (
          <div className="grid animate-pulse grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-[32px] bg-black/5" />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <div className="space-y-8">
            <ProductGrid
              products={paginatedItems}
              title="Search results for"
              subtitle={q ? `“${q}”` : undefined}
            />

            {totalPages > 1 && (
              <div className="pb-10">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        disabled={page === 1}
                      />
                    </PaginationItem>

                    {paginationItems.map((item, index) => (
                      <PaginationItem key={`${item}-${index}`}>
                        {item === "ellipsis" ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            isActive={item === page}
                            onClick={() => setPage(item)}
                          >
                            {item}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        onClick={() =>
                          setPage((prev) => Math.min(totalPages, prev + 1))
                        }
                        disabled={page === totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-4 py-20 text-center">
            <div className="rounded-full bg-black/5 p-6 text-foreground/20">
              <Search size={48} />
            </div>
            <div>
              <h3 className="text-xl font-bold">No results found</h3>
              <p className="text-foreground/50">
                Try searching for something else, like "hoodies" or "tech".
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
