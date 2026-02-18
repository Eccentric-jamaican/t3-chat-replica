import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { getApplicationToken } from "./ebay";
import { internal } from "./_generated/api";
import { fetchWithRetry } from "./lib/network";

type EbayCategoryNode = {
  category?: {
    categoryId?: string;
    categoryName?: string;
  };
  childCategoryTreeNodes?: EbayCategoryNode[];
};

type FlatCategory = {
  categoryId: string;
  categoryName: string;
  parentId?: string;
  path: string;
  leaf: boolean;
};

function resolveMarketplaceId(value?: string) {
  return value ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
}

function normalizeCategoryName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenCategoryTree(
  node: EbayCategoryNode,
  parentPath: string[] = [],
  parentId?: string,
): FlatCategory[] {
  if (!node.category?.categoryId || !node.category?.categoryName) return [];
  const currentPath = [...parentPath, node.category.categoryName];
  const children = node.childCategoryTreeNodes ?? [];
  const current: FlatCategory = {
    categoryId: node.category.categoryId,
    categoryName: node.category.categoryName,
    parentId,
    path: currentPath.join(" > "),
    leaf: children.length === 0,
  };
  const flattenedChildren = children.flatMap((child) =>
    flattenCategoryTree(child, currentPath, node.category?.categoryId),
  );
  return [current, ...flattenedChildren];
}

async function fetchCategoryTreeId(token: string, marketplaceId: string) {
  const url = new URL(
    "https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id",
  );
  url.searchParams.set("marketplace_id", marketplaceId);

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    {
      timeoutMs: 8_000,
      retries: 2,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `eBay taxonomy tree id failed: ${response.status} ${errorBody.slice(0, 120)}`,
    );
  }

  const data = await response.json();
  if (!data.categoryTreeId) {
    throw new Error("eBay taxonomy tree id missing in response");
  }
  return data.categoryTreeId as string;
}

