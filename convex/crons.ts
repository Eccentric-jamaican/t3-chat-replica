import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Renew Gmail watch subscriptions every 6 days (watches expire after 7)
crons.interval(
  "renew-gmail-watches",
  { hours: 144 }, // 6 days
  internal.integrations.gmail.sync.renewAllWatches,
  {},
);

// Catch-up sync every 30 minutes for missed Pub/Sub notifications
crons.interval(
  "gmail-catchup-sync",
  { minutes: 30 },
  internal.integrations.gmail.sync.catchupSync,
  {},
);

// Refresh eBay taxonomy monthly (category tree changes infrequently)
crons.interval(
  "refresh-ebay-taxonomy",
  { hours: 720 },
  internal.ebayTaxonomy.refreshEbayTaxonomy,
  {},
);

// Periodic cleanup for rate limit windows table.
crons.interval(
  "cleanup-rate-limit-windows",
  { hours: 1 },
  internal.rateLimit.cleanupExpired,
  {},
);

// Monitor rate-limit pressure and create deduplicated operational alerts.
crons.interval(
  "monitor-rate-limit-alerts",
  { minutes: 5 },
  internal.rateLimit.monitorAndAlert,
  {},
);

// Periodic cleanup for idempotency/replay-protection keys.
crons.interval(
  "cleanup-idempotency-keys",
  { hours: 1 },
  internal.idempotency.cleanupExpired,
  {},
);

// Periodic cleanup for bulkhead leases in case callers crash before release.
crons.interval(
  "cleanup-bulkhead-leases",
  { minutes: 30 },
  internal.bulkhead.cleanupExpiredLeases,
  {},
);

// Periodic cleanup for tool response cache entries.
crons.interval(
  "cleanup-tool-cache",
  { hours: 1 },
  internal.toolCache.cleanupExpired,
  {},
);

// Periodic cleanup for tool job queue history rows.
crons.interval(
  "cleanup-tool-jobs",
  { hours: 1 },
  internal.toolJobs.cleanupExpired,
  {},
);

// Monitor tool queue lag/backpressure and raise deduplicated alerts.
crons.interval(
  "monitor-tool-queue-health",
  { minutes: 5 },
  internal.toolJobs.monitorQueueHealth,
  {},
);

export default crons;
