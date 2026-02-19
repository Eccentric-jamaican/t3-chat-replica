import { describe, expect, test } from "vitest";
import {
  checkAndAcquireAdmission,
  resolveAdmissionRetryAfterMs,
  releaseAdmission,
  type AdmissionCheckResult,
} from "./admissionControl";
import type { AdmissionControlConfig } from "./reliabilityConfig";

class FakeRedis {
  private values = new Map<string, number | string>();

  async get(key: string) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string) {
    const existed = this.values.delete(key);
    return existed ? 1 : 0;
  }

  async incr(key: string) {
    const next = this.toNumber(this.values.get(key)) + 1;
    this.values.set(key, next);
    return next;
  }

  async incrby(key: string, by: number) {
    const next = this.toNumber(this.values.get(key)) + by;
    this.values.set(key, next);
    return next;
  }

  async decr(key: string) {
    const next = this.toNumber(this.values.get(key)) - 1;
    this.values.set(key, next);
    return next;
  }

  async decrby(key: string, by: number) {
    const next = this.toNumber(this.values.get(key)) - by;
    this.values.set(key, next);
    return next;
  }

  async expire(_key: string, _seconds: number) {
    return 1;
  }

  private toNumber(value: unknown) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

function createConfig(overrides?: Partial<AdmissionControlConfig>) {
  return {
    enabled: true,
    shadowMode: false,
    redisUrl: "https://redis.example.com",
    redisToken: "token",
    keyPrefix: "admit:test",
    enforceUserInFlight: true,
    enforceGlobalInFlight: true,
    enforceGlobalMessageRate: true,
    enforceGlobalToolRate: true,
    userMaxInFlight: 1,
    globalMaxInFlight: 5,
    globalMaxMessagesPerSecond: 10,
    globalMaxToolCallsPerSecond: 20,
    estimatedToolCallsPerMessage: 2,
    ticketTtlMs: 45_000,
    retryAfterMs: 1_000,
    retryAfterJitterPct: 20,
    allowedEventSamplePct: 5,
    ...overrides,
  } satisfies AdmissionControlConfig;
}

function assertEnforceSuccess(result: AdmissionCheckResult) {
  expect(result.mode).toBe("enforce");
  expect(result.allowed).toBe(true);
  if (result.mode !== "enforce" || !result.allowed) {
    throw new Error("Expected enforce success result");
  }
  return result.ticket;
}

describe("admissionControl", () => {
  test("acquires and releases admission ticket idempotently", async () => {
    const redis = new FakeRedis();
    const config = createConfig();

    const result = await checkAndAcquireAdmission({
      principalKey: "user:1",
      mode: "enforce",
      config,
      redis: redis as any,
    });

    const ticket = assertEnforceSuccess(result);
    await releaseAdmission({ ticket, config, redis: redis as any });
    await releaseAdmission({ ticket, config, redis: redis as any });

    const global = await redis.get("admit:test:inflight:global");
    const user = await redis.get("admit:test:inflight:user:user%3A1");
    expect(Number(global)).toBe(0);
    expect(Number(user)).toBe(0);
  });

  test("blocks second in-flight request for same principal", async () => {
    const redis = new FakeRedis();
    const config = createConfig({ userMaxInFlight: 1 });

    const first = await checkAndAcquireAdmission({
      principalKey: "user:abc",
      mode: "enforce",
      config,
      redis: redis as any,
    });
    const firstTicket = assertEnforceSuccess(first);

    const second = await checkAndAcquireAdmission({
      principalKey: "user:abc",
      mode: "enforce",
      config,
      redis: redis as any,
    });

    expect(second).toMatchObject({
      mode: "enforce",
      allowed: false,
      reason: "user_inflight",
    });

    await releaseAdmission({ ticket: firstTicket, config, redis: redis as any });
  });

  test("blocks message rate when per-second cap is exceeded", async () => {
    const redis = new FakeRedis();
    const config = createConfig({ globalMaxMessagesPerSecond: 1 });

    const first = await checkAndAcquireAdmission({
      principalKey: "user:1",
      mode: "enforce",
      config,
      redis: redis as any,
      nowMs: 1000,
    });
    const firstTicket = assertEnforceSuccess(first);

    const second = await checkAndAcquireAdmission({
      principalKey: "user:2",
      mode: "enforce",
      config,
      redis: redis as any,
      nowMs: 1000,
    });

    expect(second).toMatchObject({
      mode: "enforce",
      allowed: false,
      reason: "global_msg_rate",
    });
    if (second.mode === "enforce" && !second.allowed) {
      expect(second.retryAfterMs).toBeGreaterThanOrEqual(800);
      expect(second.retryAfterMs).toBeLessThanOrEqual(1200);
    }

    await releaseAdmission({ ticket: firstTicket, config, redis: redis as any });
  });

  test("shadow mode reports would-block without mutating counters", async () => {
    const redis = new FakeRedis();
    const config = createConfig({ globalMaxInFlight: 1 });

    const first = await checkAndAcquireAdmission({
      principalKey: "user:1",
      mode: "enforce",
      config,
      redis: redis as any,
    });
    const firstTicket = assertEnforceSuccess(first);

    const shadow = await checkAndAcquireAdmission({
      principalKey: "user:2",
      mode: "shadow",
      config,
      redis: redis as any,
    });

    expect(shadow).toMatchObject({
      mode: "shadow",
      allowed: true,
      wouldBlock: true,
      reason: "global_inflight",
    });
    if (shadow.mode === "shadow") {
      expect(shadow.wouldBlockReasons).toContain("global_inflight");
    }

    await releaseAdmission({ ticket: firstTicket, config, redis: redis as any });
  });

  test("enforce mode fails closed when redis credentials are missing", async () => {
    const result = await checkAndAcquireAdmission({
      principalKey: "user:1",
      mode: "enforce",
      config: createConfig({ redisUrl: "", redisToken: "" }),
      redis: null,
    });

    expect(result).toMatchObject({
      mode: "enforce",
      allowed: false,
      reason: "redis_unavailable",
    });
  });

  test("skips blocking for disabled enforce dimensions while tracking soft-block reasons", async () => {
    const redis = new FakeRedis();
    const config = createConfig({
      globalMaxMessagesPerSecond: 1,
      enforceGlobalMessageRate: false,
    });

    const first = await checkAndAcquireAdmission({
      principalKey: "user:1",
      mode: "enforce",
      config,
      redis: redis as any,
      nowMs: 1000,
      randomFn: () => 0.5,
    });
    const firstTicket = assertEnforceSuccess(first);

    const second = await checkAndAcquireAdmission({
      principalKey: "user:2",
      mode: "enforce",
      config,
      redis: redis as any,
      nowMs: 1000,
      randomFn: () => 0.5,
    });

    expect(second.mode).toBe("enforce");
    expect(second.allowed).toBe(true);
    if (second.mode === "enforce" && second.allowed) {
      expect(second.softBlockedReasons).toContain("global_msg_rate");
      await releaseAdmission({ ticket: second.ticket, config, redis: redis as any });
    }

    await releaseAdmission({ ticket: firstTicket, config, redis: redis as any });
  });

  test("uses jittered retry-after value", () => {
    const config = createConfig({ retryAfterMs: 1000, retryAfterJitterPct: 20 });
    expect(resolveAdmissionRetryAfterMs(config, () => 0)).toBe(800);
    expect(resolveAdmissionRetryAfterMs(config, () => 0.5)).toBe(1000);
    expect(resolveAdmissionRetryAfterMs(config, () => 1)).toBe(1200);
  });
});