async function fetchCategoryTree(token: string, treeId: string) {
  const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}`;
  const response = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
    {
      timeoutMs: 8_000,
      retries: 2,
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `eBay taxonomy tree failed: ${response.status} ${errorBody.slice(0, 120)}`,
    );
  }

  return response.json();
}

export const clearEbayTaxonomy = internalMutation({
  args: {
    marketplaceId: v.string(),
  },
  handler: async (ctx, args) => {
    while (true) {
      const existing = await ctx.db
        .query("ebayCategories")
        .withIndex("by_marketplace", (q) =>
          q.eq("marketplaceId", args.marketplaceId),
        )
        .take(1000);
      if (existing.length === 0) break;
      for (const entry of existing) {
        await ctx.db.delete(entry._id);
      }
    }
  },
});

export const setEbayTaxonomyMeta = internalMutation({
  args: {
    marketplaceId: v.string(),
    rootCategoryId: v.optional(v.string()),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ebayTaxonomyMeta")
      .withIndex("by_marketplace", (q) =>
        q.eq("marketplaceId", args.marketplaceId),
      )
      .collect();
    for (const entry of existing) {
      await ctx.db.delete(entry._id);
    }

    await ctx.db.insert("ebayTaxonomyMeta", {
      marketplaceId: args.marketplaceId,
      rootCategoryId: args.rootCategoryId,
      fetchedAt: args.fetchedAt,
    });
  },
});

export const insertEbayCategories = internalMutation({
  args: {
    marketplaceId: v.string(),
    fetchedAt: v.number(),
    categories: v.array(
      v.object({
        categoryId: v.string(),
        categoryName: v.string(),
        normalizedName: v.string(),
        parentId: v.optional(v.string()),
        path: v.string(),
        leaf: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.categories) {
      await ctx.db.insert("ebayCategories", {
        marketplaceId: args.marketplaceId,
        fetchedAt: args.fetchedAt,
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        normalizedName: entry.normalizedName,
        parentId: entry.parentId,
        path: entry.path,
        leaf: entry.leaf,
      });
    }
  },
});

export const refreshEbayTaxonomy = internalAction({
  args: {
    marketplaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const marketplaceId = args.marketplaceId ?? "EBAY_US";
    const token = await getApplicationToken(
      "https://api.ebay.com/oauth/api_scope",
    );
    const treeId = await fetchCategoryTreeId(token, marketplaceId);
    const tree = await fetchCategoryTree(token, treeId);
    const rootNode: EbayCategoryNode | undefined = tree.rootCategoryNode;

    if (!rootNode) {
      throw new Error("eBay taxonomy response missing rootCategoryNode");
    }

    const flattened = flattenCategoryTree(rootNode);
    const now = Date.now();
    const rootCategoryId = rootNode.category?.categoryId;

    await ctx.runMutation(internal.ebayTaxonomy.clearEbayTaxonomy, {
      marketplaceId,
    });
    await ctx.runMutation(internal.ebayTaxonomy.setEbayTaxonomyMeta, {
      marketplaceId,
      rootCategoryId,
      fetchedAt: now,
    });

    const chunkSize = 200;
    for (let i = 0; i < flattened.length; i += chunkSize) {
      const chunk = flattened.slice(i, i + chunkSize).map((entry) => ({
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        normalizedName: normalizeCategoryName(entry.categoryName),
        parentId: entry.parentId,
        path: entry.path,
        leaf: entry.leaf,
      }));
      await ctx.runMutation(internal.ebayTaxonomy.insertEbayCategories, {
        marketplaceId,
        fetchedAt: now,
        categories: chunk,
      });
    }

    return { count: flattened.length, marketplaceId };
  },
});

export const findEbayCategoryId = internalQuery({
  args: {
    categoryName: v.string(),
    marketplaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const marketplaceId = args.marketplaceId ?? "EBAY_US";
    const normalizedTarget = normalizeCategoryName(args.categoryName);
    if (!normalizedTarget) return null;

    const all = await ctx.db
      .query("ebayCategories")
      .withIndex("by_marketplace", (q) => q.eq("marketplaceId", marketplaceId))
      .collect();

    if (all.length === 0) return null;

    let best: { score: number; entry: any } | null = null;

    for (const entry of all) {
      const candidate =
        entry.normalizedName ?? normalizeCategoryName(entry.categoryName);
      if (!candidate) continue;

      let score = 0;
      if (candidate === normalizedTarget) score = 100;
      else if (candidate.startsWith(normalizedTarget)) score = 85;
      else if (candidate.includes(normalizedTarget)) score = 70;
      else {
        const targetTokens = normalizedTarget.split(" ");
        const candidateTokens = candidate.split(" ");
        const overlap = targetTokens.filter((t) => candidateTokens.includes(t));
        if (overlap.length > 0) {
          score = Math.round((overlap.length / targetTokens.length) * 60);
        }
      }

      if (entry.leaf) score += 5;

      if (!best || score > best.score) {
        best = { score, entry };
      }
    }

    if (!best || best.score < 60) return null;
    return best.entry.categoryId as string;
  },
});

export const listTopCategories = query({
  args: {
    marketplaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const marketplaceId = resolveMarketplaceId(args.marketplaceId);
    const meta = await ctx.db
      .query("ebayTaxonomyMeta")
      .withIndex("by_marketplace", (q) => q.eq("marketplaceId", marketplaceId))
      .first();
    const rootId = meta?.rootCategoryId;

    if (!rootId) {
      const roots = await ctx.db
        .query("ebayCategories")
        .withIndex("by_marketplace", (q) => q.eq("marketplaceId", marketplaceId))
        .filter((q) => q.eq(q.field("parentId"), undefined))
        .collect();

      if (roots.length === 0) return [];
      const root = roots[0];
      const children = await ctx.db
        .query("ebayCategories")
        .withIndex("by_marketplace_parent", (q) =>
          q.eq("marketplaceId", marketplaceId).eq("parentId", root.categoryId),
        )
        .collect();

      return children
        .map((entry) => ({
          categoryId: entry.categoryId,
          categoryName: entry.categoryName,
          path: entry.path,
        }))
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    }

    const children = await ctx.db
      .query("ebayCategories")
      .withIndex("by_marketplace_parent", (q) =>
        q.eq("marketplaceId", marketplaceId).eq("parentId", rootId),
      )
      .collect();

    return children
      .map((entry) => ({
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        path: entry.path,
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  },
});

export const listChildCategories = query({
  args: {
    categoryId: v.string(),
    marketplaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const marketplaceId = resolveMarketplaceId(args.marketplaceId);
    const children = await ctx.db
      .query("ebayCategories")
      .withIndex("by_marketplace_parent", (q) =>
        q.eq("marketplaceId", marketplaceId).eq("parentId", args.categoryId),
      )
      .collect();

    return children
      .map((entry) => ({
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        path: entry.path,
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  },
});

export const getCategoryById = query({
  args: {
    categoryId: v.string(),
    marketplaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const marketplaceId = resolveMarketplaceId(args.marketplaceId);
    const matches = await ctx.db
      .query("ebayCategories")
      .withIndex("by_category_id", (q) => q.eq("categoryId", args.categoryId))
      .collect();

    if (matches.length === 0) return null;
    const match =
      matches.find((entry) => entry.marketplaceId === marketplaceId) ??
      matches[0];

    return {
      categoryId: match.categoryId,
      categoryName: match.categoryName,
      path: match.path,
      parentId: match.parentId,
      leaf: match.leaf,
    };
  },
});
