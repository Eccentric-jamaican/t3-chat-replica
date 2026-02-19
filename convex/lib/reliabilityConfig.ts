import { ToolJobCounts, ToolJobQosCounts } from "./toolJobQueue";

type RateLimitKey =
  | "chatStream"
  | "gmailPushWebhook"
  | "whatsappWebhook"
  | "gmailOAuthCallback"
  | "whatsappLinkingCode";

type CircuitProvider =
  | "openrouter_chat_primary"
  | "openrouter_chat_secondary"
  | "openrouter_chat"
  | "serper_search"
  | "gmail_oauth"
  | "ebay_search"
  | "global_search";
type BulkheadProvider =
  | "openrouter_chat_primary"
  | "openrouter_chat_secondary"
  | "openrouter_chat"
  | "serper_search"
  | "gmail_oauth"
  | "ebay_search"
  | "global_search"
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
  maxRunningByQos: ToolJobQosCounts;
  deadLetterRetentionMs: number;
};

type ToolQueueAlertConfig = {
  enabled: boolean;
  windowMinutes: number;
  cooldownMs: number;
  maxQueuedJobs: number;
  maxDeadLetterJobs: number;
  maxOldestQueuedAgeMs: number;
  maxOldestRunningAgeMs: number;
};

type ChatProviderRouteConfig = {
  primaryTimeoutMs: number;
  primaryRetries: number;
  secondaryTimeoutMs: number;
  secondaryRetries: number;
  fastPrimaryModel: string;
  fastSecondaryModel: string;
  agentPrimaryModel: string;
  agentSecondaryModel: string;
  defaultModelClass: "fast" | "agent";
};

type RegionTopologyConfig = {
  regionId: string;
  topologyMode: "single_region" | "active_standby" | "active_active";
  readinessOnly: boolean;
};

export type AdmissionControlConfig = {
  enabled: boolean;
  shadowMode: boolean;
  redisUrl: string;
  redisToken: string;
  keyPrefix: string;
  enforceUserInFlight: boolean;
  enforceGlobalInFlight: boolean;
  enforceGlobalMessageRate: boolean;
  enforceGlobalToolRate: boolean;
  userMaxInFlight: number;
  globalMaxInFlight: number;
  globalMaxMessagesPerSecond: number;
  globalMaxToolCallsPerSecond: number;
  estimatedToolCallsPerMessage: number;
  ticketTtlMs: number;
  retryAfterMs: number;
  retryAfterJitterPct: number;
  allowedEventSamplePct: number;
};

export type ChatGatewayFlags = {
  enabled: boolean;
  shadowMode: boolean;
  admissionEnforce: boolean;
  toolQueueEnforce: boolean;
  providerFailoverEnabled: boolean;
  failClosedOnRedisError: boolean;
  healthEndpointEnabled: boolean;
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
  openrouter_chat_primary: {
    threshold: 5,
    cooldownMs: 60_000,
  },
  openrouter_chat_secondary: {
    threshold: 4,
    cooldownMs: 45_000,
  },
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
  ebay_search: {
    threshold: 4,
    cooldownMs: 120_000,
  },
  global_search: {
    threshold: 4,
    cooldownMs: 120_000,
  },
};

const DEFAULT_BULKHEADS: BulkheadConfig = {
  openrouter_chat_primary: {
    maxConcurrent: 24,
    leaseTtlMs: 10 * 60 * 1000,
  },
  openrouter_chat_secondary: {
    maxConcurrent: 16,
    leaseTtlMs: 10 * 60 * 1000,
  },
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
  ebay_search: {
    maxConcurrent: 8,
    leaseTtlMs: 60 * 1000,
  },
  global_search: {
    maxConcurrent: 10,
    leaseTtlMs: 60 * 1000,
  },
  tool_job_worker: {
    maxConcurrent: 6,
    leaseTtlMs: 60 * 1000,
  },
};

