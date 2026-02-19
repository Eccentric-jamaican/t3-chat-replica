import { afterEach, describe, expect, test } from "vitest";
import {
  getAdmissionControlConfig,
  getBulkheadConfig,
  getChatProviderRouteConfig,
  getChatGatewayFlags,
  getCircuitConfig,
  getRateLimitConfig,
  getRegionTopologyConfig,
  getToolCacheConfig,
  getToolCacheNamespaces,
  getToolJobConfig,
  getToolQueueAlertConfig,
} from "./reliabilityConfig";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("reliabilityConfig", () => {
  test("returns defaults when env vars are unset", () => {
    delete process.env.RATE_LIMIT_CHAT_STREAM_MAX;
    delete process.env.RATE_LIMIT_WA_LINK_CODE_MAX;
    delete process.env.TOOL_CACHE_WEB_SEARCH_TTL_MS;
    delete process.env.TOOL_CACHE_PRODUCT_SEARCH_TTL_MS;
    delete process.env.TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION;
    delete process.env.TOOL_CACHE_PRODUCTS_NS_VER;
    delete process.env.BULKHEAD_TOOL_JOB_MAX;
    delete process.env.TOOL_JOB_MAX_PER_RUN;
    delete process.env.TOOL_JOB_CLAIM_SCAN;
    delete process.env.TOOL_JOB_RUNMAX_WEB;
    delete process.env.TOOL_JOB_RUNMAX_PROD;
    delete process.env.TOOL_JOB_RUNMAX_GLOB;
    delete process.env.TOOL_JOB_QMAX_WEB;
    delete process.env.TOOL_JOB_QMAX_PROD;
    delete process.env.TOOL_JOB_QMAX_GLOB;
    delete process.env.TOOL_JOB_RUNMAX_QOS_REALTIME;
    delete process.env.TOOL_JOB_RUNMAX_QOS_INTERACTIVE;
    delete process.env.TOOL_JOB_RUNMAX_QOS_BATCH;
    delete process.env.TOOL_JOB_DLQ_TTL_MS;
    delete process.env.TOOL_QUEUE_ALERTS_ENABLED;
    delete process.env.TOOL_QUEUE_ALERT_WINDOW_MIN;
    delete process.env.TOOL_QUEUE_ALERT_COOLDOWN_MS;
    delete process.env.TOOL_QUEUE_ALERT_MAX_QUEUED;
    delete process.env.TOOL_QUEUE_ALERT_MAX_DLQ;
    delete process.env.TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS;
    delete process.env.TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS;
    delete process.env.CIRCUIT_OPENROUTER_THRESHOLD;
    delete process.env.CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD;
    delete process.env.CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS;
    delete process.env.CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD;
    delete process.env.CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS;
    delete process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT;
    delete process.env.BULKHEAD_OR_PRI_MAX_CONCURRENT;
    delete process.env.BULKHEAD_OR_PRI_LEASE_TTL_MS;
    delete process.env.BULKHEAD_OR_SEC_MAX_CONCURRENT;
    delete process.env.BULKHEAD_OR_SEC_LEASE_TTL_MS;
    delete process.env.CHAT_PROVIDER_PRIMARY_TIMEOUT_MS;
    delete process.env.CHAT_PROVIDER_PRIMARY_RETRIES;
    delete process.env.CHAT_PROVIDER_SECONDARY_TIMEOUT_MS;
    delete process.env.CHAT_PROVIDER_SECONDARY_RETRIES;
    delete process.env.CHAT_MODEL_FAST_PRIMARY;
    delete process.env.CHAT_MODEL_FAST_SECONDARY;
    delete process.env.CHAT_MODEL_AGENT_PRIMARY;
    delete process.env.CHAT_MODEL_AGENT_SECONDARY;
    delete process.env.CHAT_DEFAULT_MODEL_CLASS;
    delete process.env.ADMISSION_REDIS_ENABLED;
    delete process.env.ADMISSION_REDIS_SHADOW_MODE;
    delete process.env.ADMISSION_REDIS_URL;
    delete process.env.ADMISSION_REDIS_TOKEN;
    delete process.env.ADMISSION_REDIS_KEY_PREFIX;
    delete process.env.ADMISSION_ENFORCE_USER_INFLIGHT;
    delete process.env.ADMISSION_ENFORCE_GLOBAL_INFLIGHT;
    delete process.env.ADMISSION_ENFORCE_GLOBAL_MSG_RATE;
    delete process.env.ADMISSION_ENFORCE_GLOBAL_TOOL_RATE;
    delete process.env.ADMISSION_GLOBAL_MAX_INFLIGHT;
    delete process.env.ADMISSION_GLOBAL_MAX_MSG_PER_SEC;
    delete process.env.ADMISSION_GLOBAL_MAX_TOOL_PER_SEC;
    delete process.env.ADMISSION_EST_TOOL_CALLS_PER_MSG;
    delete process.env.ADMISSION_TICKET_TTL_MS;
    delete process.env.ADMISSION_RETRY_AFTER_MS;
    delete process.env.ADMISSION_RETRY_AFTER_JITTER_PCT;
    delete process.env.ADMISSION_ALLOWED_EVENT_SAMPLE_PCT;
    delete process.env.FF_CHAT_GATEWAY_ENABLED;
    delete process.env.FF_CHAT_GATEWAY_SHADOW;
    delete process.env.FF_ADMISSION_ENFORCE;
    delete process.env.FF_TOOL_QUEUE_ENFORCE;
    delete process.env.FF_PROVIDER_FAILOVER_ENABLED;
    delete process.env.FF_FAIL_CLOSED_ON_REDIS_ERROR;
    delete process.env.FF_CHAT_GATEWAY_HEALTH_ENABLED;
    delete process.env.RELIABILITY_REGION_ID;
    delete process.env.RELIABILITY_TOPOLOGY_MODE;
    delete process.env.RELIABILITY_REGION_READINESS_ONLY;

    expect(getRateLimitConfig().chatStream.max).toBe(30);
    expect(getRateLimitConfig().whatsappLinkingCode.max).toBe(5);
    expect(getToolCacheConfig().webSearchTtlMs).toBe(300000);
    expect(getToolCacheConfig().productSearchTtlMs).toBe(600000);
    expect(getToolCacheNamespaces()).toEqual({
      webSearch: "search_web_v1",
      productSearch: "search_products_v1",
    });
    expect(getBulkheadConfig().tool_job_worker.maxConcurrent).toBe(6);
    expect(getToolJobConfig().maxJobsPerRun).toBe(3);
    expect(getToolJobConfig().claimScanSize).toBe(200);
    expect(getToolJobConfig().maxRunningByTool.search_web).toBe(2);
    expect(getToolJobConfig().maxQueuedByTool.search_products).toBe(80);
    expect(getToolJobConfig().maxRunningByQos).toEqual({
      realtime: 2,
      interactive: 2,
      batch: 1,
    });
    expect(getToolJobConfig().deadLetterRetentionMs).toBe(604800000);
    expect(getToolQueueAlertConfig()).toEqual({
      enabled: true,
      windowMinutes: 5,
      cooldownMs: 900000,
      maxQueuedJobs: 200,
      maxDeadLetterJobs: 20,
      maxOldestQueuedAgeMs: 60000,
      maxOldestRunningAgeMs: 300000,
    });
    expect(getCircuitConfig().openrouter_chat_primary.threshold).toBe(5);
    expect(getCircuitConfig().openrouter_chat_secondary.threshold).toBe(4);
    expect(getCircuitConfig().openrouter_chat.threshold).toBe(5);
    expect(getBulkheadConfig().openrouter_chat_primary.maxConcurrent).toBe(24);
    expect(getBulkheadConfig().openrouter_chat_secondary.maxConcurrent).toBe(16);
    expect(getBulkheadConfig().openrouter_chat.maxConcurrent).toBe(24);
    expect(getChatProviderRouteConfig()).toEqual({
      primaryTimeoutMs: 45000,
      primaryRetries: 0,
      secondaryTimeoutMs: 35000,
      secondaryRetries: 0,
      fastPrimaryModel: "moonshotai/kimi-k2.5",
      fastSecondaryModel: "google/gemini-2.0-flash-exp:free",
      agentPrimaryModel: "openai/gpt-5",
      agentSecondaryModel: "moonshotai/kimi-k2.5",
      defaultModelClass: "agent",
    });
    expect(getAdmissionControlConfig()).toMatchObject({
      enabled: false,
      shadowMode: true,
      keyPrefix: "admit:chat",
      enforceUserInFlight: true,
      enforceGlobalInFlight: true,
      enforceGlobalMessageRate: true,
      enforceGlobalToolRate: true,
      globalMaxInFlight: 300,
      globalMaxMessagesPerSecond: 120,
      globalMaxToolCallsPerSecond: 220,
      estimatedToolCallsPerMessage: 2,
      ticketTtlMs: 45000,
      retryAfterMs: 1000,
      retryAfterJitterPct: 20,
      allowedEventSamplePct: 5,
    });
    expect(getChatGatewayFlags()).toMatchObject({
      enabled: false,
      shadowMode: true,
      admissionEnforce: false,
      toolQueueEnforce: false,
      providerFailoverEnabled: false,
      failClosedOnRedisError: false,
      healthEndpointEnabled: true,
    });
    expect(getRegionTopologyConfig()).toEqual({
      regionId: "us-east-1",
      topologyMode: "single_region",
      readinessOnly: true,
    });
  });

  test("applies env overrides for knobs", () => {
    process.env.RATE_LIMIT_CHAT_STREAM_MAX = "45";
    process.env.RATE_LIMIT_CHAT_STREAM_WINDOW_MS = "120000";
    process.env.RATE_LIMIT_WA_LINK_CODE_MAX = "7";
    process.env.RATE_LIMIT_WA_LINK_CODE_WINDOW_MS = "180000";
    process.env.TOOL_CACHE_WEB_SEARCH_TTL_MS = "600000";
    process.env.TOOL_CACHE_PRODUCT_SEARCH_TTL_MS = "900000";
    process.env.TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION = "v2";
    process.env.TOOL_CACHE_PRODUCTS_NS_VER = "prod-a";
    process.env.BULKHEAD_TOOL_JOB_MAX = "10";
    process.env.TOOL_JOB_MAX_PER_RUN = "5";
    process.env.TOOL_JOB_WAIT_MS = "12000";
    process.env.TOOL_JOB_CLAIM_SCAN = "350";
    process.env.TOOL_JOB_RUNMAX_WEB = "3";
    process.env.TOOL_JOB_RUNMAX_PROD = "4";
    process.env.TOOL_JOB_RUNMAX_GLOB = "2";
    process.env.TOOL_JOB_QMAX_WEB = "120";
    process.env.TOOL_JOB_QMAX_PROD = "140";
    process.env.TOOL_JOB_QMAX_GLOB = "90";
    process.env.TOOL_JOB_RUNMAX_QOS_REALTIME = "5";
    process.env.TOOL_JOB_RUNMAX_QOS_INTERACTIVE = "6";
    process.env.TOOL_JOB_RUNMAX_QOS_BATCH = "2";
    process.env.TOOL_JOB_DLQ_TTL_MS = "259200000";
    process.env.TOOL_QUEUE_ALERTS_ENABLED = "false";
    process.env.TOOL_QUEUE_ALERT_WINDOW_MIN = "10";
    process.env.TOOL_QUEUE_ALERT_COOLDOWN_MS = "120000";
    process.env.TOOL_QUEUE_ALERT_MAX_QUEUED = "999";
    process.env.TOOL_QUEUE_ALERT_MAX_DLQ = "44";
    process.env.TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS = "90000";
    process.env.TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS = "180000";
    process.env.CIRCUIT_OPENROUTER_THRESHOLD = "9";
    process.env.CIRCUIT_OPENROUTER_COOLDOWN_MS = "300000";
    process.env.CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD = "8";
    process.env.CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS = "180000";
    process.env.CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD = "6";
    process.env.CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS = "90000";
    process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT = "40";
    process.env.BULKHEAD_OPENROUTER_LEASE_TTL_MS = "240000";
    process.env.BULKHEAD_OR_PRI_MAX_CONCURRENT = "50";
    process.env.BULKHEAD_OR_PRI_LEASE_TTL_MS = "300000";
    process.env.BULKHEAD_OR_SEC_MAX_CONCURRENT = "20";
    process.env.BULKHEAD_OR_SEC_LEASE_TTL_MS = "180000";
    process.env.CHAT_PROVIDER_PRIMARY_TIMEOUT_MS = "30000";
    process.env.CHAT_PROVIDER_PRIMARY_RETRIES = "1";
    process.env.CHAT_PROVIDER_SECONDARY_TIMEOUT_MS = "22000";
    process.env.CHAT_PROVIDER_SECONDARY_RETRIES = "2";
    process.env.CHAT_MODEL_FAST_PRIMARY = "google/gemini-2.0-flash-exp:free";
    process.env.CHAT_MODEL_FAST_SECONDARY = "moonshotai/kimi-k2.5";
    process.env.CHAT_MODEL_AGENT_PRIMARY = "openai/gpt-5";
    process.env.CHAT_MODEL_AGENT_SECONDARY = "anthropic/claude-sonnet-4";
    process.env.CHAT_DEFAULT_MODEL_CLASS = "fast";
    process.env.ADMISSION_REDIS_ENABLED = "true";
    process.env.ADMISSION_REDIS_SHADOW_MODE = "false";
    process.env.ADMISSION_REDIS_URL = "https://demo.upstash.io";
    process.env.ADMISSION_REDIS_TOKEN = "token";
    process.env.ADMISSION_REDIS_KEY_PREFIX = "admit:test";
    process.env.ADMISSION_ENFORCE_USER_INFLIGHT = "true";
    process.env.ADMISSION_ENFORCE_GLOBAL_INFLIGHT = "false";
    process.env.ADMISSION_ENFORCE_GLOBAL_MSG_RATE = "true";
    process.env.ADMISSION_ENFORCE_GLOBAL_TOOL_RATE = "false";
    process.env.ADMISSION_GLOBAL_MAX_INFLIGHT = "800";
    process.env.ADMISSION_GLOBAL_MAX_MSG_PER_SEC = "250";
    process.env.ADMISSION_GLOBAL_MAX_TOOL_PER_SEC = "450";
    process.env.ADMISSION_EST_TOOL_CALLS_PER_MSG = "3";
    process.env.ADMISSION_TICKET_TTL_MS = "60000";
    process.env.ADMISSION_RETRY_AFTER_MS = "1500";
    process.env.ADMISSION_RETRY_AFTER_JITTER_PCT = "35";
    process.env.ADMISSION_ALLOWED_EVENT_SAMPLE_PCT = "25";
    process.env.FF_CHAT_GATEWAY_ENABLED = "true";
    process.env.FF_CHAT_GATEWAY_SHADOW = "false";
    process.env.FF_ADMISSION_ENFORCE = "true";
    process.env.FF_TOOL_QUEUE_ENFORCE = "true";
    process.env.FF_PROVIDER_FAILOVER_ENABLED = "true";
    process.env.FF_FAIL_CLOSED_ON_REDIS_ERROR = "true";
    process.env.FF_CHAT_GATEWAY_HEALTH_ENABLED = "false";
    process.env.RELIABILITY_REGION_ID = "us-east-1";
    process.env.RELIABILITY_TOPOLOGY_MODE = "active_standby";
    process.env.RELIABILITY_REGION_READINESS_ONLY = "false";

    expect(getRateLimitConfig().chatStream).toEqual({
      max: 45,
      windowMs: 120000,
    });
    expect(getRateLimitConfig().whatsappLinkingCode).toEqual({
      max: 7,
      windowMs: 180000,
    });
    expect(getToolCacheConfig().webSearchTtlMs).toBe(600000);
    expect(getToolCacheConfig().productSearchTtlMs).toBe(900000);
    expect(getToolCacheNamespaces()).toEqual({
      webSearch: "search_web_v2",
      productSearch: "search_products_prod-a",
    });
    expect(getBulkheadConfig().tool_job_worker.maxConcurrent).toBe(10);
    expect(getToolJobConfig()).toMatchObject({
      maxJobsPerRun: 5,
      waitTimeoutMs: 12000,
      claimScanSize: 350,
      maxRunningByTool: {
        search_web: 3,
        search_products: 4,
        search_global: 2,
      },
      maxQueuedByTool: {
        search_web: 120,
        search_products: 140,
        search_global: 90,
      },
      maxRunningByQos: {
        realtime: 5,
        interactive: 6,
        batch: 2,
      },
      deadLetterRetentionMs: 259200000,
    });
    expect(getToolQueueAlertConfig()).toEqual({
      enabled: false,
      windowMinutes: 10,
      cooldownMs: 120000,
      maxQueuedJobs: 999,
      maxDeadLetterJobs: 44,
      maxOldestQueuedAgeMs: 90000,
      maxOldestRunningAgeMs: 180000,
    });
    expect(getCircuitConfig().openrouter_chat).toEqual({
      threshold: 9,
      cooldownMs: 300000,
    });
    expect(getCircuitConfig().openrouter_chat_primary).toEqual({
      threshold: 8,
      cooldownMs: 180000,
    });
    expect(getCircuitConfig().openrouter_chat_secondary).toEqual({
      threshold: 6,
      cooldownMs: 90000,
    });
    expect(getBulkheadConfig().openrouter_chat).toEqual({
      maxConcurrent: 40,
      leaseTtlMs: 240000,
    });
    expect(getBulkheadConfig().openrouter_chat_primary).toEqual({
      maxConcurrent: 50,
      leaseTtlMs: 300000,
    });
    expect(getBulkheadConfig().openrouter_chat_secondary).toEqual({
      maxConcurrent: 20,
      leaseTtlMs: 180000,
    });
    expect(getChatProviderRouteConfig()).toEqual({
      primaryTimeoutMs: 30000,
      primaryRetries: 1,
      secondaryTimeoutMs: 22000,
      secondaryRetries: 2,
      fastPrimaryModel: "google/gemini-2.0-flash-exp:free",
      fastSecondaryModel: "moonshotai/kimi-k2.5",
      agentPrimaryModel: "openai/gpt-5",
      agentSecondaryModel: "anthropic/claude-sonnet-4",
      defaultModelClass: "fast",
    });
    expect(getAdmissionControlConfig()).toMatchObject({
      enabled: true,
      shadowMode: false,
      redisUrl: "https://demo.upstash.io",
      redisToken: "token",
      keyPrefix: "admit:test",
      enforceUserInFlight: true,
      enforceGlobalInFlight: false,
      enforceGlobalMessageRate: true,
      enforceGlobalToolRate: false,
      globalMaxInFlight: 800,
      globalMaxMessagesPerSecond: 250,
      globalMaxToolCallsPerSecond: 450,
      estimatedToolCallsPerMessage: 3,
      ticketTtlMs: 60000,
      retryAfterMs: 1500,
      retryAfterJitterPct: 35,
      allowedEventSamplePct: 25,
    });
    expect(getChatGatewayFlags()).toMatchObject({
      enabled: true,
      shadowMode: false,
      admissionEnforce: true,
      toolQueueEnforce: true,
      providerFailoverEnabled: true,
      failClosedOnRedisError: true,
      healthEndpointEnabled: false,
    });
    expect(getRegionTopologyConfig()).toEqual({
      regionId: "us-east-1",
      topologyMode: "active_standby",
      readinessOnly: false,
    });
  });

  test("falls back on invalid env values", () => {
    process.env.RATE_LIMIT_CHAT_STREAM_MAX = "-1";
    process.env.RATE_LIMIT_WA_LINK_CODE_MAX = "100000";
    process.env.TOOL_CACHE_WEB_SEARCH_TTL_MS = "-1000";
    process.env.TOOL_CACHE_PRODUCT_SEARCH_TTL_MS = "9999999999";
    process.env.TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION = "..//";
    process.env.TOOL_CACHE_PRODUCTS_NS_VER = "";
    process.env.BULKHEAD_TOOL_JOB_MAX = "-2";
    process.env.TOOL_JOB_MAX_PER_RUN = "999";
    process.env.TOOL_JOB_CLAIM_SCAN = "500000";
    process.env.TOOL_JOB_RUNMAX_WEB = "0";
    process.env.TOOL_JOB_RUNMAX_PROD = "abc";
    process.env.TOOL_JOB_RUNMAX_GLOB = "-5";
    process.env.TOOL_JOB_QMAX_WEB = "-9";
    process.env.TOOL_JOB_QMAX_PROD = "x";
    process.env.TOOL_JOB_QMAX_GLOB = "200000";
    process.env.TOOL_JOB_RUNMAX_QOS_REALTIME = "x";
    process.env.TOOL_JOB_RUNMAX_QOS_INTERACTIVE = "0";
    process.env.TOOL_JOB_RUNMAX_QOS_BATCH = "-9";
    process.env.TOOL_JOB_DLQ_TTL_MS = "0";
    process.env.TOOL_QUEUE_ALERTS_ENABLED = "yolo";
    process.env.TOOL_QUEUE_ALERT_WINDOW_MIN = "0";
    process.env.TOOL_QUEUE_ALERT_COOLDOWN_MS = "2";
    process.env.TOOL_QUEUE_ALERT_MAX_QUEUED = "0";
    process.env.TOOL_QUEUE_ALERT_MAX_DLQ = "-1";
    process.env.TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS = "999999999999";
    process.env.TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS = "-1";
    process.env.CIRCUIT_OPENROUTER_THRESHOLD = "NaN";
    process.env.CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD = "wat";
    process.env.CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS = "-1";
    process.env.CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD = "0";
    process.env.CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS = "99999999999";
    process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT = "100000";
    process.env.BULKHEAD_OR_PRI_MAX_CONCURRENT = "x";
    process.env.BULKHEAD_OR_PRI_LEASE_TTL_MS = "-1";
    process.env.BULKHEAD_OR_SEC_MAX_CONCURRENT = "0";
    process.env.BULKHEAD_OR_SEC_LEASE_TTL_MS = "99999999999";
    process.env.CHAT_PROVIDER_PRIMARY_TIMEOUT_MS = "0";
    process.env.CHAT_PROVIDER_PRIMARY_RETRIES = "99";
    process.env.CHAT_PROVIDER_SECONDARY_TIMEOUT_MS = "-10";
    process.env.CHAT_PROVIDER_SECONDARY_RETRIES = "-1";
    process.env.CHAT_MODEL_FAST_PRIMARY = " ";
    process.env.CHAT_MODEL_FAST_SECONDARY = "..";
    process.env.CHAT_MODEL_AGENT_PRIMARY = "bad model id with spaces";
    process.env.CHAT_MODEL_AGENT_SECONDARY = "###";
    process.env.CHAT_DEFAULT_MODEL_CLASS = "balanced";
    process.env.ADMISSION_REDIS_ENABLED = "not-bool";
    process.env.ADMISSION_REDIS_SHADOW_MODE = "wat";
    process.env.ADMISSION_REDIS_KEY_PREFIX = "bad prefix with spaces";
    process.env.ADMISSION_ENFORCE_USER_INFLIGHT = "wat";
    process.env.ADMISSION_ENFORCE_GLOBAL_INFLIGHT = "ye";
    process.env.ADMISSION_ENFORCE_GLOBAL_MSG_RATE = "nah";
    process.env.ADMISSION_ENFORCE_GLOBAL_TOOL_RATE = "2";
    process.env.ADMISSION_GLOBAL_MAX_INFLIGHT = "-10";
    process.env.ADMISSION_GLOBAL_MAX_MSG_PER_SEC = "abc";
    process.env.ADMISSION_GLOBAL_MAX_TOOL_PER_SEC = "0";
    process.env.ADMISSION_EST_TOOL_CALLS_PER_MSG = "999";
    process.env.ADMISSION_TICKET_TTL_MS = "0";
    process.env.ADMISSION_RETRY_AFTER_MS = "-20";
    process.env.ADMISSION_RETRY_AFTER_JITTER_PCT = "999";
    process.env.ADMISSION_ALLOWED_EVENT_SAMPLE_PCT = "-1";
    process.env.FF_CHAT_GATEWAY_ENABLED = "wat";
    process.env.FF_CHAT_GATEWAY_SHADOW = "wat";
    process.env.FF_ADMISSION_ENFORCE = "???";
    process.env.FF_TOOL_QUEUE_ENFORCE = " ";
    process.env.FF_PROVIDER_FAILOVER_ENABLED = "2";
    process.env.FF_FAIL_CLOSED_ON_REDIS_ERROR = "FALSE";
    process.env.FF_CHAT_GATEWAY_HEALTH_ENABLED = "3";
    process.env.RELIABILITY_REGION_ID = "!!!";
    process.env.RELIABILITY_TOPOLOGY_MODE = "multi";
    process.env.RELIABILITY_REGION_READINESS_ONLY = "yolo";

    expect(getRateLimitConfig().chatStream.max).toBe(30);
    expect(getRateLimitConfig().whatsappLinkingCode.max).toBe(5);
    expect(getToolCacheConfig().webSearchTtlMs).toBe(300000);
    expect(getToolCacheConfig().productSearchTtlMs).toBe(600000);
    expect(getToolCacheNamespaces()).toEqual({
      webSearch: "search_web_v1",
      productSearch: "search_products_v1",
    });
    expect(getBulkheadConfig().tool_job_worker.maxConcurrent).toBe(6);
    expect(getToolJobConfig().maxJobsPerRun).toBe(3);
    expect(getToolJobConfig().claimScanSize).toBe(200);
    expect(getToolJobConfig().maxRunningByTool.search_web).toBe(2);
    expect(getToolJobConfig().maxQueuedByTool.search_global).toBe(40);
    expect(getToolJobConfig().maxRunningByQos).toEqual({
      realtime: 2,
      interactive: 2,
      batch: 1,
    });
    expect(getToolJobConfig().deadLetterRetentionMs).toBe(604800000);
    expect(getToolQueueAlertConfig()).toEqual({
      enabled: true,
      windowMinutes: 5,
      cooldownMs: 900000,
      maxQueuedJobs: 200,
      maxDeadLetterJobs: 20,
      maxOldestQueuedAgeMs: 60000,
      maxOldestRunningAgeMs: 300000,
    });
    expect(getCircuitConfig().openrouter_chat.threshold).toBe(5);
    expect(getCircuitConfig().openrouter_chat_primary.threshold).toBe(5);
    expect(getCircuitConfig().openrouter_chat_secondary.threshold).toBe(4);
    expect(getBulkheadConfig().openrouter_chat.maxConcurrent).toBe(24);
    expect(getBulkheadConfig().openrouter_chat_primary.maxConcurrent).toBe(24);
    expect(getBulkheadConfig().openrouter_chat_secondary.maxConcurrent).toBe(16);
    expect(getChatProviderRouteConfig()).toEqual({
      primaryTimeoutMs: 45000,
      primaryRetries: 0,
      secondaryTimeoutMs: 35000,
      secondaryRetries: 0,
      fastPrimaryModel: "moonshotai/kimi-k2.5",
      fastSecondaryModel: "google/gemini-2.0-flash-exp:free",
      agentPrimaryModel: "openai/gpt-5",
      agentSecondaryModel: "moonshotai/kimi-k2.5",
      defaultModelClass: "agent",
    });
    expect(getAdmissionControlConfig()).toMatchObject({
      enabled: false,
      shadowMode: true,
      keyPrefix: "admit:chat",
      enforceUserInFlight: true,
      enforceGlobalInFlight: true,
      enforceGlobalMessageRate: true,
      enforceGlobalToolRate: true,
      globalMaxInFlight: 300,
      globalMaxMessagesPerSecond: 120,
      globalMaxToolCallsPerSecond: 220,
      estimatedToolCallsPerMessage: 2,
      ticketTtlMs: 45000,
      retryAfterMs: 1000,
      retryAfterJitterPct: 20,
      allowedEventSamplePct: 5,
    });
    expect(getChatGatewayFlags()).toMatchObject({
      enabled: false,
      shadowMode: true,
      admissionEnforce: false,
      toolQueueEnforce: false,
      providerFailoverEnabled: false,
      failClosedOnRedisError: false,
      healthEndpointEnabled: true,
    });
    expect(getRegionTopologyConfig()).toEqual({
      regionId: "us-east-1",
      topologyMode: "single_region",
      readinessOnly: true,
    });
  });

  test("accepts explicit falsy gateway shadow override", () => {
    process.env.FF_CHAT_GATEWAY_SHADOW = "no";
    expect(getChatGatewayFlags().shadowMode).toBe(false);
  });
});
