import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 64 * 1024;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeCacheKey(key: string) {
  return key.trim().toLowerCase().slice(0, MAX_KEY_LENGTH);
}

function clampTtlMs(ttlMs: number) {
  if (!Number.isFinite(ttlMs)) return MIN_TTL_MS;
  const rounded = Math.floor(ttlMs);
  if (rounded < MIN_TTL_MS) return MIN_TTL_MS;
  if (rounded > MAX_TTL_MS) return MAX_TTL_MS;
  return rounded;
}

export const get = internalQuery({
  args: {
    namespace: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const key = normalizeCacheKey(args.key);
    if (!key) return null;

    const entry = await ctx.db
      .query("toolResultCache")
      .withIndex("by_namespace_key", (q) =>
        q.eq("namespace", args.namespace).eq("key", key),
      )
      .first();

    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  },
});

export const set = internalMutation({
  args: {
    namespace: v.string(),
    key: v.string(),
    value: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const key = normalizeCacheKey(args.key);
    if (!key) return null;

    const now = Date.now();
    const expiresAt = now + clampTtlMs(args.ttlMs);
    const value = args.value.slice(0, MAX_VALUE_LENGTH);

    const existing = await ctx.db
      .query("toolResultCache")
      .withIndex("by_namespace_key", (q) =>
        q.eq("namespace", args.namespace).eq("key", key),
      )
      .collect();

    if (existing.length === 0) {
      await ctx.db.insert("toolResultCache", {
        namespace: args.namespace,
        key,
        value,
        createdAt: now,
        expiresAt,
      });
      return { key, expiresAt };
    }

    await ctx.db.patch(existing[0]._id, {
      value,
      expiresAt,
    });
    for (let i = 1; i < existing.length; i++) {
      await ctx.db.delete(existing[i]._id);
    }
    return { key, expiresAt };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;

    while (true) {
      const expired = await ctx.db
        .query("toolResultCache")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(200);
      if (expired.length === 0) break;
      for (const row of expired) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    return { deleted };
  },
});

export const clearNamespace = internalMutation({
  args: {
    namespace: v.string(),
    maxDeletes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDeletes =
      typeof args.maxDeletes === "number" && Number.isFinite(args.maxDeletes)
        ? Math.max(1, Math.floor(args.maxDeletes))
        : 10_000;

    let deleted = 0;
    while (deleted < maxDeletes) {
      const batch = await ctx.db
        .query("toolResultCache")
        .withIndex("by_namespace_key", (q) => q.eq("namespace", args.namespace))
        .take(Math.min(200, maxDeletes - deleted));
      if (batch.length === 0) break;
      for (const row of batch) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
      if (batch.length < 200) break;
    }

    const remaining = await ctx.db
      .query("toolResultCache")
      .withIndex("by_namespace_key", (q) => q.eq("namespace", args.namespace))
      .first();

    return {
      deleted,
      hasMore: !!remaining,
    };
  },
});

export const listNamespaceStats = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? Math.max(100, Math.min(Math.floor(args.limit), 20_000))
        : 5_000;
    const active = await ctx.db
      .query("toolResultCache")
      .withIndex("by_expires_at", (q) => q.gt("expiresAt", now))
      .take(limit);

    const counts: Record<string, number> = {};
    for (const row of active) {
      counts[row.namespace] = (counts[row.namespace] ?? 0) + 1;
    }

    return {
      sampledActiveEntries: active.length,
      byNamespace: counts,
    };
  },
});
