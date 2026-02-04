import * as React from "react";
import { Plus, Check, Loader2, Heart } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { type Product } from "../../data/mockProducts";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { trackEvent } from "../../lib/analytics";

interface FavoriteListSelectorProps {
  product: Product;
  trigger: React.ReactNode;
}

export function FavoriteListSelector({ product, trigger }: FavoriteListSelectorProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [newListName, setNewListName] = React.useState("");
  
  const favData = useQuery(api.favorites.listFavorites);
  const userFavorites = useQuery(api.favorites.getUserFavoritesIds);
  const toggleFavorite = useMutation(api.favorites.toggleFavorite);
  const createList = useMutation(api.favorites.createList);

  const lists = favData?.lists || [];
  const productFavorites =
    userFavorites?.filter(
      (f) => f.externalId === product.id && f.type === "product",
    ) || [];
  
  const handleToggle = async (listId?: any) => {
    const wasInList = productFavorites.some(
      (favorite) => favorite.listId === listId,
    );
    try {
      await toggleFavorite({
        type: "product",
        externalId: product.id,
        item: product,
        listId,
      });
      trackEvent(wasInList ? "favorite_removed" : "favorite_added", {
        product_id: product.id,
        list_id: listId ?? "all",
        source: product.source,
      });
    } catch (error) {
      toast.error("Failed to update favorite");
    }
  };

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    
    try {
      const listId = await createList({ name: newListName.trim() });
      await toggleFavorite({
        type: "product",
        externalId: product.id,
        item: product,
        listId,
      });
      trackEvent("favorite_list_created", {
        list_id: listId,
        list_name: newListName.trim(),
      });
      trackEvent("favorite_added", {
        product_id: product.id,
        list_id: listId,
        source: product.source,
      });
      setNewListName("");
      setIsCreating(false);
      toast.success(`Created "${newListName}" and added product`);
    } catch (error) {
      toast.error("Failed to create list");
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent 
        className="w-64 p-0 overflow-hidden bg-white shadow-xl border border-gray-100 rounded-2xl" 
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-gray-50 bg-gray-50/50">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Save to</h4>
        </div>
        
        <div className="max-h-60 overflow-y-auto p-1 py-2">
          {/* General List (No List ID) Option */}
          <button
            onClick={() => handleToggle(undefined)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left group"
          >
            <div className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all",
              productFavorites.some(f => f.listId === undefined)
                ? "border-[#a23b67] bg-[#a23b67]"
                : "border-gray-300 bg-white group-hover:border-gray-400"
            )}>
              {productFavorites.some(f => f.listId === undefined) && (
                <Check className="h-3.5 w-3.5 stroke-[3] text-white" />
              )}
            </div>
            <span className="text-sm font-medium text-gray-700">All Favorites</span>
          </button>

          {lists.map((list) => {
            const isItemInList = productFavorites.some(f => f.listId === list._id);
            return (
              <button
                key={list._id}
                onClick={() => handleToggle(list._id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors text-left group"
              >
                <div className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all",
                  isItemInList
                    ? "border-[#a23b67] bg-[#a23b67]"
                    : "border-gray-300 bg-white group-hover:border-gray-400"
                )}>
                  {isItemInList && (
                    <Check className="h-3.5 w-3.5 stroke-[3] text-white" />
                  )}
                </div>
                <span className="text-sm font-medium text-gray-700 truncate">{list.name}</span>
              </button>
            );
          })}
        </div>

        <div className="p-2 border-t border-gray-50 bg-gray-50/30">
          <AnimatePresence mode="wait">
            {!isCreating ? (
              <motion.button
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/5 rounded-xl transition-colors"
              >
                <Plus size={14} className="stroke-[3]" />
                <span>Create new list</span>
              </motion.button>
            ) : (
              <motion.form
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onSubmit={handleCreateList}
                className="flex flex-col gap-2 p-1"
              >
                <input
                  autoFocus
                  placeholder="List name..."
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all text-gray-700"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 px-3 py-2 text-xs font-bold text-white bg-primary rounded-xl hover:bg-primary-deep transition-colors"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setNewListName("");
                    }}
                    className="px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </PopoverContent>
    </Popover>
  );
}
