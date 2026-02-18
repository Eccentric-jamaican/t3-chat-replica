import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const RATE_LIMIT_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_DEDUPE_WINDOW_MS = 5_000;
const RATE_LIMIT_ALERT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const MONITOR_WINDOW_MINUTES = 5;

const ALERT_RULES = [
  { bucket: "whatsapp_webhook", outcome: "blocked", threshold: 40 },
  { bucket: "whatsapp_webhook", outcome: "contention_fallback", threshold: 5 },
  { bucket: "gmail_push", outcome: "blocked", threshold: 40 },
  { bucket: "gmail_push", outcome: "contention_fallback", threshold: 5 },
  { bucket: "chat_stream", outcome: "blocked", threshold: 25 },
  { bucket: "chat_stream", outcome: "contention_fallback", threshold: 3 },
] as const;

function parseSentryDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!publicKey || !projectId) return null;
    return {
      dsn,
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

function randomHex(len: number) {
  const chars = "abcdef0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function sendSentryRateLimitAlert(input: {
  dsn: string;
  bucket: string;
  outcome: string;
  observed: number;
  threshold: number;
  windowMinutes: number;
}) {
  const parsed = parseSentryDsn(input.dsn);
  if (!parsed) return false;

  const eventId = randomHex(32);
  const timestamp = new Date().toISOString();
  const message = `Rate limit alert: ${input.bucket} ${input.outcome}`;
  const payload = {
    event_id: eventId,
    message,
    level: "warning",
    platform: "javascript",
    timestamp,
    logger: "convex.rateLimit.monitor",
    tags: {
      feature: "rate_limit_monitor",
      bucket: input.bucket,
      outcome: input.outcome,
    },
    extra: {
      observed: input.observed,
      threshold: input.threshold,
      windowMinutes: input.windowMinutes,
    },
  };

  const envelope =
    `${JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn: parsed.dsn })}\n` +
    `${JSON.stringify({ type: "event" })}\n` +
    `${JSON.stringify(payload)}`;

  const response = await fetch(parsed.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
    },
    body: envelope,
  });

  return response.ok;
}

export const checkAndIncrement = internalMutation({
  args: {
    key: v.string(),
    max: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowStart = now - (now % args.windowMs);
    const expiresAt = windowStart + args.windowMs * 2;

    const existing = await ctx.db
      .query("rateLimitWindows")
      .withIndex("by_key_window", (q) =>
        q.eq("key", args.key).eq("windowStart", windowStart),
      )
      .first();

    if (!existing) {
      await ctx.db.insert("rateLimitWindows", {
        key: args.key,
        windowStart,
        count: 1,
        expiresAt,
        updatedAt: now,
      });
      return {
        allowed: true,
        remaining: Math.max(args.max - 1, 0),
        retryAfterMs: 0,
      };
    }

    // Hot-path optimization: once the limit is hit for this window, skip writes.
    // This avoids write contention storms during abuse bursts.
    if (existing.count >= args.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(windowStart + args.windowMs - now, 0),
      };
    }

    const nextCount = existing.count + 1;
    await ctx.db.patch(existing._id, {
      count: nextCount,
      updatedAt: now,
      expiresAt,
    });

    return {
      allowed: true,
      remaining: Math.max(args.max - nextCount, 0),
      retryAfterMs: 0,
    };
  },
});

export const recordEvent = internalMutation({
  args: {
    source: v.union(
      v.literal("chat_action"),
      v.literal("chat_http"),
      v.literal("http"),
    ),
    bucket: v.string(),
    key: v.string(),
    outcome: v.union(
      v.literal("blocked"),
      v.literal("contention_fallback"),
    ),
    retryAfterMs: v.optional(v.number()),
    path: v.optional(v.string()),
    method: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const dedupeWindowStart = now - (now % EVENT_DEDUPE_WINDOW_MS);
    const dedupeKey = `${args.source}|${args.bucket}|${args.key}|${args.outcome}|${dedupeWindowStart}`;

    const existing = await ctx.db
      .query("rateLimitEvents")
      .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (existing) return;

    await ctx.db.insert("rateLimitEvents", {
      ...args,
      dedupeKey,
      createdAt: now,
      expiresAt: now + RATE_LIMIT_EVENT_RETENTION_MS,
    });
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deletedWindows = 0;
    let deletedEvents = 0;
    let deletedAlerts = 0;

    while (true) {
      const batch = await ctx.db
        .query("rateLimitWindows")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(100);

      if (batch.length === 0) break;

      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedWindows += 1;
      }
    }

    while (true) {
      const batch = await ctx.db
        .query("rateLimitEvents")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(100);

      if (batch.length === 0) break;

      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedEvents += 1;
      }
    }

    while (true) {
      const batch = await ctx.db
        .query("rateLimitAlerts")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(100);

      if (batch.length === 0) break;

      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedAlerts += 1;
      }
    }

    return {
      deleted: deletedWindows + deletedEvents + deletedAlerts,
      deletedWindows,
      deletedEvents,
      deletedAlerts,
    };
  },
});

