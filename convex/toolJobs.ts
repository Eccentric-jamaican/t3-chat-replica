import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { fetchWithRetry } from "./lib/network";
import { normalizeEbaySearchArgs } from "./lib/ebaySearch";
import { dedupeProducts } from "./lib/toolHelpers";
import {
  createToolJobCounts,
  createToolJobQosCounts,
  isToolJobName,
  pickClaimableToolJob,
  TOOL_JOB_QOS_BY_NAME,
  TOOL_JOB_NAMES,
  ToolJobName,
} from "./lib/toolJobQueue";
import { searchEbayItems } from "./ebay";
import { searchGlobalItems } from "./global";
import {
  acquireBulkheadSlot,
  isBulkheadSaturatedError,
  releaseBulkheadSlot,
} from "./lib/bulkhead";
import {
  assertCircuitClosed,
  recordCircuitError,
  recordCircuitResponse,
} from "./lib/circuitBreaker";
import {
  getToolJobConfig,
  getToolQueueAlertConfig,
} from "./lib/reliabilityConfig";

type ToolJobResult =
  | {
      kind: "search_web";
      textResult: string;
      jsonResult: string;
      searchResults: Array<{ title: string; link: string; snippet?: string }>;
    }
  | {
      kind: "search_products";
      summary: string;
      products: any[];
    }
  | {
      kind: "search_global";
      summary: string;
      products: any[];
    };

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function buildSearchWebTextResult(
  query: string,
  items: Array<{ title: string; link: string; snippet?: string }>,
) {
  const lines =
    items
      .map((item, i) => `${i + 1}. ${item.title} - ${item.link}`)
      .join("\n") || "No results found";
  return `Search results for "${query}":\n\n${lines}`;
}

function buildProductSummary(products: Array<{ source?: string }>) {
  const ebayCount = products.filter((item) => item.source === "ebay").length;
  const globalCount = products.filter(
    (item) => item.source === "global",
  ).length;
  const parts: string[] = [];
  if (ebayCount > 0) parts.push(`${ebayCount} eBay items`);
  if (globalCount > 0) parts.push(`${globalCount} global items`);
  if (parts.length === 0) parts.push("no items");
  return `Found ${parts.join(" and ")}. They have been displayed to the user.`;
}

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

