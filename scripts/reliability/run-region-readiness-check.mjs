#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "./parseArgs.mjs";

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function rateFromStatuses(statuses, lowerInclusive, upperInclusive) {
  const entries = Object.entries(statuses || {}).map(([status, count]) => ({
    status: Number(status),
    count: Number(count),
  }));
  const total = entries.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return 0;
  const matching = entries
    .filter(
      (item) =>
        item.status >= lowerInclusive && item.status <= upperInclusive,
    )
    .reduce((sum, item) => sum + item.count, 0);
  return matching / total;
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
      if (tee) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (tee) {
        process.stderr.write(text);
      }
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function loadLatestLoadReports(outputDir, lookbackReports) {
  let files = [];
  try {
    files = await readdir(outputDir);
  } catch {
    return [];
  }
  const loadReports = files
    .filter((file) => file.startsWith("load-drill-") && file.endsWith(".json"))
    .sort()
    .slice(-lookbackReports);
  const reports = [];
  for (const file of loadReports) {
    const parsed = JSON.parse(await readFile(resolve(outputDir, file), "utf8"));
    reports.push({
      file,
      report: parsed,
    });
  }
  return reports;
}

function evaluateDemandTrigger(expectedPeakStreams, policy) {
  const activeActiveThreshold = Number(
    policy.expectedPeakConcurrentStreams.activeActiveThreshold,
  );
  const activeStandbyThreshold = Number(
    policy.expectedPeakConcurrentStreams.activeStandbyThreshold,
  );
  if (expectedPeakStreams >= activeActiveThreshold) {
    return {
      triggered: true,
      recommendedTopology: "active_active",
      reason: `expected_peak_streams >= ${activeActiveThreshold}`,
    };
  }
  if (expectedPeakStreams >= activeStandbyThreshold) {
    return {
      triggered: true,
      recommendedTopology: "active_standby",
      reason: `expected_peak_streams >= ${activeStandbyThreshold}`,
    };
  }
  return {
    triggered: false,
    recommendedTopology: "single_region",
    reason: "expected_peak_streams below rollout thresholds",
  };
}

function evaluateLoadTrigger(loadReports, policy) {
  const thresholds = policy.loadPressure;
  const evaluations = [];
  let breachCount = 0;

  for (const entry of loadReports) {
    const scenario = (entry.report.scenarios || []).find(
      (item) => item.name === "chat_stream_http" && !item.skipped,
    );
    if (!scenario) {
      continue;
    }
    const p95Ms = Number(scenario.summary?.latency?.p95Ms || 0);
    const statusMap = scenario.summary?.statuses || {};
    const rate429 = rateFromStatuses(statusMap, 429, 429);
    const rate5xx = rateFromStatuses(statusMap, 500, 599);
    const breached =
      p95Ms > thresholds.maxP95Ms ||
      rate429 > thresholds.max429Rate ||
      rate5xx > thresholds.max5xxRate;
    if (breached) {
      breachCount += 1;
    }
    evaluations.push({
      file: entry.file,
      profile: entry.report.profile,
      p95Ms,
      rate429,
      rate5xx,
      breached,
    });
  }

  return {
    triggered: breachCount >= thresholds.minBreachesToTrigger,
    breachCount,
    thresholdBreachesNeeded: thresholds.minBreachesToTrigger,
    evaluations,
    recommendedTopology:
      typeof thresholds.recommendedTopology === "string" &&
      thresholds.recommendedTopology.trim()
        ? thresholds.recommendedTopology
        : "active_standby",
  };
}

function evaluateSnapshotTrigger(snapshot, policy) {
  const thresholds = policy.opsSnapshot;
  const now = Number(snapshot?.generatedAt || Date.now());
  const windowMs = Math.max(Number(thresholds.windowMinutes || 30), 1) * 60_000;
  const cutoff = now - windowMs;
  const recentCircuits = Array.isArray(snapshot?.circuitBreakers?.recent)
    ? snapshot.circuitBreakers.recent
    : [];
  const openCircuits = recentCircuits.filter(
    (item) =>
      item?.state === "open" &&
      Number(item?.updatedAt || 0) >= cutoff &&
      typeof item?.provider === "string" &&
      !item.provider.startsWith("phase_"),
  ).length;
  const queuedToolJobs = Number(snapshot?.toolJobs?.byStatus?.queued || 0);
  const rateLimitAlerts = Number(
    snapshot?.rateLimitPressure?.alertsInWindow || 0,
  );
  const checks = {
    openCircuits: {
      actual: openCircuits,
      threshold: thresholds.maxOpenCircuits,
      breached: openCircuits > thresholds.maxOpenCircuits,
    },
    queuedToolJobs: {
      actual: queuedToolJobs,
      threshold: thresholds.maxQueuedToolJobs,
      breached: queuedToolJobs > thresholds.maxQueuedToolJobs,
    },
    rateLimitAlertsInWindow: {
      actual: rateLimitAlerts,
      threshold: thresholds.maxRateLimitAlertsInWindow,
      breached: rateLimitAlerts > thresholds.maxRateLimitAlertsInWindow,
    },
  };
  return {
    triggered:
      checks.openCircuits.breached ||
      checks.queuedToolJobs.breached ||
      checks.rateLimitAlertsInWindow.breached,
    checks,
    recommendedTopology:
      typeof thresholds.recommendedTopology === "string" &&
      thresholds.recommendedTopology.trim()
        ? thresholds.recommendedTopology
        : "active_standby",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policyPath = resolve(
    args.get("policy") || "scripts/reliability/region-rollout-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));

  const expectedPeakStreams = toNumber(
    args.get("expected-peak-streams") ||
      process.env.RELIABILITY_EXPECTED_PEAK_STREAMS,
    0,
  );

  let snapshot;
  const snapshotFile = args.get("snapshot-file");
  if (snapshotFile) {
    snapshot = JSON.parse(await readFile(resolve(snapshotFile), "utf8"));
  } else {
    const minutes = toNumber(
      args.get("snapshot-minutes"),
      Number(policy.opsSnapshot.windowMinutes || 30),
    );
    const limit = toNumber(args.get("snapshot-limit"), 50);
    const snapshotArgsJson = JSON.stringify({ minutes, limit });
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
      throw new Error(
        "Failed to collect ops:getReliabilitySnapshot for region readiness check.",
      );
    }
    snapshot = extractJson(snapshotRun.stdout);
  }

  const outputDir = resolve(".output", "reliability");
  const lookback = Math.max(
    1,
    toNumber(
      args.get("lookback-reports"),
      Number(policy.loadPressure.lookbackReports || 6),
    ),
  );
  const loadReports = await loadLatestLoadReports(outputDir, lookback);

  const demandTrigger = evaluateDemandTrigger(expectedPeakStreams, policy);
  const loadTrigger = evaluateLoadTrigger(loadReports, policy);
  const snapshotTrigger = evaluateSnapshotTrigger(snapshot, policy);

  const anyTrigger =
    demandTrigger.triggered || loadTrigger.triggered || snapshotTrigger.triggered;
  const currentTopology =
    snapshot?.config?.regionTopology?.topologyMode || "single_region";
  const readinessOnly = Boolean(
    snapshot?.config?.regionTopology?.readinessOnly ?? true,
  );
  let recommendedTopology = "single_region";
  if (demandTrigger.triggered) {
    recommendedTopology = demandTrigger.recommendedTopology;
  } else if (loadTrigger.triggered) {
    recommendedTopology = loadTrigger.recommendedTopology;
  } else if (snapshotTrigger.triggered) {
    recommendedTopology = snapshotTrigger.recommendedTopology;
  }
  if (
    !demandTrigger.triggered &&
    (loadTrigger.triggered || snapshotTrigger.triggered) &&
    recommendedTopology === "single_region"
  ) {
    recommendedTopology = "active_standby";
  }

  const report = {
    startedAt: new Date().toISOString(),
    policyPath,
    expectedPeakStreams,
    currentTopology,
    readinessOnly,
    triggers: {
      demand: demandTrigger,
      loadPressure: loadTrigger,
      snapshotHealth: snapshotTrigger,
    },
    decision: {
      activateMultiRegionProgram: anyTrigger,
      recommendedTopology,
      rationale: anyTrigger
        ? "One or more trigger conditions crossed configured thresholds."
        : "No trigger condition crossed thresholds. Keep single-region launch mode.",
    },
  };

  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = resolve(outputDir, `region-readiness-${stamp}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    `Region readiness decision: ${report.decision.activateMultiRegionProgram ? "TRIGGERED" : "NOT_TRIGGERED"}`,
  );
  console.log(`Recommended topology: ${recommendedTopology}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error("Region readiness check failed:", error);
  process.exitCode = 1;
});
