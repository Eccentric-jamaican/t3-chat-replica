import { getRateLimitConfig } from "./reliabilityConfig";

export function getRateLimits() {
  return getRateLimitConfig();
}

export function buildRateLimitErrorMessage(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
  return `Rate limit reached. Please wait about ${retryAfterSeconds}s and try again.`;
}

export function buildRetryAfterSeconds(retryAfterMs: number) {
  return String(Math.max(Math.ceil(retryAfterMs / 1000), 1));
}

export function isRateLimitContentionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("rateLimitWindows") &&
    message.includes("changed while this mutation was being run")
  );
}
