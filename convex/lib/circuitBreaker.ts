import { internal } from "../_generated/api";
import { getCircuitConfig } from "./reliabilityConfig";

export type CircuitProvider =
  | "openrouter_chat_primary"
  | "openrouter_chat_secondary"
  | "openrouter_chat"
  | "serper_search"
  | "gmail_oauth"
  | "ebay_search"
  | "global_search";

export class CircuitOpenError extends Error {
  provider: CircuitProvider;
  retryAfterMs: number;

  constructor(provider: CircuitProvider, retryAfterMs: number) {
    const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
    super(
      `Upstream provider temporarily unavailable (${provider}). Retry in about ${retryAfterSeconds}s.`,
    );
    this.name = "CircuitOpenError";
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

export function classifyResponseStatus(status: number) {
  if (status >= 200 && status < 400) return "success" as const;
  if (status === 429) return "neutral" as const;
  if (status === 408 || status === 425 || status >= 500) {
    return "failure" as const;
  }
  return "neutral" as const;
}

function errorToString(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown error");
}

export async function assertCircuitClosed(ctx: any, provider: CircuitProvider) {
  const gate = await ctx.runMutation(internal.circuitBreaker.checkGate, {
    provider,
  });
  if (!gate.allowed) {
    throw new CircuitOpenError(provider, gate.retryAfterMs ?? 1_000);
  }
}

export async function recordCircuitResponse(
  ctx: any,
  provider: CircuitProvider,
  status: number,
) {
  const outcome = classifyResponseStatus(status);
  if (outcome === "neutral") return;

  try {
    if (outcome === "success") {
      await ctx.runMutation(internal.circuitBreaker.recordSuccess, {
        provider,
      });
      return;
    }

    const config = getCircuitConfig()[provider];
    await ctx.runMutation(internal.circuitBreaker.recordFailure, {
      provider,
      threshold: config.threshold,
      cooldownMs: config.cooldownMs,
      error: `HTTP ${status}`,
    });
  } catch (error) {
    console.error("[CircuitBreaker] Failed to record response", {
      provider,
      status,
      error: errorToString(error),
    });
  }
}

export async function recordCircuitError(
  ctx: any,
  provider: CircuitProvider,
  error: unknown,
) {
  if (error instanceof CircuitOpenError) return;
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "BulkheadSaturatedError"
  ) {
    return;
  }

  try {
    const config = getCircuitConfig()[provider];
    await ctx.runMutation(internal.circuitBreaker.recordFailure, {
      provider,
      threshold: config.threshold,
      cooldownMs: config.cooldownMs,
      error: errorToString(error),
    });
  } catch (recordError) {
    console.error("[CircuitBreaker] Failed to record error", {
      provider,
      error: errorToString(recordError),
    });
  }
}
