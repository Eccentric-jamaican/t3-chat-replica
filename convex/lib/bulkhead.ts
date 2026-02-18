import { internal } from "../_generated/api";
import {
  getBulkheadConfig,
  getBulkheadSentryCooldownMs,
} from "./reliabilityConfig";

export type BulkheadProvider =
  | "openrouter_chat"
  | "serper_search"
  | "gmail_oauth"
  | "tool_job_worker";

export class BulkheadSaturatedError extends Error {
  provider: BulkheadProvider;
  retryAfterMs: number;
  inFlight: number;
  maxConcurrent: number;

  constructor(input: {
    provider: BulkheadProvider;
    retryAfterMs: number;
    inFlight: number;
    maxConcurrent: number;
  }) {
    const retryAfterSeconds = Math.max(Math.ceil(input.retryAfterMs / 1000), 1);
    super(
      `Provider concurrency limit reached (${input.provider}). Retry in about ${retryAfterSeconds}s.`,
    );
    this.name = "BulkheadSaturatedError";
    this.provider = input.provider;
    this.retryAfterMs = input.retryAfterMs;
    this.inFlight = input.inFlight;
    this.maxConcurrent = input.maxConcurrent;
  }
}

const lastSentryAtByProvider = new Map<string, number>();

function createLeaseId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `lease_${Math.random().toString(16).slice(2)}_${Date.now()}`;
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

async function sendSentryBulkheadEvent(input: {
  dsn: string;
  provider: BulkheadProvider;
  inFlight: number;
  maxConcurrent: number;
}) {
  const parsed = parseSentryDsn(input.dsn);
  if (!parsed) return false;

  const eventId = randomHex(32);
  const timestamp = new Date().toISOString();
  const payload = {
    event_id: eventId,
    message: `Bulkhead saturation: ${input.provider}`,
    level: "warning",
    platform: "javascript",
    timestamp,
    logger: "convex.bulkhead",
    tags: {
      feature: "bulkhead",
      provider: input.provider,
    },
    extra: {
      inFlight: input.inFlight,
      maxConcurrent: input.maxConcurrent,
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

async function maybeSendBulkheadSentryEvent(input: {
  provider: BulkheadProvider;
  inFlight: number;
  maxConcurrent: number;
}) {
  const dsn = process.env.SENTRY_DSN || process.env.RATE_LIMIT_SENTRY_DSN;
  if (!dsn) return;

  const now = Date.now();
  const lastSent = lastSentryAtByProvider.get(input.provider) ?? 0;
  if (now - lastSent < getBulkheadSentryCooldownMs()) return;

  try {
    const sent = await sendSentryBulkheadEvent({
      dsn,
      provider: input.provider,
      inFlight: input.inFlight,
      maxConcurrent: input.maxConcurrent,
    });
    if (sent) {
      lastSentryAtByProvider.set(input.provider, now);
    }
  } catch (error) {
    console.error("[Bulkhead] Failed to send Sentry event", error);
  }
}

export async function acquireBulkheadSlot(
  ctx: any,
  provider: BulkheadProvider,
): Promise<string | null> {
  const leaseId = createLeaseId();
  const config = getBulkheadConfig()[provider];

  try {
    const result = await ctx.runMutation(internal.bulkhead.acquireSlot, {
      provider,
      leaseId,
      maxConcurrent: config.maxConcurrent,
      leaseTtlMs: config.leaseTtlMs,
    });

    if (!result.acquired) {
      await maybeSendBulkheadSentryEvent({
        provider,
        inFlight: result.inFlight,
        maxConcurrent: config.maxConcurrent,
      });
      throw new BulkheadSaturatedError({
        provider,
        retryAfterMs: result.retryAfterMs ?? 1_000,
        inFlight: result.inFlight ?? config.maxConcurrent,
        maxConcurrent: config.maxConcurrent,
      });
    }

    return leaseId;
  } catch (error) {
    if (error instanceof BulkheadSaturatedError) {
      throw error;
    }
    // Fail open if tracking infrastructure has an issue.
    console.error("[Bulkhead] acquireSlot failed; continuing fail-open", {
      provider,
      error,
    });
    return null;
  }
}

export async function releaseBulkheadSlot(
  ctx: any,
  provider: BulkheadProvider,
  leaseId: string | null | undefined,
) {
  if (!leaseId) return;
  try {
    await ctx.runMutation(internal.bulkhead.releaseSlot, {
      provider,
      leaseId,
    });
  } catch (error) {
    console.error("[Bulkhead] releaseSlot failed", { provider, error });
  }
}

export function isBulkheadSaturatedError(error: unknown) {
  return error instanceof BulkheadSaturatedError;
}
