import { internal } from "../_generated/api";
import { buildRateLimitErrorMessage, isRateLimitContentionError } from "./rateLimit";
import { throwFunctionError } from "./functionErrors";

type RateLimitContext = {
  runMutation: (
    mutation: unknown,
    args: { key: string; max: number; windowMs: number },
  ) => Promise<{ allowed: boolean; retryAfterMs: number }>;
};

export async function enforceFunctionRateLimit(
  ctx: RateLimitContext,
  args: {
    functionName: string;
    key: string;
    max: number;
    windowMs: number;
  },
) {
  let limit;
  try {
    limit = await ctx.runMutation(internal.rateLimit.checkAndIncrement, {
      key: args.key,
      max: args.max,
      windowMs: args.windowMs,
    });
  } catch (error) {
    if (isRateLimitContentionError(error)) {
      throwFunctionError(
        "rate_limited",
        args.functionName,
        "Too many requests. Please retry in a moment.",
      );
    }
    throw error;
  }

  if (!limit.allowed) {
    throwFunctionError(
      "rate_limited",
      args.functionName,
      buildRateLimitErrorMessage(limit.retryAfterMs),
    );
  }
}
