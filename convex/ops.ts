import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getAdmissionControlConfig,
  getBulkheadConfig,
  getChatProviderRouteConfig,
  getChatGatewayFlags,
  getCircuitConfig,
  getOpsSnapshotConfig,
  getRateLimitConfig,
  getRegionTopologyConfig,
  getToolCacheConfig,
  getToolCacheNamespaces,
  getToolJobConfig,
  getToolQueueAlertConfig,
} from "./lib/reliabilityConfig";

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export const getReliabilitySnapshot = internalQuery({
  args: {
    minutes: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
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
    const admissionConfig = getAdmissionControlConfig();
    const safeAdmissionConfig = {
      ...admissionConfig,
      redisToken: admissionConfig.redisToken ? "***redacted***" : "",
    };

    const rateLimitEvents = await ctx.db
      .query("rateLimitEvents")
      .order("desc")
      .take(sectionLimit * 40);
    const inWindowEvents = rateLimitEvents.filter((row) => row.createdAt >= cutoff);
    const eventsByBucketOutcome: Record<string, number> = {};
    const eventsByBucketOutcomeReason: Record<string, number> = {};
    for (const row of inWindowEvents) {
      const key = `${row.bucket}:${row.outcome}`;
      eventsByBucketOutcome[key] = (eventsByBucketOutcome[key] ?? 0) + 1;
      const reasonKey = `${row.bucket}:${row.outcome}:${row.reason ?? "none"}`;
      eventsByBucketOutcomeReason[reasonKey] =
        (eventsByBucketOutcomeReason[reasonKey] ?? 0) + 1;
    }

    const chatAdmissionRows = inWindowEvents.filter(
      (row) =>
        row.bucket === "chat_admission" || row.bucket === "chat_admission_shadow",
    );
    const chatAdmission = {
      enforce: { allowed: 0, blocked: 0, contentionFallback: 0 },
      shadow: { allowed: 0, blocked: 0, contentionFallback: 0 },
      reasonDistribution: {} as Record<string, number>,
      sampledAllowedEventPct: admissionConfig.allowedEventSamplePct,
    };
    for (const row of chatAdmissionRows) {
      const target =
        row.bucket === "chat_admission_shadow"
          ? chatAdmission.shadow
          : chatAdmission.enforce;
      if (row.outcome === "allowed") {
        target.allowed += 1;
      } else if (row.outcome === "blocked") {
        target.blocked += 1;
      } else if (row.outcome === "contention_fallback") {
        target.contentionFallback += 1;
      }
      const reasonKey = row.reason ?? "none";
      chatAdmission.reasonDistribution[reasonKey] =
        (chatAdmission.reasonDistribution[reasonKey] ?? 0) + 1;
    }
    const shadowTotal =
      chatAdmission.shadow.allowed +
      chatAdmission.shadow.blocked +
      chatAdmission.shadow.contentionFallback;
    const enforceTotal =
      chatAdmission.enforce.allowed +
      chatAdmission.enforce.blocked +
      chatAdmission.enforce.contentionFallback;
    const shadowRejects =
      chatAdmission.shadow.blocked + chatAdmission.shadow.contentionFallback;
    const enforceRejects =
      chatAdmission.enforce.blocked + chatAdmission.enforce.contentionFallback;
    const redisUnavailableCount =
      chatAdmission.reasonDistribution.redis_unavailable ?? 0;
    const topAdmissionReasons = Object.entries(chatAdmission.reasonDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

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

    const toolJobStats: any = await ctx.runQuery(internal.toolJobs.getQueueStats, {
      limit: 5000,
    });
    const recentDeadLetters = await ctx.db
      .query("toolJobs")
      .withIndex("by_status_updated", (q) => q.eq("status", "dead_letter"))
      .order("desc")
      .take(sectionLimit);
    const recentToolQueueAlerts = await ctx.db
      .query("toolQueueAlerts")
      .withIndex("by_created_at")
      .order("desc")
      .take(sectionLimit * 5);
    const toolQueueAlertsInWindow = recentToolQueueAlerts.filter(
      (row) => row.createdAt >= cutoff,
    );

    return {
      generatedAt: now,
      windowMinutes,
      config: {
        rateLimits: getRateLimitConfig(),
        circuits: getCircuitConfig(),
        bulkheads: getBulkheadConfig(),
        admission: safeAdmissionConfig,
        chatGateway: getChatGatewayFlags(),
        chatProviderRoutes: getChatProviderRouteConfig(),
        regionTopology: getRegionTopologyConfig(),
        toolCache: getToolCacheConfig(),
        toolCacheNamespaces: getToolCacheNamespaces(),
        toolJobs: getToolJobConfig(),
        toolQueueAlerts: getToolQueueAlertConfig(),
      },
      rateLimitPressure: {
        sampledEvents: inWindowEvents.length,
        byBucketOutcome: eventsByBucketOutcome,
        byBucketOutcomeReason: eventsByBucketOutcomeReason,
        recentAlerts: alertsInWindow.slice(0, sectionLimit),
        alertsInWindow: alertsInWindow.length,
      },
      chatAdmission: {
        enforce: chatAdmission.enforce,
        shadow: chatAdmission.shadow,
        topReasons: topAdmissionReasons,
        falsePositivePressure: {
          shadowWouldBlockRate:
            shadowTotal > 0 ? shadowRejects / shadowTotal : 0,
          enforceRejectRate:
            enforceTotal > 0 ? enforceRejects / enforceTotal : 0,
          redisUnavailableShare:
            shadowRejects + enforceRejects > 0
              ? redisUnavailableCount / (shadowRejects + enforceRejects)
              : 0,
        },
        sampledAllowedEventPct: chatAdmission.sampledAllowedEventPct,
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
        recentDeadLetters,
      },
      toolQueueAlerts: {
        alertsInWindow: toolQueueAlertsInWindow.length,
        recent: toolQueueAlertsInWindow.slice(0, sectionLimit),
      },
    };
  },
});
