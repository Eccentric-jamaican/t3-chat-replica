type RateLimitKey =
  | "chatStream"
  | "gmailPushWebhook"
  | "whatsappWebhook"
  | "gmailOAuthCallback"
  | "whatsappLinkingCode";

type CircuitProvider = "openrouter_chat" | "serper_search" | "gmail_oauth";
type BulkheadProvider =
  | "openrouter_chat"
  | "serper_search"
  | "gmail_oauth"
  | "tool_job_worker";

type RateLimitConfig = Record<
  RateLimitKey,
  {
    max: number;
    windowMs: number;
  }
>;

type CircuitConfig = Record<
  CircuitProvider,
  {
    threshold: number;
    cooldownMs: number;
  }
>;

type BulkheadConfig = Record<
  BulkheadProvider,
  {
    maxConcurrent: number;
    leaseTtlMs: number;
  }
>;

type ToolCacheConfig = {
  webSearchTtlMs: number;
  productSearchTtlMs: number;
};

type ToolCacheNamespaces = {
  webSearch: string;
  productSearch: string;
};

type ToolJobConfig = {
  maxJobsPerRun: number;
  leaseMs: number;
  waitTimeoutMs: number;
  pollIntervalMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retentionMs: number;
  claimScanSize: number;
  maxRunningByTool: ToolJobCounts;
  maxQueuedByTool: ToolJobCounts;
};

const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  chatStream: {
    max: 30,
    windowMs: 5 * 60 * 1000,
  },
  gmailPushWebhook: {
    max: 120,
    windowMs: 60 * 1000,
  },
  whatsappWebhook: {
    max: 120,
    windowMs: 60 * 1000,
  },
  gmailOAuthCallback: {
    max: 30,
    windowMs: 5 * 60 * 1000,
  },
  whatsappLinkingCode: {
    max: 5,
    windowMs: 10 * 60 * 1000,
  },
};

const DEFAULT_CIRCUITS: CircuitConfig = {
  openrouter_chat: {
    threshold: 5,
    cooldownMs: 60_000,
  },
  serper_search: {
    threshold: 4,
    cooldownMs: 120_000,
  },
  gmail_oauth: {
    threshold: 4,
    cooldownMs: 120_000,
  },
};

const DEFAULT_BULKHEADS: BulkheadConfig = {
  openrouter_chat: {
    maxConcurrent: 24,
    leaseTtlMs: 10 * 60 * 1000,
  },
  serper_search: {
    maxConcurrent: 12,
    leaseTtlMs: 60 * 1000,
  },
  gmail_oauth: {
    maxConcurrent: 8,
    leaseTtlMs: 60 * 1000,
  },
  tool_job_worker: {
    maxConcurrent: 6,
    leaseTtlMs: 60 * 1000,
  },
};

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function parseNamespaceVersion(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (!/^[a-z0-9_-]{1,24}$/.test(trimmed)) return fallback;
  return trimmed;
}

export function getRateLimitConfig(): RateLimitConfig {
  return {
    chatStream: {
      max: parsePositiveInt(
        process.env.RATE_LIMIT_CHAT_STREAM_MAX,
        DEFAULT_RATE_LIMITS.chatStream.max,
        1,
        1000,
      ),
      windowMs: parsePositiveInt(
        process.env.RATE_LIMIT_CHAT_STREAM_WINDOW_MS,
        DEFAULT_RATE_LIMITS.chatStream.windowMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    gmailPushWebhook: {
      max: parsePositiveInt(
        process.env.RATE_LIMIT_GMAIL_PUSH_MAX,
        DEFAULT_RATE_LIMITS.gmailPushWebhook.max,
        1,
        5000,
      ),
      windowMs: parsePositiveInt(
        process.env.RATE_LIMIT_GMAIL_PUSH_WINDOW_MS,
        DEFAULT_RATE_LIMITS.gmailPushWebhook.windowMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    whatsappWebhook: {
      max: parsePositiveInt(
        process.env.RATE_LIMIT_WHATSAPP_MAX,
        DEFAULT_RATE_LIMITS.whatsappWebhook.max,
        1,
        5000,
      ),
      windowMs: parsePositiveInt(
        process.env.RATE_LIMIT_WHATSAPP_WINDOW_MS,
        DEFAULT_RATE_LIMITS.whatsappWebhook.windowMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    gmailOAuthCallback: {
      max: parsePositiveInt(
        process.env.RATE_LIMIT_GMAIL_OAUTH_MAX,
        DEFAULT_RATE_LIMITS.gmailOAuthCallback.max,
        1,
        1000,
      ),
      windowMs: parsePositiveInt(
        process.env.RATE_LIMIT_GMAIL_OAUTH_WINDOW_MS,
        DEFAULT_RATE_LIMITS.gmailOAuthCallback.windowMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    whatsappLinkingCode: {
      max: parsePositiveInt(
        process.env.RATE_LIMIT_WA_LINK_CODE_MAX,
        DEFAULT_RATE_LIMITS.whatsappLinkingCode.max,
        1,
        100,
      ),
      windowMs: parsePositiveInt(
        process.env.RATE_LIMIT_WA_LINK_CODE_WINDOW_MS,
        DEFAULT_RATE_LIMITS.whatsappLinkingCode.windowMs,
        1000,
        60 * 60 * 1000,
      ),
    },
  };
}

export function getCircuitConfig(): CircuitConfig {
  return {
    openrouter_chat: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_OPENROUTER_THRESHOLD,
        DEFAULT_CIRCUITS.openrouter_chat.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_OPENROUTER_COOLDOWN_MS,
        DEFAULT_CIRCUITS.openrouter_chat.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    serper_search: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_SERPER_THRESHOLD,
        DEFAULT_CIRCUITS.serper_search.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_SERPER_COOLDOWN_MS,
        DEFAULT_CIRCUITS.serper_search.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    gmail_oauth: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_GMAIL_OAUTH_THRESHOLD,
        DEFAULT_CIRCUITS.gmail_oauth.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_GMAIL_OAUTH_COOLDOWN_MS,
        DEFAULT_CIRCUITS.gmail_oauth.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
  };
}

export function getBulkheadConfig(): BulkheadConfig {
  return {
    openrouter_chat: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.openrouter_chat.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_OPENROUTER_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.openrouter_chat.leaseTtlMs,
        15_000,
        60 * 60 * 1000,
      ),
    },
    serper_search: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_SERPER_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.serper_search.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_SERPER_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.serper_search.leaseTtlMs,
        15_000,
        60 * 60 * 1000,
      ),
    },
    gmail_oauth: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_GMAIL_OAUTH_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.gmail_oauth.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_GMAIL_OAUTH_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.gmail_oauth.leaseTtlMs,
        15_000,
        60 * 60 * 1000,
      ),
    },
    tool_job_worker: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_TOOL_JOB_MAX,
        DEFAULT_BULKHEADS.tool_job_worker.maxConcurrent,
        1,
        200,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_TOOL_JOB_LEASE_MS,
        DEFAULT_BULKHEADS.tool_job_worker.leaseTtlMs,
        15_000,
        30 * 60 * 1000,
      ),
    },
  };
}

