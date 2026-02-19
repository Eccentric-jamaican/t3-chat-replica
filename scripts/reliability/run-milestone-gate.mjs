#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "./parseArgs.mjs";

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractReportPath(output) {
  const line = output
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("Report: "));
  if (!line) return null;
  return line.slice("Report: ".length).trim();
}

function extractJson(text) {
  const end = text.lastIndexOf("}");
  if (end === -1) {
    throw new Error(
      "Unable to find JSON payload terminator in command output.",
    );
  }
  for (
    let start = text.lastIndexOf("{", end);
    start >= 0;
    start = text.lastIndexOf("{", start - 1)
  ) {
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning for the outermost valid JSON object in the output.
    }
  }
  throw new Error("Unable to parse JSON payload from command output.");
}

function statusRate(statuses, predicate) {
  const entries = Object.entries(statuses || {}).map(([status, count]) => ({
    status: Number(status),
    count: Number(count),
  }));
  const total = Math.max(
    1,
    entries.reduce((sum, item) => sum + item.count, 0),
  );
  const matched = entries
    .filter((item) => predicate(item.status))
    .reduce((sum, item) => sum + item.count, 0);
  return matched / total;
}

function evaluateChatScenario(scenario, milestonePolicy) {
  const summary = scenario.summary || {};
  const statuses = summary.statuses || {};
  const total = Math.max(Number(summary.totalRequests || 0), 1);
  const twoXxRate = statusRate(statuses, (status) => status >= 200 && status < 300);
  const fiveXxRate = statusRate(statuses, (status) => status >= 500 && status < 600);
  const rate429 = statusRate(statuses, (status) => status === 429);
  const networkErrorCount = Object.values(summary.errors || {}).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  const networkErrorRate = networkErrorCount / total;
  const allowedStatuses = new Set([200, 401, 429, 503]);
  const unknownStatusRate = statusRate(
    statuses,
    (status) => !allowedStatuses.has(status),
  );
  const p95CompletionMs = Number(summary.latency?.p95Ms || 0);
  const p95FirstTokenMs = Number(summary.latency?.firstTokenP95Ms || 0);
  const uniqueCoverage = Number(summary.chatPool?.uniqueCoverage ?? 0);
  const uniqueUsers = Number(summary.chatPool?.uniqueUsed ?? 0);
  const poolSize = Number(summary.chatPool?.size ?? 0);

  const checks = [
    {
      name: "2xx_success_rate",
      pass: twoXxRate >= milestonePolicy.slo.minTwoXxRate,
      actual: Number(twoXxRate.toFixed(4)),
      threshold: milestonePolicy.slo.minTwoXxRate,
    },
    {
      name: "5xx_rate",
      pass: fiveXxRate <= milestonePolicy.slo.maxFiveXxRate,
      actual: Number(fiveXxRate.toFixed(4)),
      threshold: milestonePolicy.slo.maxFiveXxRate,
    },
    {
      name: "429_rate",
      pass: rate429 <= milestonePolicy.slo.max429Rate,
      actual: Number(rate429.toFixed(4)),
      threshold: milestonePolicy.slo.max429Rate,
    },
    {
      name: "p95_completion_latency",
      pass: p95CompletionMs <= milestonePolicy.slo.maxP95CompletionMs,
      actual: p95CompletionMs,
      threshold: milestonePolicy.slo.maxP95CompletionMs,
    },
    {
      name: "p95_first_token_latency",
      pass: p95FirstTokenMs <= milestonePolicy.slo.maxP95FirstTokenMs,
      actual: p95FirstTokenMs,
      threshold: milestonePolicy.slo.maxP95FirstTokenMs,
    },
    {
      name: "network_error_rate",
      pass: networkErrorRate <= milestonePolicy.slo.maxNetworkErrorRate,
      actual: Number(networkErrorRate.toFixed(4)),
      threshold: milestonePolicy.slo.maxNetworkErrorRate,
    },
    {
      name: "unknown_status_rate",
      pass: unknownStatusRate <= milestonePolicy.slo.maxUnknownStatusRate,
      actual: Number(unknownStatusRate.toFixed(4)),
      threshold: milestonePolicy.slo.maxUnknownStatusRate,
    },
    {
      name: "chat_auth_pool_size",
      pass: poolSize >= milestonePolicy.pool.minAuthPoolSize,
      actual: poolSize,
      threshold: milestonePolicy.pool.minAuthPoolSize,
    },
    {
      name: "chat_pool_unique_coverage",
      pass: uniqueCoverage >= milestonePolicy.pool.minUniqueCoverage,
      actual: Number(uniqueCoverage.toFixed(4)),
      threshold: milestonePolicy.pool.minUniqueCoverage,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
    summary: {
      totalRequests: Number(summary.totalRequests || 0),
      uniqueUsers,
      uniqueCoverage: Number(uniqueCoverage.toFixed(4)),
      poolSize,
    },
  };
}

function evaluateSnapshot(snapshot, milestonePolicy, snapshotWindowMinutes) {
  const now = Number(snapshot?.generatedAt || Date.now());
  const sustainedMs = Number(
    milestonePolicy.snapshot.maxSustainedOpenCircuitMs || 120000,
  );
  const windowMs = Math.max(Number(snapshotWindowMinutes || 30), 1) * 60_000;
  const cutoff = now - windowMs;
  const openCircuits = (snapshot?.circuitBreakers?.recent || []).filter(
    (item) => {
      if (item?.state !== "open") return false;
      if (typeof item?.provider !== "string") return false;
      if (item.provider.startsWith("phase_")) return false;
      const updatedAt = Number(item?.updatedAt || 0);
      if (updatedAt < cutoff) return false;
      return now - updatedAt >= sustainedMs;
    },
  );

  const oldestQueuedAgeMs = Number(snapshot?.toolJobs?.oldestQueuedAgeMs || 0);
  const oldestRunningAgeMs = Number(
    snapshot?.toolJobs?.oldestRunningAgeMs || 0,
  );
  const checks = [
    {
      name: "sustained_open_circuits",
      pass: openCircuits.length === 0,
      actual: openCircuits.length,
      threshold: 0,
    },
    {
      name: "oldest_queued_job_age",
      pass: oldestQueuedAgeMs <= milestonePolicy.snapshot.maxOldestQueuedAgeMs,
      actual: oldestQueuedAgeMs,
      threshold: milestonePolicy.snapshot.maxOldestQueuedAgeMs,
    },
    {
      name: "oldest_running_job_age",
      pass:
        oldestRunningAgeMs <= milestonePolicy.snapshot.maxOldestRunningAgeMs,
      actual: oldestRunningAgeMs,
      threshold: milestonePolicy.snapshot.maxOldestRunningAgeMs,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
    openCircuits,
  };
}

async function runCommand(command, args, options = {}) {
  const tee = options.tee !== false;
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (tee) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (tee) process.stderr.write(text);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function buildDrillArgs({ milestone, milestonePolicy, baseUrl, args }) {
  const drillArgs = [
    "scripts/reliability/run-load-drills.mjs",
    `--profile=${milestonePolicy.profile}`,
    "--scenarios=chat_stream_http",
    `--base-url=${baseUrl}`,
  ];
  const passThrough = [
    "chat-auth-pool-file",
    "chat-auth-pool-json",
    "auth-token",
    "thread-id",
    "chat-load-scale",
    "chat-concurrency-scale",
    "chat-duration-scale",
    "chat-rotation-mode",
    "chat-rotation-stride",
    "chat-rotation-seed",
    "chat-min-unique-coverage",
    "chat-min-unique-users",
  ];
  for (const key of passThrough) {
    const value = args.get(key);
    if (typeof value === "string" && value.length > 0) {
      drillArgs.push(`--${key}=${value}`);
    }
  }
  if (!args.get("chat-min-unique-coverage")) {
    drillArgs.push(`--chat-min-unique-coverage=${milestonePolicy.pool.minUniqueCoverage}`);
  }
  return drillArgs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const milestone = (args.get("milestone") || "m1_1k").trim().toLowerCase();
  const policyPath = resolve(
    args.get("policy") || "scripts/reliability/milestone-gate-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const milestonePolicy = policy?.milestones?.[milestone];
  if (!milestonePolicy) {
    throw new Error(`Unknown milestone '${milestone}'.`);
  }

  const baseUrl =
    args.get("base-url") ||
    process.env.RELIABILITY_BASE_URL ||
    process.env.CONVEX_SITE_URL ||
    process.env.VITE_CONVEX_SITE_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing base URL. Set RELIABILITY_BASE_URL or pass --base-url=https://...convex.site",
    );
  }

  const startedAt = new Date().toISOString();
  const drillRun = await runCommand(process.execPath, buildDrillArgs({
    milestone,
    milestonePolicy,
    baseUrl,
    args,
  }));
  if (drillRun.code !== 0) {
    throw new Error(
      `Load drill failed (exit=${drillRun.code}). stderr=${drillRun.stderr.slice(0, 1200)} stdout=${drillRun.stdout.slice(0, 1200)}`,
    );
  }
  const drillReportPath = extractReportPath(drillRun.stdout);
  if (!drillReportPath) {
    throw new Error("Milestone gate could not find load drill report path.");
  }
  const drillReport = JSON.parse(await readFile(resolve(drillReportPath), "utf8"));

  const scenarioChecks = [];
  for (const scenarioName of milestonePolicy.requiredScenarios || []) {
    const scenario = (drillReport.scenarios || []).find(
      (entry) => entry.name === scenarioName && !entry.skipped,
    );
    if (!scenario) {
      scenarioChecks.push({
        scenario: scenarioName,
        pass: false,
        checks: [
          {
            name: "scenario_present",
            pass: false,
            actual: "missing",
            threshold: "required",
          },
        ],
      });
      continue;
    }
    scenarioChecks.push({
      scenario: scenarioName,
      ...evaluateChatScenario(scenario, milestonePolicy),
    });
  }

  const snapshotWindowMinutes = toNumber(
    args.get("snapshot-minutes"),
    Number(policy.defaults?.snapshotWindowMinutes || 30),
  );
  const snapshotLimit = toNumber(
    args.get("snapshot-limit"),
    Number(policy.defaults?.snapshotLimit || 80),
  );
  const snapshotArgsJson = JSON.stringify({
    minutes: snapshotWindowMinutes,
    limit: snapshotLimit,
  });
  const snapshotRun =
    process.platform === "win32"
      ? await runCommand("cmd", [
          "/c",
          "npx",
          "convex",
          "run",
          "ops:getReliabilitySnapshot",
          snapshotArgsJson,
        ], { tee: false })
      : await runCommand("npx", [
          "convex",
          "run",
          "ops:getReliabilitySnapshot",
          snapshotArgsJson,
        ], { tee: false });
  if (snapshotRun.code !== 0) {
    throw new Error("Milestone gate failed to collect reliability snapshot.");
  }
  const snapshot = extractJson(snapshotRun.stdout);
  const snapshotChecks = evaluateSnapshot(
    snapshot,
    milestonePolicy,
    snapshotWindowMinutes,
  );

  const pass =
    scenarioChecks.every((entry) => entry.pass) && snapshotChecks.pass;
  const finishedAt = new Date().toISOString();
  const report = {
    startedAt,
    finishedAt,
    baseUrl,
    milestone,
    policyPath,
    drillReportPath,
    snapshotWindowMinutes,
    snapshotLimit,
    scenarioChecks,
    snapshotChecks,
    pass,
  };

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = resolve(outputDir, `milestone-gate-${milestone}-${stamp}.json`);
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Milestone gate completed: ${pass ? "PASS" : "FAIL"}`);
  console.log(`Report: ${outputPath}`);

  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Milestone gate failed:", error);
  process.exitCode = 1;
});
