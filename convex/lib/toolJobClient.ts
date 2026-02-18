import { internal } from "../_generated/api";
import { getToolJobConfig } from "./reliabilityConfig";

type QueueSource = "chat_action" | "chat_http";

type ToolJobClientResult<T = any> =
  | { status: "completed"; result: T }
  | { status: "failed"; error: string }
  | { status: "timeout" };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

export async function enqueueToolJobAndWait<T = any>(
  ctx: any,
  input: {
    source: QueueSource;
    toolName: "search_web" | "search_products" | "search_global";
    args: unknown;
    waitTimeoutMs?: number;
  },
): Promise<ToolJobClientResult<T>> {
  const config = getToolJobConfig();
  const waitTimeoutMs = clampInt(
    input.waitTimeoutMs ?? config.waitTimeoutMs,
    500,
    120_000,
  );
  const pollMs = clampInt(config.pollIntervalMs, 50, 5000);
  const argsJson = JSON.stringify(input.args ?? {});

  let jobId: any;
  try {
    jobId = await ctx.runMutation(internal.toolJobs.enqueue, {
      source: input.source,
      toolName: input.toolName,
      argsJson,
      maxAttempts: config.maxAttempts,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    if (message.includes("[queue_saturated:")) {
      return {
        status: "failed",
        error: "Tool queue is temporarily saturated. Please retry in a moment.",
      };
    }
    return {
      status: "failed",
      error: message,
    };
  }

  try {
    await ctx.scheduler.runAfter(0, internal.toolJobs.processQueue, {
      maxJobs: config.maxJobsPerRun,
    });
  } catch {
    // If scheduling fails, the caller polling will eventually timeout/fail.
  }

  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    const job = await ctx.runQuery(internal.toolJobs.get, { jobId });
    if (!job) {
      return { status: "failed", error: "Tool job missing" };
    }

    if (job.status === "completed") {
      if (!job.resultJson) {
        return { status: "failed", error: "Tool job completed without result" };
      }
      try {
        return {
          status: "completed",
          result: JSON.parse(job.resultJson) as T,
        };
      } catch (error) {
        return {
          status: "failed",
          error: "Tool job result parse failed",
        };
      }
    }

    if (job.status === "failed") {
      return {
        status: "failed",
        error: job.lastError ?? "Tool job failed",
      };
    }

    await delay(pollMs);
  }

  return { status: "timeout" };
}
