import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getBulkheadConfig,
  getCircuitConfig,
  getOpsSnapshotConfig,
  getRateLimitConfig,
  getToolCacheConfig,
  getToolCacheNamespaces,
  getToolJobConfig,
} from "./lib/reliabilityConfig";

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const getReliabilitySnapshot = internalQuery({
  args: {
    minutes: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const opsDefaults = getOpsSnapshotConfig();
    const windowMinutes = clampInt(
      args.minutes ?? opsDefaults.defaultWindowMinutes,
      1,
      24 * 60,
    );
    const sectionLimit = clampInt(
      args.limit ?? opsDefaults.maxRowsPerSection,
      5,
      opsDefaults.maxRowsPerSection,
    );
    const now = Date.now();
    const cutoff = now - windowMinutes * 60_000;

    const rateLimitEvents = await ctx.db
      .query("rateLimitEvents")
      .order("desc")
      .take(sectionLimit * 40);
    const inWindowEvents = rateLimitEvents.filter((row) => row.createdAt >= cutoff);
    const eventsByBucketOutcome: Record<string, number> = {};
    for (const row of inWindowEvents) {
      const key = `${row.bucket}:${row.outcome}`;
      eventsByBucketOutcome[key] = (eventsByBucketOutcome[key] ?? 0) + 1;
    }

    const rateLimitAlerts = await ctx.db
      .query("rateLimitAlerts")
      .withIndex("by_created_at")
      .order("desc")
      .take(sectionLimit * 10);
    const alertsInWindow = rateLimitAlerts.filter((row) => row.createdAt >= cutoff);

    const circuits = await ctx.db
      .query("outboundCircuitBreakers")
      .withIndex("by_updated_at")
      .order("desc")
      .take(sectionLimit);

    const activeBulkheadLeases = await ctx.db
      .query("outboundBulkheadLeases")
      .withIndex("by_expires_at", (q) => q.gt("expiresAt", now))
      .take(1000);
    const bulkheadInFlightByProvider: Record<string, number> = {};
    for (const lease of activeBulkheadLeases) {
      bulkheadInFlightByProvider[lease.provider] =
        (bulkheadInFlightByProvider[lease.provider] ?? 0) + 1;
    }

    const recentIdempotencyKeys = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_first_seen", (q) => q.gt("firstSeenAt", cutoff))
      .take(1000);
    const replayByScope: Record<
      string,
      { totalKeys: number; duplicateKeys: number; duplicateHits: number }
    > = {};
    let duplicateHitsTotal = 0;
    for (const row of recentIdempotencyKeys) {
      const current = replayByScope[row.scope] ?? {
        totalKeys: 0,
        duplicateKeys: 0,
        duplicateHits: 0,
      };
      current.totalKeys += 1;
      if (row.hitCount > 1) {
        const duplicateHits = row.hitCount - 1;
        current.duplicateKeys += 1;
        current.duplicateHits += duplicateHits;
        duplicateHitsTotal += duplicateHits;
      }
      replayByScope[row.scope] = current;
    }

    const toolCacheEntries = await ctx.db
      .query("toolResultCache")
      .withIndex("by_expires_at", (q) => q.gt("expiresAt", now))
      .take(5000);
    const toolCacheByNamespace: Record<string, number> = {};
    for (const row of toolCacheEntries) {
      toolCacheByNamespace[row.namespace] =
        (toolCacheByNamespace[row.namespace] ?? 0) + 1;
    }

    const toolJobStats = await ctx.runQuery(internal.toolJobs.getQueueStats, {
      limit: 5000,
    });

    return {
      generatedAt: now,
      windowMinutes,
      config: {
        rateLimits: getRateLimitConfig(),
        circuits: getCircuitConfig(),
        bulkheads: getBulkheadConfig(),
        toolCache: getToolCacheConfig(),
        toolCacheNamespaces: getToolCacheNamespaces(),
        toolJobs: getToolJobConfig(),
      },
      rateLimitPressure: {
        sampledEvents: inWindowEvents.length,
        byBucketOutcome: eventsByBucketOutcome,
        recentAlerts: alertsInWindow.slice(0, sectionLimit),
        alertsInWindow: alertsInWindow.length,
      },
      circuitBreakers: {
        recent: circuits,
        openCount: circuits.filter((c) => c.state === "open").length,
      },
      bulkheads: {
        activeLeaseCount: activeBulkheadLeases.length,
        inFlightByProvider: bulkheadInFlightByProvider,
      },
      replayProtection: {
        keysInWindow: recentIdempotencyKeys.length,
        duplicateHitsInWindow: duplicateHitsTotal,
        byScope: replayByScope,
      },
      toolCache: {
        sampledActiveEntries: toolCacheEntries.length,
        byNamespace: toolCacheByNamespace,
      },
      toolJobs: {
        sampled: toolJobStats.sampled,
        byStatus: toolJobStats.byStatus,
        byTool: toolJobStats.byTool,
        pressureByTool: toolJobStats.pressureByTool,
        oldestQueuedAgeMs: toolJobStats.oldestQueuedAgeMs,
        oldestRunningAgeMs: toolJobStats.oldestRunningAgeMs,
      },
    };
  },
});
