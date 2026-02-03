import { createFileRoute } from "@tanstack/react-router";
import { Sidebar } from "../components/layout/Sidebar";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ProductCard } from "../components/product/ProductCard";
import { ProductDrawer } from "../components/product/ProductDrawer";
import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Edit2, Heart, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import { useIsMobile } from "../hooks/useIsMobile";
import { authClient } from "../lib/auth";
import { type Product } from "../data/mockProducts";

type FavoritesSearchParams = {
  productId?: string;
};

export const Route = createFileRoute("/favorites")({
  validateSearch: (search: Record<string, unknown>): FavoritesSearchParams => ({
    productId:
      typeof search.productId === "string" ? search.productId : undefined,
  }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const { data: session, isPending } = authClient.useSession();
  const isAuthenticated = !isPending && !!session;
  const { productId } = Route.useSearch();

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  // Favorites logic
  const favoritesData = useQuery(
    api.favorites.listFavorites,
    isAuthenticated ? {} : "skip",
  );
  const createList = useMutation(api.favorites.createList);
  const renameList = useMutation(api.favorites.renameList);
  const deleteList = useMutation(api.favorites.deleteList);

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | "product" | "brand">("all");
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editListName, setEditListName] = useState("");
  const productLookup = useMemo(() => {
    const lookup = new Map<string, Product>();
    favoritesData?.favorites.forEach((fav: any) => {
      if (!fav?.item?.id) return;
      lookup.set(fav.item.id, fav.item as Product);
    });
    return lookup;
  }, [favoritesData?.favorites]);

  if (isPending) return null;

  return (
    <div className="relative flex h-dvh min-h-screen overflow-hidden bg-background">
      <div className="edge-glow-top" />
      <div className="edge-glow-bottom" />
      <div className="bg-noise" />

      <Sidebar isOpen={sidebarOpen} onToggle={setSidebarOpen} />

      <main className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 overflow-hidden">
          {/* Lists Sidebar */}
          <aside className="w-64 shrink-0 border-r border-black/5 bg-black/[0.02] px-4 pt-24 pb-24 hidden md:block overflow-y-auto">
             <div className="space-y-4">
                <button
                  onClick={() => setSelectedListId(null)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-black/5",
                    selectedListId === null ? "bg-black/5 text-foreground" : "text-foreground/50"
                  )}
                >
                  <span>All Favorites</span>
                  {favoritesData && <span className="text-[10px] tabular-nums">{favoritesData.favorites.length}</span>}
                </button>

                <div className="space-y-1">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/30">My Lists</span>
                    <button 
                      onClick={() => setIsCreatingList(true)}
                      className="text-foreground/30 hover:text-primary transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {isCreatingList && (
                    <div className="px-3 pb-2 pt-1">
                      <input
                        autoFocus
                        className="w-full rounded-lg bg-white border border-black/5 px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="New list name..."
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            await createList({ name: newListName });
                            setNewListName("");
                            setIsCreatingList(false);
                          } else if (e.key === "Escape") {
                            setIsCreatingList(false);
                          }
                        }}
                        onBlur={() => !newListName && setIsCreatingList(false)}
                      />
                    </div>
                  )}

                  {favoritesData?.lists.map((list: any) => (
                    <div key={list._id} className="group relative">
                      {editingListId === list._id ? (
                        <div className="px-3 py-1">
                          <input
                            autoFocus
                            className="w-full rounded-lg bg-white border border-black/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                            value={editListName}
                            onChange={(e) => setEditListName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter") {
                                await renameList({ listId: list._id, name: editListName });
                                setEditingListId(null);
                              } else if (e.key === "Escape") {
                                setEditingListId(null);
                              }
                            }}
                            onBlur={() => setEditingListId(null)}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setSelectedListId(list._id)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-black/5",
                            selectedListId === list._id ? "bg-black/5 text-foreground" : "text-foreground/50"
                          )}
                        >
                          <span className="truncate">{list.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] tabular-nums group-hover:hidden">
                              {favoritesData.favorites.filter((f: any) => f.listId === list._id).length}
                            </span>
                            <div className="hidden items-center gap-1 group-hover:flex">
                              <Edit2 size={12} className="cursor-pointer hover:text-primary" onClick={(e) => {
                                e.stopPropagation();
                                setEditingListId(list._id);
                                setEditListName(list.name);
                              }} />
                              <Trash2 size={12} className="cursor-pointer hover:text-red-500" onClick={(e) => {
                                e.stopPropagation();
                                deleteList({ listId: list._id });
                                if (selectedListId === list._id) setSelectedListId(null);
                              }} />
                            </div>
                          </div>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
             </div>
          </aside>

          {/* Favorites Content */}
          <div className="flex-1 overflow-y-auto px-4 pt-24 pb-24 md:px-8">
             {!isAuthenticated ? (
               <div className="mx-auto mt-12 w-full max-w-md px-6 py-12 md:py-20">
                 <motion.div
                   initial={{ opacity: 0, y: 20 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ duration: 0.5 }}
                 >
                   <div className="text-center">
                     <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                       <Heart size={32} className="text-primary" />
                     </div>
                     <h1 className="mb-2 text-2xl font-bold text-foreground">
                       Sign in Required
                     </h1>
                     <p className="mb-8 text-foreground/50">
                       Sign in to view and manage your favorites.
                     </p>
                     <button
                       onClick={() => (window.location.href = "/sign-in")}
                       className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-deep"
                     >
                       Sign In
                     </button>
                   </div>
                 </motion.div>
               </div>
             ) : !favoritesData ? (
               <div className="flex h-full items-center justify-center">
                 <Loader2 className="h-8 w-8 animate-spin text-primary/30" />
               </div>
             ) : (
               <div className="space-y-6 md:space-y-8">
                  {/* Mobile category switcher */}
                  <div className="md:hidden">
                    <div className="scrollbar-hide flex gap-4 overflow-x-auto pb-4">
                      <button
                        onClick={() => setSelectedListId(null)}
                        className={cn(
                          "whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-bold transition-all",
                          selectedListId === null ? "bg-primary text-white" : "bg-black/5 text-foreground/50"
                        )}
                      >
                        All Favorites
                      </button>
                      {favoritesData.lists.map((list: any) => (
                        <button
                          key={list._id}
                          onClick={() => setSelectedListId(list._id)}
                          className={cn(
                            "whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-bold transition-all",
                            selectedListId === list._id ? "bg-primary text-white" : "bg-black/5 text-foreground/50"
                          )}
                        >
                          {list.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="relative flex gap-1.5 rounded-xl bg-black/5 p-1">
                      {(["all", "product", "brand"] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setFilterType(type)}
                          className={cn(
                            "relative z-10 rounded-lg px-4 py-1.5 text-xs font-bold transition-colors",
                            filterType === type ? "text-foreground" : "text-foreground/40 hover:text-foreground/60"
                          )}
                        >
                          {filterType === type && (
                            <motion.div
                              layoutId="filterToggleBackground"
                              className="absolute inset-0 rounded-lg bg-white shadow-sm"
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                          )}
                          <span className="relative z-10">
                            {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1) + "s"}
                          </span>
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/30">
                      {favoritesData.favorites.length} Items total
                    </span>
                  </div>

                  {favoritesData.favorites.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      <AnimatePresence mode="popLayout">
                        {favoritesData.favorites
                          .filter((f: any) => (selectedListId ? f.listId === selectedListId : true) && (filterType === "all" ? true : f.type === filterType))
                          .map((fav: any) => (
                            <motion.div
                              key={fav._id}
                              layout
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ProductCard product={fav.item} />
                            </motion.div>
                          ))}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-black/5">
                        <Heart size={32} className="text-foreground/10" />
                      </div>
                      <h2 className="text-xl font-bold text-foreground/90">No favorites yet</h2>
                      <p className="mt-2 text-sm text-foreground/40 max-w-xs">
                        Tap the heart on any product to save it to your favorites.
                      </p>
                    </div>
                  )}
               </div>
             )}
          </div>
        </div>
      </main>

      <AnimatePresence>
        {productId && (
          <ProductDrawer
            productId={productId}
            initialData={productLookup.get(productId)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