export function getBulkheadSentryCooldownMs() {
  return parsePositiveInt(
    process.env.BULKHEAD_SENTRY_COOLDOWN_MS,
    60_000,
    1_000,
    10 * 60 * 1000,
  );
}

export function getOpsSnapshotConfig() {
  return {
    defaultWindowMinutes: parsePositiveInt(
      process.env.OPS_DEFAULT_WINDOW_MINUTES,
      15,
      1,
      24 * 60,
    ),
    maxRowsPerSection: parsePositiveInt(
      process.env.OPS_MAX_ROWS_PER_SECTION,
      50,
      5,
      500,
    ),
  };
}

export function getToolCacheConfig(): ToolCacheConfig {
  return {
    webSearchTtlMs: parsePositiveInt(
      process.env.TOOL_CACHE_WEB_SEARCH_TTL_MS,
      5 * 60 * 1000,
      5_000,
      24 * 60 * 60 * 1000,
    ),
    productSearchTtlMs: parsePositiveInt(
      process.env.TOOL_CACHE_PRODUCT_SEARCH_TTL_MS,
      10 * 60 * 1000,
      5_000,
      24 * 60 * 60 * 1000,
    ),
  };
}

export function getToolCacheNamespaces(): ToolCacheNamespaces {
  const webSearchVersion = parseNamespaceVersion(
    process.env.TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION,
    "v1",
  );
  const productSearchVersion = parseNamespaceVersion(
    process.env.TOOL_CACHE_PRODUCTS_NS_VER,
    "v1",
  );

  return {
    webSearch: `search_web_${webSearchVersion}`,
    productSearch: `search_products_${productSearchVersion}`,
  };
}

export function getToolJobConfig(): ToolJobConfig {
  return {
    maxJobsPerRun: parsePositiveInt(
      process.env.TOOL_JOB_MAX_PER_RUN,
      3,
      1,
      20,
    ),
    leaseMs: parsePositiveInt(
      process.env.TOOL_JOB_LEASE_MS,
      45_000,
      5_000,
      10 * 60 * 1000,
    ),
    waitTimeoutMs: parsePositiveInt(
      process.env.TOOL_JOB_WAIT_MS,
      8_000,
      1_000,
      60_000,
    ),
    pollIntervalMs: parsePositiveInt(
      process.env.TOOL_JOB_POLL_MS,
      250,
      50,
      5_000,
    ),
    maxAttempts: parsePositiveInt(
      process.env.TOOL_JOB_MAX_ATTEMPTS,
      2,
      1,
      10,
    ),
    retryBaseMs: parsePositiveInt(
      process.env.TOOL_JOB_RETRY_BASE_MS,
      1_000,
      100,
      60_000,
    ),
    retentionMs: parsePositiveInt(
      process.env.TOOL_JOB_TTL_MS,
      24 * 60 * 60 * 1000,
      5 * 60 * 1000,
      30 * 24 * 60 * 60 * 1000,
    ),
    claimScanSize: parsePositiveInt(
      process.env.TOOL_JOB_CLAIM_SCAN,
      200,
      10,
      2000,
    ),
    maxRunningByTool: {
      search_web: parsePositiveInt(
        process.env.TOOL_JOB_RUNMAX_WEB,
        2,
        1,
        100,
      ),
      search_products: parsePositiveInt(
        process.env.TOOL_JOB_RUNMAX_PROD,
        2,
        1,
        100,
      ),
      search_global: parsePositiveInt(
        process.env.TOOL_JOB_RUNMAX_GLOB,
        1,
        1,
        100,
      ),
    },
    maxQueuedByTool: {
      search_web: parsePositiveInt(
        process.env.TOOL_JOB_QMAX_WEB,
        80,
        1,
        10_000,
      ),
      search_products: parsePositiveInt(
        process.env.TOOL_JOB_QMAX_PROD,
        80,
        1,
        10_000,
      ),
      search_global: parsePositiveInt(
        process.env.TOOL_JOB_QMAX_GLOB,
        40,
        1,
        10_000,
      ),
    },
  };
}
import { ToolJobCounts } from "./toolJobQueue";