const DEFAULT_ADMISSION_CONTROL: AdmissionControlConfig = {
  enabled: false,
  shadowMode: true,
  redisUrl: "",
  redisToken: "",
  keyPrefix: "admit:chat",
  enforceUserInFlight: true,
  enforceGlobalInFlight: true,
  enforceGlobalMessageRate: true,
  enforceGlobalToolRate: true,
  userMaxInFlight: 1,
  globalMaxInFlight: 300,
  globalMaxMessagesPerSecond: 120,
  globalMaxToolCallsPerSecond: 220,
  estimatedToolCallsPerMessage: 2,
  ticketTtlMs: 45_000,
  retryAfterMs: 1_000,
  retryAfterJitterPct: 20,
  allowedEventSamplePct: 5,
};

const DEFAULT_CHAT_GATEWAY_FLAGS: ChatGatewayFlags = {
  enabled: false,
  shadowMode: true,
  admissionEnforce: false,
  toolQueueEnforce: false,
  providerFailoverEnabled: false,
  failClosedOnRedisError: false,
  healthEndpointEnabled: true,
};

const DEFAULT_CHAT_PROVIDER_ROUTING: ChatProviderRouteConfig = {
  primaryTimeoutMs: 45_000,
  primaryRetries: 0,
  secondaryTimeoutMs: 35_000,
  secondaryRetries: 0,
  fastPrimaryModel: "moonshotai/kimi-k2.5",
  fastSecondaryModel: "google/gemini-2.0-flash-exp:free",
  agentPrimaryModel: "openai/gpt-5",
  agentSecondaryModel: "moonshotai/kimi-k2.5",
  defaultModelClass: "agent",
};

const DEFAULT_REGION_TOPOLOGY: RegionTopologyConfig = {
  regionId: "us-east-1",
  topologyMode: "single_region",
  readinessOnly: true,
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

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parseNamespaceVersion(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (!/^[a-z0-9_-]{1,24}$/.test(trimmed)) return fallback;
  return trimmed;
}

function parsePrefix(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(trimmed)) return fallback;
  return trimmed;
}

function parseRegionId(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (!/^[a-z0-9-]{2,24}$/.test(trimmed)) return fallback;
  return trimmed;
}

function parseTopologyMode(
  value: string | undefined,
  fallback: RegionTopologyConfig["topologyMode"],
) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "single_region") return "single_region";
  if (normalized === "active_standby") return "active_standby";
  if (normalized === "active_active") return "active_active";
  return fallback;
}

function parseModelId(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^[a-zA-Z0-9._:/-]{3,120}$/.test(trimmed)) return fallback;
  return trimmed;
}

function parseModelClass(
  value: string | undefined,
  fallback: "fast" | "agent",
) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "fast") return "fast";
  if (normalized === "agent") return "agent";
  return fallback;
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
    openrouter_chat_primary: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD,
        DEFAULT_CIRCUITS.openrouter_chat_primary.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS,
        DEFAULT_CIRCUITS.openrouter_chat_primary.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    openrouter_chat_secondary: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD,
        DEFAULT_CIRCUITS.openrouter_chat_secondary.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS,
        DEFAULT_CIRCUITS.openrouter_chat_secondary.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
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
    ebay_search: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_EBAY_THRESHOLD,
        DEFAULT_CIRCUITS.ebay_search.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_EBAY_COOLDOWN_MS,
        DEFAULT_CIRCUITS.ebay_search.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
    global_search: {
      threshold: parsePositiveInt(
        process.env.CIRCUIT_GLOBAL_SEARCH_THRESHOLD,
        DEFAULT_CIRCUITS.global_search.threshold,
        1,
        100,
      ),
      cooldownMs: parsePositiveInt(
        process.env.CIRCUIT_GLOBAL_SEARCH_COOLDOWN_MS,
        DEFAULT_CIRCUITS.global_search.cooldownMs,
        1000,
        60 * 60 * 1000,
      ),
    },
  };
}

