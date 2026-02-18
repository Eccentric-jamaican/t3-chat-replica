import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const MIN_LEASE_TTL_MS = 15_000;

export const acquireSlot = internalMutation({
  args: {
    provider: v.string(),
    leaseId: v.string(),
    maxConcurrent: v.number(),
    leaseTtlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const maxConcurrent = Math.max(Math.floor(args.maxConcurrent), 1);
    const leaseTtlMs = Math.max(Math.floor(args.leaseTtlMs), MIN_LEASE_TTL_MS);

    // Opportunistic cleanup of expired leases for this provider.
    while (true) {
      const expired = await ctx.db
        .query("outboundBulkheadLeases")
        .withIndex("by_provider_expires", (q) =>
          q.eq("provider", args.provider).lt("expiresAt", now),
        )
        .take(100);
      if (expired.length === 0) break;
      for (const row of expired) {
        await ctx.db.delete(row._id);
      }
    }

    const existingLease = await ctx.db
      .query("outboundBulkheadLeases")
      .withIndex("by_provider_lease", (q) =>
        q.eq("provider", args.provider).eq("leaseId", args.leaseId),
      )
      .first();
    if (existingLease) {
      return {
        acquired: true,
        inFlight: 1,
        retryAfterMs: 0,
      };
    }

    const active = await ctx.db
      .query("outboundBulkheadLeases")
      .withIndex("by_provider_expires", (q) =>
        q.eq("provider", args.provider).gt("expiresAt", now),
      )
      .take(maxConcurrent + 1);

    if (active.length >= maxConcurrent) {
      const nextAvailable = active[0]?.expiresAt ?? now + 1_000;
      return {
        acquired: false,
        inFlight: active.length,
        retryAfterMs: Math.max(nextAvailable - now, 1_000),
      };
    }

    await ctx.db.insert("outboundBulkheadLeases", {
      provider: args.provider,
      leaseId: args.leaseId,
      acquiredAt: now,
      expiresAt: now + leaseTtlMs,
    });

    return {
      acquired: true,
      inFlight: active.length + 1,
      retryAfterMs: 0,
    };
  },
});

export const releaseSlot = internalMutation({
  args: {
    provider: v.string(),
    leaseId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("outboundBulkheadLeases")
      .withIndex("by_provider_lease", (q) =>
        q.eq("provider", args.provider).eq("leaseId", args.leaseId),
      )
      .first();

    if (!existing) {
      return { released: false };
    }

    await ctx.db.delete(existing._id);
    return { released: true };
  },
});

export const cleanupExpiredLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;

    while (true) {
      const batch = await ctx.db
        .query("outboundBulkheadLeases")
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

export const listInFlightByProvider = internalQuery({
  args: {
    provider: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(args.limit ?? 100, 500);
    return await ctx.db
      .query("outboundBulkheadLeases")
      .withIndex("by_provider_expires", (q) =>
        q.eq("provider", args.provider).gt("expiresAt", now),
      )
      .take(limit);
  },
});
