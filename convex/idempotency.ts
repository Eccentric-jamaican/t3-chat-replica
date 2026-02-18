import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export const claimKey = internalMutation({
  args: {
    scope: v.string(),
    key: v.string(),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttlMs = Math.max(args.ttlMs ?? DEFAULT_TTL_MS, 60_000);
    const expiresAt = now + ttlMs;

    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        hitCount: existing.hitCount + 1,
        expiresAt: Math.max(existing.expiresAt, expiresAt),
      });
      return {
        duplicate: true,
        keyId: existing._id,
        firstSeenAt: existing.firstSeenAt,
        hitCount: existing.hitCount + 1,
      };
    }

    const keyId = await ctx.db.insert("idempotencyKeys", {
      scope: args.scope,
      key: args.key,
      firstSeenAt: now,
      lastSeenAt: now,
      hitCount: 1,
      expiresAt,
    });

    return {
      duplicate: false,
      keyId,
      firstSeenAt: now,
      hitCount: 1,
    };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;

    while (true) {
      const batch = await ctx.db
        .query("idempotencyKeys")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(100);
      if (batch.length === 0) break;

      for (const row of batch) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    return { deleted };
  },
});

export const listRecentByScope = internalQuery({
  args: {
    scope: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 200);
    return await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_scope_first_seen", (q) => q.eq("scope", args.scope))
      .order("desc")
      .take(limit);
  },
});