export function getBulkheadConfig(): BulkheadConfig {
  return {
    openrouter_chat_primary: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_OR_PRI_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.openrouter_chat_primary.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_OR_PRI_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.openrouter_chat_primary.leaseTtlMs,
        15_000,
        60 * 60 * 1000,
      ),
    },
    openrouter_chat_secondary: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_OR_SEC_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.openrouter_chat_secondary.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_OR_SEC_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.openrouter_chat_secondary.leaseTtlMs,
        15_000,
        60 * 60 * 1000,
      ),
    },
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
    ebay_search: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_EBAY_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.ebay_search.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_EBAY_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.ebay_search.leaseTtlMs,
        15_000,
        60 * 60 * 1000,
      ),
    },
    global_search: {
      maxConcurrent: parsePositiveInt(
        process.env.BULKHEAD_GLOBAL_SEARCH_MAX_CONCURRENT,
        DEFAULT_BULKHEADS.global_search.maxConcurrent,
        1,
        500,
      ),
      leaseTtlMs: parsePositiveInt(
        process.env.BULKHEAD_GLOBAL_SEARCH_LEASE_TTL_MS,
        DEFAULT_BULKHEADS.global_search.leaseTtlMs,
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
    maxJobsPerRun: parsePositiveInt(process.env.TOOL_JOB_MAX_PER_RUN, 3, 1, 20),
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
    maxAttempts: parsePositiveInt(process.env.TOOL_JOB_MAX_ATTEMPTS, 2, 1, 10),
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
      search_web: parsePositiveInt(process.env.TOOL_JOB_RUNMAX_WEB, 2, 1, 100),
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
    maxRunningByQos: {
      realtime: parsePositiveInt(
        process.env.TOOL_JOB_RUNMAX_QOS_REALTIME,
        2,
        1,
        100,
      ),
      interactive: parsePositiveInt(
        process.env.TOOL_JOB_RUNMAX_QOS_INTERACTIVE,
        2,
        1,
        100,
      ),
      batch: parsePositiveInt(
        process.env.TOOL_JOB_RUNMAX_QOS_BATCH,
        1,
        1,
        100,
      ),
    },
    deadLetterRetentionMs: parsePositiveInt(
      process.env.TOOL_JOB_DLQ_TTL_MS,
      7 * 24 * 60 * 60 * 1000,
      60_000,
      90 * 24 * 60 * 60 * 1000,
    ),
  };
}

export function getToolQueueAlertConfig(): ToolQueueAlertConfig {
  return {
    enabled: parseBoolean(process.env.TOOL_QUEUE_ALERTS_ENABLED, true),
    windowMinutes: parsePositiveInt(
      process.env.TOOL_QUEUE_ALERT_WINDOW_MIN,
      5,
      1,
      60,
    ),
    cooldownMs: parsePositiveInt(
      process.env.TOOL_QUEUE_ALERT_COOLDOWN_MS,
      15 * 60 * 1000,
      60_000,
      24 * 60 * 60 * 1000,
    ),
    maxQueuedJobs: parsePositiveInt(
      process.env.TOOL_QUEUE_ALERT_MAX_QUEUED,
      200,
      1,
      500_000,
    ),
    maxDeadLetterJobs: parsePositiveInt(
      process.env.TOOL_QUEUE_ALERT_MAX_DLQ,
      20,
      1,
      500_000,
    ),
    maxOldestQueuedAgeMs: parsePositiveInt(
      process.env.TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS,
      60_000,
      1000,
      60 * 60 * 1000,
    ),
    maxOldestRunningAgeMs: parsePositiveInt(
      process.env.TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS,
      5 * 60 * 1000,
      1000,
      60 * 60 * 1000,
    ),
  };
}