async function sendSentryToolQueueAlert(input: {
  dsn: string;
  kind: string;
  observed: number;
  threshold: number;
  windowMinutes: number;
}) {
  const parsed = parseSentryDsn(input.dsn);
  if (!parsed) return false;

  const eventId = randomHex(32);
  const timestamp = new Date().toISOString();
  const message = `Tool queue alert: ${input.kind}`;
  const payload = {
    event_id: eventId,
    message,
    level: "warning",
    platform: "javascript",
    timestamp,
    logger: "convex.toolJobs.monitor",
    tags: {
      feature: "tool_queue_monitor",
      kind: input.kind,
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

  const response = await fetchWithRetry(
    parsed.endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
      body: envelope,
    },
    {
      timeoutMs: 1500,
      retries: 0,
      retryOnNetworkError: false,
    },
  );

  return response.ok;
}

async function searchEbayItemsProtected(
  ctx: any,
  query: string,
  options: Parameters<typeof searchEbayItems>[1],
) {
  const lease = await acquireBulkheadSlot(ctx, "ebay_search");
  try {
    await assertCircuitClosed(ctx, "ebay_search");
    const items = await searchEbayItems(query, options);
    await recordCircuitResponse(ctx, "ebay_search", 200);
    return items;
  } catch (error) {
    await recordCircuitError(ctx, "ebay_search", error);
    throw error;
  } finally {
    await releaseBulkheadSlot(ctx, "ebay_search", lease);
  }
}

async function searchGlobalItemsProtected(
  ctx: any,
  query: string,
  options: Parameters<typeof searchGlobalItems>[1],
) {
  const lease = await acquireBulkheadSlot(ctx, "global_search");
  try {
    await assertCircuitClosed(ctx, "global_search");
    const items = await searchGlobalItems(query, options);
    await recordCircuitResponse(ctx, "global_search", 200);
    return items;
  } catch (error) {
    await recordCircuitError(ctx, "global_search", error);
    throw error;
  } finally {
    await releaseBulkheadSlot(ctx, "global_search", lease);
  }
}

async function executeSearchWebJob(
  ctx: any,
  input: any,
): Promise<ToolJobResult> {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query) {
    throw new Error("Missing search query");
  }

  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    throw new Error("SERPER_API_KEY not configured");
  }

  const serperLease = await acquireBulkheadSlot(ctx, "serper_search");
  try {
    await assertCircuitClosed(ctx, "serper_search");
    const response = await fetchWithRetry(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: {
          "X-API-KEY": serperKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 5 }),
      },
      {
        timeoutMs: 7000,
        retries: 2,
      },
    );
    await recordCircuitResponse(ctx, "serper_search", response.status);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Serper API error: ${response.status} ${body.slice(0, 120)}`,
      );
    }
    const data = await response.json();
    const searchResults = Array.isArray(data?.organic)
      ? data.organic.slice(0, 5).map((item: any) => ({
          title: item?.title ?? "Untitled",
          link: item?.link ?? "",
          snippet: item?.snippet ?? undefined,
        }))
      : [];

    return {
      kind: "search_web",
      textResult: buildSearchWebTextResult(query, searchResults),
      jsonResult: JSON.stringify(searchResults),
      searchResults,
    };
  } catch (error) {
    await recordCircuitError(ctx, "serper_search", error);
    throw error;
  } finally {
    await releaseBulkheadSlot(ctx, "serper_search", serperLease);
  }
}

async function executeProductSearchJob(
  ctx: any,
  input: any,
): Promise<ToolJobResult> {
  const normalized = normalizeEbaySearchArgs(input ?? {});
  if (!normalized.query) {
    throw new Error("Missing product search query");
  }

  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  let categoryId = normalized.categoryId;
  if (!categoryId && normalized.categoryName) {
    const resolvedCategoryId = await ctx.runQuery(
      internal.ebayTaxonomy.findEbayCategoryId,
      {
        categoryName: normalized.categoryName,
        marketplaceId,
      },
    );
    if (typeof resolvedCategoryId === "string") {
      categoryId = resolvedCategoryId;
    }
  }

  const includeGlobal = input?.includeGlobal !== false;
  const requestedGlobalLimit =
    typeof input?.globalLimit === "number"
      ? input.globalLimit
      : normalized.limit;
  const globalLimit = Math.min(12, requestedGlobalLimit ?? 12);
  const [ebayResult, globalResult] = await Promise.allSettled([
    searchEbayItemsProtected(ctx, normalized.query, {
      limit: normalized.limit,
      categoryId,
      minPrice: normalized.minPrice,
      maxPrice: normalized.maxPrice,
      condition: normalized.condition,
      shipping: normalized.shipping,
      minSellerRating: normalized.sellerRating,
      location: normalized.location,
      marketplaceId,
    }),
    includeGlobal
      ? searchGlobalItemsProtected(ctx, normalized.query, {
          limit: globalLimit,
          location: normalized.location,
        })
      : Promise.resolve([]),
  ]);

  const ebayItems = ebayResult.status === "fulfilled" ? ebayResult.value : [];
  const globalItems =
    globalResult.status === "fulfilled" ? globalResult.value : [];
  const combined = dedupeProducts([...ebayItems, ...globalItems]);

  return {
    kind: "search_products",
    summary: buildProductSummary(combined),
    products: combined,
  };
}

async function executeGlobalSearchJob(
  ctx: any,
  input: any,
): Promise<ToolJobResult> {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query) {
    throw new Error("Missing global search query");
  }
  const limit = typeof input?.limit === "number" ? input.limit : 12;
  const location =
    typeof input?.location === "string" ? input.location : undefined;
  const products = await searchGlobalItemsProtected(ctx, query, {
    limit,
    location,
  });
  return {
    kind: "search_global",
    summary: `Found ${products.length} global items. They have been displayed to the user.`,
    products,
  };
}

async function executeToolJob(
  ctx: any,
  toolName: ToolJobName,
  argsJson: string,
) {
  let parsed: any;
  try {
    parsed = JSON.parse(argsJson || "{}");
  } catch {
    parsed = {};
  }

  switch (toolName) {
    case "search_web":
      return await executeSearchWebJob(ctx, parsed);
    case "search_products":
      return await executeProductSearchJob(ctx, parsed);
    case "search_global":
      return await executeGlobalSearchJob(ctx, parsed);
    default:
      throw new Error(`Unsupported tool job: ${toolName}`);
  }
}

export const enqueue = internalMutation({
  args: {
    source: v.union(v.literal("chat_action"), v.literal("chat_http")),
    toolName: v.string(),
    argsJson: v.string(),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isToolJobName(args.toolName)) {
      throw new Error(`Unsupported tool job: ${args.toolName}`);
    }
    const config = getToolJobConfig();
    const maxQueuedForTool = config.maxQueuedByTool[args.toolName];
    const queuedForTool = await ctx.db
      .query("toolJobs")
      .withIndex("by_tool_status_available", (q) =>
        q
          .eq("toolName", args.toolName)
          .eq("status", "queued")
          .gte("availableAt", 0),
      )
      .take(maxQueuedForTool + 1);
    if (queuedForTool.length >= maxQueuedForTool) {
      throw new Error(
        `[queue_saturated:${args.toolName}] Tool queue is saturated. Please retry shortly.`,
      );
    }

    const now = Date.now();
    const maxAttempts = clampInt(
      args.maxAttempts ?? config.maxAttempts,
      1,
      Math.max(config.maxAttempts, 6),
    );
    return await ctx.db.insert("toolJobs", {
      source: args.source,
      toolName: args.toolName,
      qosClass: TOOL_JOB_QOS_BY_NAME[args.toolName],
      argsJson: args.argsJson,
      status: "queued",
      attempts: 0,
      maxAttempts,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + config.retentionMs,
    });
  },
});

export const get = internalQuery({
  args: { jobId: v.id("toolJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    return {
      _id: job._id,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      resultJson: job.resultJson,
      lastError: job.lastError,
      deadLetterReason: job.deadLetterReason,
      deadLetterAt: job.deadLetterAt,
      availableAt: job.availableAt,
      updatedAt: job.updatedAt,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  },
});

export const claimNext = internalMutation({
  args: {},
  handler: async (ctx) => {
    const config = getToolJobConfig();
    const now = Date.now();

    // Requeue stale running jobs whose lease has expired.
    const stale = await ctx.db
      .query("toolJobs")
      .withIndex("by_status_lease", (q) =>
        q.eq("status", "running").lt("leaseExpiresAt", now),
      )
      .take(20);
    for (const job of stale) {
      await ctx.db.patch(job._id, {
        status: "queued",
        availableAt: now,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
    }

    const runningByTool = createToolJobCounts();
    const runningByQos = createToolJobQosCounts();
    for (const toolName of TOOL_JOB_NAMES) {
      const cap = config.maxRunningByTool[toolName];
      const runningForTool = await ctx.db
        .query("toolJobs")
        .withIndex("by_tool_status_updated", (q) =>
          q.eq("toolName", toolName).eq("status", "running"),
        )
        .take(cap + 1);
      runningByTool[toolName] = runningForTool.length;
      const qosClass = TOOL_JOB_QOS_BY_NAME[toolName];
      runningByQos[qosClass] += runningForTool.length;
    }

    const candidates = await ctx.db
      .query("toolJobs")
      .withIndex("by_status_available", (q) =>
        q.eq("status", "queued").lte("availableAt", now),
      )
      .take(config.claimScanSize);

    const next = pickClaimableToolJob(
      candidates,
      runningByTool,
      config.maxRunningByTool,
      runningByQos,
      config.maxRunningByQos,
    );

    if (!next) return null;

    const attempts = next.attempts + 1;
    await ctx.db.patch(next._id, {
      status: "running",
      attempts,
      leaseExpiresAt: now + config.leaseMs,
      updatedAt: now,
    });

    return {
      _id: next._id,
      toolName: next.toolName,
      argsJson: next.argsJson,
      attempts,
      maxAttempts: next.maxAttempts,
    };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("toolJobs"),
    resultJson: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { ok: false };
    if (job.status !== "running") return { ok: false };

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "completed",
      resultJson: args.resultJson,
      leaseExpiresAt: undefined,
      updatedAt: now,
      completedAt: now,
    });
    return { ok: true };
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id("toolJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const config = getToolJobConfig();
    const job = await ctx.db.get(args.jobId);
    if (!job) return { ok: false, status: "missing" as const };
    if (job.status !== "running")
      return { ok: false, status: "not_running" as const };

    const now = Date.now();
    const retryDelayMs = Math.min(
      config.retryBaseMs * Math.pow(2, Math.max(job.attempts - 1, 0)),
      60_000,
    );

    if (job.attempts < job.maxAttempts) {
      await ctx.db.patch(args.jobId, {
        status: "queued",
        lastError: args.error.slice(0, 600),
        availableAt: now + retryDelayMs,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      return { ok: true, status: "requeued" as const, retryDelayMs };
    }

    await ctx.db.patch(args.jobId, {
      status: "dead_letter",
      lastError: args.error.slice(0, 600),
      deadLetterReason: args.error.slice(0, 600),
      deadLetterAt: now,
      leaseExpiresAt: undefined,
      updatedAt: now,
      completedAt: now,
      expiresAt: now + config.deadLetterRetentionMs,
    });
    return { ok: true, status: "dead_letter" as const, retryDelayMs: 0 };
  },
});

export const processQueue = internalAction({
  args: {
    maxJobs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const config = getToolJobConfig();
    const maxJobs = clampInt(
      args.maxJobs ?? config.maxJobsPerRun,
      1,
      Math.max(config.maxJobsPerRun, 10),
    );
    const processed: Array<{
      jobId: Id<"toolJobs">;
      status: "completed" | "dead_letter" | "requeued";
    }> = [];

    let workerLease: string | null = null;
    try {
      workerLease = await acquireBulkheadSlot(ctx, "tool_job_worker");
    } catch (error) {
      if (isBulkheadSaturatedError(error)) {
        return { processed: 0, jobs: [], skipped: "worker_saturated" as const };
      }
      throw error;
    }

    try {
      for (let i = 0; i < maxJobs; i++) {
        const claimed = await ctx.runMutation(internal.toolJobs.claimNext, {});
        if (!claimed) break;

        const jobId = claimed._id as Id<"toolJobs">;
        try {
          const result = await executeToolJob(
            ctx,
            claimed.toolName as ToolJobName,
            claimed.argsJson,
          );
          await ctx.runMutation(internal.toolJobs.complete, {
            jobId,
            resultJson: JSON.stringify(result),
          });
          processed.push({ jobId, status: "completed" });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error ?? "Unknown error");
          const failResult = await ctx.runMutation(internal.toolJobs.fail, {
            jobId,
            error: message,
          });
          processed.push({
            jobId,
            status: failResult.status === "requeued" ? "requeued" : "dead_letter",
          });
        }
      }
    } finally {
      await releaseBulkheadSlot(ctx, "tool_job_worker", workerLease);
    }

    return {
      processed: processed.length,
      jobs: processed,
    };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deletedJobs = 0;
    let deletedAlerts = 0;
    while (true) {
      const expired = await ctx.db
        .query("toolJobs")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(200);
      if (expired.length === 0) break;
      for (const row of expired) {
        await ctx.db.delete(row._id);
        deletedJobs += 1;
      }
    }

    while (true) {
      const expired = await ctx.db
        .query("toolQueueAlerts")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
        .take(200);
      if (expired.length === 0) break;
      for (const row of expired) {
        await ctx.db.delete(row._id);
        deletedAlerts += 1;
      }
    }
    return { deleted: deletedJobs + deletedAlerts, deletedJobs, deletedAlerts };
  },
});

const TOOL_QUEUE_ALERT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export const raiseQueueAlertIfNeeded = internalMutation({
  args: {
    kind: v.union(
      v.literal("queued_depth"),
      v.literal("oldest_queued_age"),
      v.literal("oldest_running_age"),
      v.literal("dead_letter_depth"),
    ),
    observed: v.number(),
    threshold: v.number(),
    windowMinutes: v.number(),
    cooldownMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const slot = now - (now % args.cooldownMs);
    const alertKey = `${args.kind}|${slot}`;

    const existing = await ctx.db
      .query("toolQueueAlerts")
      .withIndex("by_alert_key", (q) => q.eq("alertKey", alertKey))
      .first();
    if (existing) {
      return { created: false };
    }

    const id = await ctx.db.insert("toolQueueAlerts", {
      alertKey,
      kind: args.kind,
      observed: args.observed,
      threshold: args.threshold,
      windowMinutes: args.windowMinutes,
      createdAt: now,
      expiresAt: now + TOOL_QUEUE_ALERT_RETENTION_MS,
    });

    return { created: true, alertId: id };
  },
});

export const listRecentQueueAlerts = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 50, 1, 200);
    return await ctx.db
      .query("toolQueueAlerts")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);
  },
});

export const listDeadLetters = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? 100, 1, 500);
    return await ctx.db
      .query("toolJobs")
      .withIndex("by_status_updated", (q) => q.eq("status", "dead_letter"))
      .order("desc")
      .take(limit);
  },
});

export const requeueDeadLetter = internalMutation({
  args: {
    jobId: v.id("toolJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { ok: false, reason: "missing" as const };
    if (job.status !== "dead_letter") {
      return { ok: false, reason: "not_dead_letter" as const };
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "queued",
      availableAt: now,
      leaseExpiresAt: undefined,
      attempts: 0,
      deadLetterReason: undefined,
      deadLetterAt: undefined,
      updatedAt: now,
      expiresAt: now + getToolJobConfig().retentionMs,
    });
    return { ok: true as const };
  },
});

export const monitorQueueHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    const alertConfig = getToolQueueAlertConfig();
    if (!alertConfig.enabled) {
      return { enabled: false, createdAlerts: 0, sentryAlerts: 0 };
    }

    const stats = await ctx.runQuery(internal.toolJobs.getQueueStats, {
      limit: 5000,
    });

    const checks = [
      {
        kind: "queued_depth" as const,
        observed: stats.byStatus.queued,
        threshold: alertConfig.maxQueuedJobs,
      },
      {
        kind: "dead_letter_depth" as const,
        observed: stats.byStatus.deadLetter ?? 0,
        threshold: alertConfig.maxDeadLetterJobs,
      },
      {
        kind: "oldest_queued_age" as const,
        observed: stats.oldestQueuedAgeMs,
        threshold: alertConfig.maxOldestQueuedAgeMs,
      },
      {
        kind: "oldest_running_age" as const,
        observed: stats.oldestRunningAgeMs,
        threshold: alertConfig.maxOldestRunningAgeMs,
      },
    ];

    const sentryDsn =
      process.env.TOOL_QUEUE_SENTRY_DSN || process.env.SENTRY_DSN || "";
    let createdAlerts = 0;
    let sentryAlerts = 0;

    for (const check of checks) {
      if (check.observed <= check.threshold) continue;

      const raised = await ctx.runMutation(internal.toolJobs.raiseQueueAlertIfNeeded, {
        kind: check.kind,
        observed: check.observed,
        threshold: check.threshold,
        windowMinutes: alertConfig.windowMinutes,
        cooldownMs: alertConfig.cooldownMs,
      });
      if (!raised.created) continue;

      createdAlerts += 1;
      console.warn("[Tool Queue Alert]", {
        kind: check.kind,
        observed: check.observed,
        threshold: check.threshold,
      });

      if (!sentryDsn) continue;
      try {
        const sent = await sendSentryToolQueueAlert({
          dsn: sentryDsn,
          kind: check.kind,
          observed: check.observed,
          threshold: check.threshold,
          windowMinutes: alertConfig.windowMinutes,
        });
        if (sent) sentryAlerts += 1;
      } catch (error) {
        console.error("[Tool Queue Alert] Failed to send Sentry alert", error);
      }
    }

    return {
      enabled: true,
      createdAlerts,
      sentryAlerts,
      windowMinutes: alertConfig.windowMinutes,
    };
  },
});

export const getQueueStats = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const config = getToolJobConfig();
    const limit = clampInt(args.limit ?? 5000, 100, 20_000);
    const now = Date.now();
    const recent = await ctx.db
      .query("toolJobs")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);

    let queued = 0;
    let running = 0;
    let failed = 0;
    let deadLetter = 0;
    let completed = 0;
    const byTool = {
      search_web: {
        queued: 0,
        running: 0,
        failed: 0,
        deadLetter: 0,
        completed: 0,
      },
      search_products: {
        queued: 0,
        running: 0,
        failed: 0,
        deadLetter: 0,
        completed: 0,
      },
      search_global: {
        queued: 0,
        running: 0,
        failed: 0,
        deadLetter: 0,
        completed: 0,
      },
    };
    let oldestQueuedAt: number | null = null;
    let oldestRunningAt: number | null = null;

    for (const job of recent) {
      const toolName = isToolJobName(job.toolName) ? job.toolName : null;
      if (job.status === "queued") {
        queued += 1;
        if (toolName) byTool[toolName].queued += 1;
        if (oldestQueuedAt === null || job.availableAt < oldestQueuedAt) {
          oldestQueuedAt = job.availableAt;
        }
      } else if (job.status === "running") {
        running += 1;
        if (toolName) byTool[toolName].running += 1;
        if (oldestRunningAt === null || job.updatedAt < oldestRunningAt) {
          oldestRunningAt = job.updatedAt;
        }
      } else if (job.status === "failed") {
        failed += 1;
        if (toolName) byTool[toolName].failed += 1;
      } else if (job.status === "dead_letter") {
        failed += 1;
        deadLetter += 1;
        if (toolName) byTool[toolName].deadLetter += 1;
        if (toolName) byTool[toolName].failed += 1;
      } else if (job.status === "completed") {
        completed += 1;
        if (toolName) byTool[toolName].completed += 1;
      }
    }

    return {
      sampled: recent.length,
      byStatus: {
        queued,
        running,
        failed,
        deadLetter,
        completed,
      },
      byTool,
      pressureByTool: {
        search_web: {
          queuedUtilization:
            byTool.search_web.queued /
            Math.max(config.maxQueuedByTool.search_web, 1),
          runningUtilization:
            byTool.search_web.running /
            Math.max(config.maxRunningByTool.search_web, 1),
        },
        search_products: {
          queuedUtilization:
            byTool.search_products.queued /
            Math.max(config.maxQueuedByTool.search_products, 1),
          runningUtilization:
            byTool.search_products.running /
            Math.max(config.maxRunningByTool.search_products, 1),
        },
        search_global: {
          queuedUtilization:
            byTool.search_global.queued /
            Math.max(config.maxQueuedByTool.search_global, 1),
          runningUtilization:
            byTool.search_global.running /
            Math.max(config.maxRunningByTool.search_global, 1),
        },
      },
      oldestQueuedAgeMs: oldestQueuedAt ? now - oldestQueuedAt : 0,
      oldestRunningAgeMs: oldestRunningAt ? now - oldestRunningAt : 0,
    };
  },
});