export const listRecentEvents = internalQuery({
  args: {
    limit: v.optional(v.number()),
    bucket: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const rows = await ctx.db
      .query("rateLimitEvents")
      .order("desc")
      .take(limit * 2);

    const filtered = args.bucket
      ? rows.filter((row) => row.bucket === args.bucket)
      : rows;

    return filtered.slice(0, limit);
  },
});

export const getEventSummary = internalQuery({
  args: {
    minutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const windowMinutes = Math.min(Math.max(args.minutes ?? 15, 1), 24 * 60);
    const cutoff = Date.now() - windowMinutes * 60_000;

    const rows = await ctx.db
      .query("rateLimitEvents")
      .order("desc")
      .take(2000);

    const summary: Record<string, number> = {};
    const bucketOutcomeSummary: Record<string, number> = {};
    let total = 0;

    for (const row of rows) {
      if (row.createdAt < cutoff) continue;
      total += 1;
      const sourceKey = `${row.source}:${row.bucket}:${row.outcome}`;
      summary[sourceKey] = (summary[sourceKey] ?? 0) + 1;
      const bucketKey = `${row.bucket}:${row.outcome}`;
      bucketOutcomeSummary[bucketKey] = (bucketOutcomeSummary[bucketKey] ?? 0) + 1;
    }

    return {
      total,
      windowMinutes,
      bySourceBucketOutcome: summary,
      byBucketOutcome: bucketOutcomeSummary,
    };
  },
});

export const raiseAlertIfNeeded = internalMutation({
  args: {
    bucket: v.string(),
    outcome: v.union(
      v.literal("blocked"),
      v.literal("contention_fallback"),
    ),
    threshold: v.number(),
    observed: v.number(),
    windowMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const slot = now - (now % ALERT_COOLDOWN_MS);
    const alertKey = `${args.bucket}|${args.outcome}|${slot}`;

    const existing = await ctx.db
      .query("rateLimitAlerts")
      .withIndex("by_alert_key", (q) => q.eq("alertKey", alertKey))
      .first();
    if (existing) {
      return { created: false };
    }

    const id = await ctx.db.insert("rateLimitAlerts", {
      alertKey,
      bucket: args.bucket,
      outcome: args.outcome,
      threshold: args.threshold,
      observed: args.observed,
      windowMinutes: args.windowMinutes,
      createdAt: now,
      expiresAt: now + RATE_LIMIT_ALERT_RETENTION_MS,
    });

    return { created: true, alertId: id };
  },
});

export const listRecentAlerts = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    return await ctx.db
      .query("rateLimitAlerts")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);
  },
});

export const monitorAndAlert = internalAction({
  args: {},
  handler: async (ctx) => {
    const summary = await ctx.runQuery(internal.rateLimit.getEventSummary, {
      minutes: MONITOR_WINDOW_MINUTES,
    });

    const sentryDsn =
      process.env.RATE_LIMIT_SENTRY_DSN || process.env.SENTRY_DSN || "";
    let created = 0;
    let sentryNotified = 0;

    for (const rule of ALERT_RULES) {
      const summaryKey = `${rule.bucket}:${rule.outcome}`;
      const observed = summary.byBucketOutcome[summaryKey] ?? 0;
      if (observed < rule.threshold) continue;

      const raised = await ctx.runMutation(internal.rateLimit.raiseAlertIfNeeded, {
        bucket: rule.bucket,
        outcome: rule.outcome,
        threshold: rule.threshold,
        observed,
        windowMinutes: MONITOR_WINDOW_MINUTES,
      });
      if (!raised.created) continue;

      created += 1;
      console.warn("[RateLimit Alert]", {
        bucket: rule.bucket,
        outcome: rule.outcome,
        observed,
        threshold: rule.threshold,
        windowMinutes: MONITOR_WINDOW_MINUTES,
      });

      if (!raised.alertId) continue;
      if (sentryDsn) {
        try {
          const sent = await sendSentryRateLimitAlert({
            dsn: sentryDsn,
            bucket: rule.bucket,
            outcome: rule.outcome,
            observed,
            threshold: rule.threshold,
            windowMinutes: MONITOR_WINDOW_MINUTES,
          });
          if (sent) {
            sentryNotified += 1;
          }
        } catch (error) {
          console.error("[RateLimit Alert] Failed to send Sentry alert", error);
        }
      }
    }

    return {
      createdAlerts: created,
      sentryAlerts: sentryNotified,
      windowMinutes: MONITOR_WINDOW_MINUTES,
    };
  },
});
