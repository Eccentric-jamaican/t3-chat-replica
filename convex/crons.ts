import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Renew Gmail watch subscriptions every 6 days (watches expire after 7)
crons.interval(
  "renew-gmail-watches",
  { hours: 144 }, // 6 days
  internal.integrations.gmail.sync.renewAllWatches,
);

// Catch-up sync every 30 minutes for missed Pub/Sub notifications
crons.interval(
  "gmail-catchup-sync",
  { minutes: 30 },
  internal.integrations.gmail.sync.catchupSync,
);

// Refresh eBay taxonomy monthly (category tree changes infrequently)
crons.interval(
  "refresh-ebay-taxonomy",
  { hours: 720 },
  internal.ebayTaxonomy.refreshEbayTaxonomy,
);

export default crons;
