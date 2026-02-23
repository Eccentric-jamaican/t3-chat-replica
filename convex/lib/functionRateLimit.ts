import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { buildRateLimitErrorMessage, isRateLimitContentionError } from "./rateLimit";
import { throwFunctionError } from "./functionErrors";

type RateLimitContext = Pick<MutationCtx, "runMutation">;

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