export function getChatProviderRouteConfig(): ChatProviderRouteConfig {
  return {
    primaryTimeoutMs: parsePositiveInt(
      process.env.CHAT_PROVIDER_PRIMARY_TIMEOUT_MS,
      DEFAULT_CHAT_PROVIDER_ROUTING.primaryTimeoutMs,
      1000,
      120_000,
    ),
    primaryRetries: parsePositiveInt(
      process.env.CHAT_PROVIDER_PRIMARY_RETRIES,
      DEFAULT_CHAT_PROVIDER_ROUTING.primaryRetries,
      0,
      3,
    ),
    secondaryTimeoutMs: parsePositiveInt(
      process.env.CHAT_PROVIDER_SECONDARY_TIMEOUT_MS,
      DEFAULT_CHAT_PROVIDER_ROUTING.secondaryTimeoutMs,
      1000,
      120_000,
    ),
    secondaryRetries: parsePositiveInt(
      process.env.CHAT_PROVIDER_SECONDARY_RETRIES,
      DEFAULT_CHAT_PROVIDER_ROUTING.secondaryRetries,
      0,
      3,
    ),
    fastPrimaryModel: parseModelId(
      process.env.CHAT_MODEL_FAST_PRIMARY,
      DEFAULT_CHAT_PROVIDER_ROUTING.fastPrimaryModel,
    ),
    fastSecondaryModel: parseModelId(
      process.env.CHAT_MODEL_FAST_SECONDARY,
      DEFAULT_CHAT_PROVIDER_ROUTING.fastSecondaryModel,
    ),
    agentPrimaryModel: parseModelId(
      process.env.CHAT_MODEL_AGENT_PRIMARY,
      DEFAULT_CHAT_PROVIDER_ROUTING.agentPrimaryModel,
    ),
    agentSecondaryModel: parseModelId(
      process.env.CHAT_MODEL_AGENT_SECONDARY,
      DEFAULT_CHAT_PROVIDER_ROUTING.agentSecondaryModel,
    ),
    defaultModelClass: parseModelClass(
      process.env.CHAT_DEFAULT_MODEL_CLASS,
      DEFAULT_CHAT_PROVIDER_ROUTING.defaultModelClass,
    ),
  };
}

export function getRegionTopologyConfig(): RegionTopologyConfig {
  return {
    regionId: parseRegionId(
      process.env.RELIABILITY_REGION_ID,
      DEFAULT_REGION_TOPOLOGY.regionId,
    ),
    topologyMode: parseTopologyMode(
      process.env.RELIABILITY_TOPOLOGY_MODE,
      DEFAULT_REGION_TOPOLOGY.topologyMode,
    ),
    readinessOnly: parseBoolean(
      process.env.RELIABILITY_REGION_READINESS_ONLY,
      DEFAULT_REGION_TOPOLOGY.readinessOnly,
    ),
  };
}

