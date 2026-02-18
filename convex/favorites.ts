import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";
import {
  assertOwnedByUser,
  getOptionalAuthenticatedUserId,
  requireAuthenticatedUserId,
} from "./lib/authGuards";
import { throwFunctionError } from "./lib/functionErrors";

async function verifyListAccess(
  ctx: QueryCtx | MutationCtx,
  listId: Id<"favoriteLists">,
  functionName: string,
): Promise<{ list: Doc<"favoriteLists">; userId: string }> {
  const userId = await requireAuthenticatedUserId(ctx, functionName);
  const list = await ctx.db.get(listId);
  if (!list) {
    throwFunctionError("not_found", functionName, "List not found");
  }
  assertOwnedByUser(userId, list.userId, functionName, {
    forbiddenMessage: "List not found or access denied",
  });
  return { list, userId };
}

export const createList = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "favorites.createList",
    );
    return await ctx.db.insert("favoriteLists", {
      userId,
      name: args.name,
      createdAt: Date.now(),
    });
  },
});

export const renameList = mutation({
  args: { listId: v.id("favoriteLists"), name: v.string() },
  handler: async (ctx, args) => {
    await verifyListAccess(ctx, args.listId, "favorites.renameList");
    await ctx.db.patch(args.listId, { name: args.name });
  },
});

export const deleteList = mutation({
  args: { listId: v.id("favoriteLists") },
  handler: async (ctx, args) => {
    await verifyListAccess(ctx, args.listId, "favorites.deleteList");
    // Delete all favorites associated with this list
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    for (const fav of favorites) {
      await ctx.db.delete(fav._id);
    }
    await ctx.db.delete(args.listId);
  },
});

export const toggleFavorite = mutation({
  args: {
    listId: v.optional(v.id("favoriteLists")),
    type: v.union(v.literal("product"), v.literal("brand")),
    externalId: v.string(),
    item: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "favorites.toggleFavorite",
    );

    // Check if it exists in the specific list (or general if listId is undefined)
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_item_type", (q) =>
        q
          .eq("userId", userId)
          .eq("externalId", args.externalId)
          .eq("type", args.type)
      )
      .collect();

    const inSpecifiedList = existing.find(f => f.listId === args.listId);

    if (inSpecifiedList) {
      await ctx.db.delete(inSpecifiedList._id);
      return { action: "removed", id: inSpecifiedList._id };
    } else {
      const id = await ctx.db.insert("favorites", {
        userId,
        listId: args.listId,
        type: args.type,
        externalId: args.externalId,
        item: args.item,
        createdAt: Date.now(),
      });
      return { action: "added", id };
    }
  },
});

export const removeFromList = mutation({
  args: {
    listId: v.optional(v.id("favoriteLists")),
    type: v.union(v.literal("product"), v.literal("brand")),
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "favorites.removeFromList",
    );

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user_item_type", (q) =>
        q
          .eq("userId", userId)
          .eq("externalId", args.externalId)
          .eq("type", args.type)
      )
      .collect();

    for (const fav of favorites) {
      if (fav.listId === args.listId) {
        await ctx.db.delete(fav._id);
      }
    }
  },
});

export const listFavorites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthenticatedUserId(ctx);
    if (!userId) return null;

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const lists = await ctx.db
      .query("favoriteLists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return { favorites, lists };
  },
});

export const getUserFavoritesIds = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthenticatedUserId(ctx);
    if (!userId) return [];

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return favorites.map((f) => ({
      externalId: f.externalId,
      listId: f.listId,
      type: f.type,
    }));
  },
});
