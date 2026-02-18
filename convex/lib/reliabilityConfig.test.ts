import { afterEach, describe, expect, test } from "vitest";
import {
  getBulkheadConfig,
  getCircuitConfig,
  getRateLimitConfig,
  getToolCacheConfig,
  getToolCacheNamespaces,
  getToolJobConfig,
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
    delete process.env.CIRCUIT_OPENROUTER_THRESHOLD;
    delete process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT;

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
    expect(getCircuitConfig().openrouter_chat.threshold).toBe(5);
    expect(getBulkheadConfig().openrouter_chat.maxConcurrent).toBe(24);
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
    process.env.CIRCUIT_OPENROUTER_THRESHOLD = "9";
    process.env.CIRCUIT_OPENROUTER_COOLDOWN_MS = "300000";
    process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT = "40";
    process.env.BULKHEAD_OPENROUTER_LEASE_TTL_MS = "240000";

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
    });
    expect(getCircuitConfig().openrouter_chat).toEqual({
      threshold: 9,
      cooldownMs: 300000,
    });
    expect(getBulkheadConfig().openrouter_chat).toEqual({
      maxConcurrent: 40,
      leaseTtlMs: 240000,
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
    process.env.CIRCUIT_OPENROUTER_THRESHOLD = "NaN";
    process.env.BULKHEAD_OPENROUTER_MAX_CONCURRENT = "100000";

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
    expect(getCircuitConfig().openrouter_chat.threshold).toBe(5);
    expect(getBulkheadConfig().openrouter_chat.maxConcurrent).toBe(24);
  });
});
