import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const checkGate = internalMutation({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("outboundCircuitBreakers")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .first();

    if (!existing) {
      await ctx.db.insert("outboundCircuitBreakers", {
        provider: args.provider,
        state: "closed",
        failureCount: 0,
        successCount: 0,
        updatedAt: now,
      });
      return { allowed: true, state: "closed", retryAfterMs: 0 };
    }

    if (
      existing.state === "open" &&
      typeof existing.cooldownUntil === "number" &&
      existing.cooldownUntil > now
    ) {
      return {
        allowed: false,
        state: "open",
        retryAfterMs: existing.cooldownUntil - now,
      };
    }

    if (
      existing.state === "open" &&
      (typeof existing.cooldownUntil !== "number" || existing.cooldownUntil <= now)
    ) {
      await ctx.db.patch(existing._id, {
        state: "half_open",
        cooldownUntil: undefined,
        updatedAt: now,
      });
      return { allowed: true, state: "half_open", retryAfterMs: 0 };
    }

    return { allowed: true, state: existing.state, retryAfterMs: 0 };
  },
});

export const recordSuccess = internalMutation({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("outboundCircuitBreakers")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .first();

    if (!existing) {
      await ctx.db.insert("outboundCircuitBreakers", {
        provider: args.provider,
        state: "closed",
        failureCount: 0,
        successCount: 1,
        lastSuccessAt: now,
        updatedAt: now,
      });
      return { state: "closed", successCount: 1, failureCount: 0 };
    }

    const nextSuccess = existing.successCount + 1;
    await ctx.db.patch(existing._id, {
      state: "closed",
      failureCount: 0,
      successCount: nextSuccess,
      lastSuccessAt: now,
      cooldownUntil: undefined,
      lastError: undefined,
      updatedAt: now,
    });

    return { state: "closed", successCount: nextSuccess, failureCount: 0 };
  },
});

export const recordFailure = internalMutation({
  args: {
    provider: v.string(),
    threshold: v.number(),
    cooldownMs: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const threshold = Math.max(Math.floor(args.threshold), 1);
    const cooldownMs = Math.max(Math.floor(args.cooldownMs), 1_000);
    const sanitizedError = args.error?.slice(0, 500);

    const existing = await ctx.db
      .query("outboundCircuitBreakers")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider))
      .first();

    const previousState = existing?.state ?? "closed";
    const previousFailureCount = existing?.failureCount ?? 0;

    const nextFailureCount =
      previousState === "half_open" ? threshold : previousFailureCount + 1;
    const shouldOpen = nextFailureCount >= threshold;
    const nextState = shouldOpen ? "open" : "closed";
    const cooldownUntil = shouldOpen ? now + cooldownMs : undefined;

    if (!existing) {
      await ctx.db.insert("outboundCircuitBreakers", {
        provider: args.provider,
        state: nextState,
        failureCount: nextFailureCount,
        successCount: 0,
        lastFailureAt: now,
        cooldownUntil,
        lastError: sanitizedError,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        state: nextState,
        failureCount: nextFailureCount,
        lastFailureAt: now,
        cooldownUntil,
        lastError: sanitizedError,
        updatedAt: now,
      });
    }

    return {
      opened: shouldOpen && previousState !== "open",
      state: nextState,
      failureCount: nextFailureCount,
      cooldownUntil,
    };
  },
});

export const listStatuses = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    return await ctx.db
      .query("outboundCircuitBreakers")
      .withIndex("by_updated_at")
      .order("desc")
      .take(limit);
  },
});