export function getAdmissionControlConfig(): AdmissionControlConfig {
  return {
    enabled: parseBoolean(
      process.env.ADMISSION_REDIS_ENABLED,
      DEFAULT_ADMISSION_CONTROL.enabled,
    ),
    shadowMode: parseBoolean(
      process.env.ADMISSION_REDIS_SHADOW_MODE,
      DEFAULT_ADMISSION_CONTROL.shadowMode,
    ),
    redisUrl: (process.env.ADMISSION_REDIS_URL ?? "").trim(),
    redisToken: (process.env.ADMISSION_REDIS_TOKEN ?? "").trim(),
    keyPrefix: parsePrefix(
      process.env.ADMISSION_REDIS_KEY_PREFIX,
      DEFAULT_ADMISSION_CONTROL.keyPrefix,
    ),
    enforceUserInFlight: parseBoolean(
      process.env.ADMISSION_ENFORCE_USER_INFLIGHT,
      DEFAULT_ADMISSION_CONTROL.enforceUserInFlight,
    ),
    enforceGlobalInFlight: parseBoolean(
      process.env.ADMISSION_ENFORCE_GLOBAL_INFLIGHT,
      DEFAULT_ADMISSION_CONTROL.enforceGlobalInFlight,
    ),
    enforceGlobalMessageRate: parseBoolean(
      process.env.ADMISSION_ENFORCE_GLOBAL_MSG_RATE,
      DEFAULT_ADMISSION_CONTROL.enforceGlobalMessageRate,
    ),
    enforceGlobalToolRate: parseBoolean(
      process.env.ADMISSION_ENFORCE_GLOBAL_TOOL_RATE,
      DEFAULT_ADMISSION_CONTROL.enforceGlobalToolRate,
    ),
    userMaxInFlight: parsePositiveInt(
      process.env.ADMISSION_USER_MAX_INFLIGHT,
      DEFAULT_ADMISSION_CONTROL.userMaxInFlight,
      1,
      100,
    ),
    globalMaxInFlight: parsePositiveInt(
      process.env.ADMISSION_GLOBAL_MAX_INFLIGHT,
      DEFAULT_ADMISSION_CONTROL.globalMaxInFlight,
      1,
      100_000,
    ),
    globalMaxMessagesPerSecond: parsePositiveInt(
      process.env.ADMISSION_GLOBAL_MAX_MSG_PER_SEC,
      DEFAULT_ADMISSION_CONTROL.globalMaxMessagesPerSecond,
      1,
      100_000,
    ),
    globalMaxToolCallsPerSecond: parsePositiveInt(
      process.env.ADMISSION_GLOBAL_MAX_TOOL_PER_SEC,
      DEFAULT_ADMISSION_CONTROL.globalMaxToolCallsPerSecond,
      1,
      200_000,
    ),
    estimatedToolCallsPerMessage: parsePositiveInt(
      process.env.ADMISSION_EST_TOOL_CALLS_PER_MSG,
      DEFAULT_ADMISSION_CONTROL.estimatedToolCallsPerMessage,
      0,
      100,
    ),
    ticketTtlMs: parsePositiveInt(
      process.env.ADMISSION_TICKET_TTL_MS,
      DEFAULT_ADMISSION_CONTROL.ticketTtlMs,
      1_000,
      10 * 60 * 1000,
    ),
    retryAfterMs: parsePositiveInt(
      process.env.ADMISSION_RETRY_AFTER_MS,
      DEFAULT_ADMISSION_CONTROL.retryAfterMs,
      100,
      60_000,
    ),
    retryAfterJitterPct: parsePositiveInt(
      process.env.ADMISSION_RETRY_AFTER_JITTER_PCT,
      DEFAULT_ADMISSION_CONTROL.retryAfterJitterPct,
      0,
      90,
    ),
    allowedEventSamplePct: parsePositiveInt(
      process.env.ADMISSION_ALLOWED_EVENT_SAMPLE_PCT,
      DEFAULT_ADMISSION_CONTROL.allowedEventSamplePct,
      0,
      100,
    ),
  };
}

export function getChatGatewayFlags(): ChatGatewayFlags {
  return {
    enabled: parseBoolean(
      process.env.FF_CHAT_GATEWAY_ENABLED,
      DEFAULT_CHAT_GATEWAY_FLAGS.enabled,
    ),
    shadowMode: parseBoolean(
      process.env.FF_CHAT_GATEWAY_SHADOW,
      DEFAULT_CHAT_GATEWAY_FLAGS.shadowMode,
    ),
    admissionEnforce: parseBoolean(
      process.env.FF_ADMISSION_ENFORCE,
      DEFAULT_CHAT_GATEWAY_FLAGS.admissionEnforce,
    ),
    toolQueueEnforce: parseBoolean(
      process.env.FF_TOOL_QUEUE_ENFORCE,
      DEFAULT_CHAT_GATEWAY_FLAGS.toolQueueEnforce,
    ),
    providerFailoverEnabled: parseBoolean(
      process.env.FF_PROVIDER_FAILOVER_ENABLED,
      DEFAULT_CHAT_GATEWAY_FLAGS.providerFailoverEnabled,
    ),
    failClosedOnRedisError: parseBoolean(
      process.env.FF_FAIL_CLOSED_ON_REDIS_ERROR,
      DEFAULT_CHAT_GATEWAY_FLAGS.failClosedOnRedisError,
    ),
    healthEndpointEnabled: parseBoolean(
      process.env.FF_CHAT_GATEWAY_HEALTH_ENABLED,
      DEFAULT_CHAT_GATEWAY_FLAGS.healthEndpointEnabled,
    ),
  };
}
