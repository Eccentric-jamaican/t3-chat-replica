#!/usr/bin/env node
import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = new Map();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue] = arg.slice(2).split("=");
    out.set(rawKey, rawValue ?? "true");
  }
  return out;
}

function toBoolean(value) {
  return String(value).toLowerCase() === "true";
}

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
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Unable to parse JSON payload from command output.");
  }
  const candidate = text.slice(first, last + 1);
  return JSON.parse(candidate);
}

function evaluateSnapshot(snapshot, policy) {
  const checks = [
    {
      name: "open_circuits",
      actual: snapshot.circuitBreakers.openCount,
      threshold: policy.maxOpenCircuits,
      pass: snapshot.circuitBreakers.openCount <= policy.maxOpenCircuits,
    },
    {
      name: "rate_limit_alerts_window",
      actual: snapshot.rateLimitPressure.alertsInWindow,
      threshold: policy.maxRateLimitAlertsInWindow,
      pass:
        snapshot.rateLimitPressure.alertsInWindow <=
        policy.maxRateLimitAlertsInWindow,
    },
    {
      name: "bulkhead_active_leases",
      actual: snapshot.bulkheads.activeLeaseCount,
      threshold: policy.maxBulkheadActiveLeases,
      pass:
        snapshot.bulkheads.activeLeaseCount <= policy.maxBulkheadActiveLeases,
    },
    {
      name: "tool_jobs_queued",
      actual: snapshot.toolJobs.byStatus.queued,
      threshold: policy.maxQueuedToolJobs,
      pass: snapshot.toolJobs.byStatus.queued <= policy.maxQueuedToolJobs,
    },
    {
      name: "tool_jobs_failed",
      actual: snapshot.toolJobs.byStatus.failed,
      threshold: policy.maxFailedToolJobs,
      pass: snapshot.toolJobs.byStatus.failed <= policy.maxFailedToolJobs,
    },
    {
      name: "tool_jobs_oldest_queued_age",
      actual: snapshot.toolJobs.oldestQueuedAgeMs,
      threshold: policy.maxOldestQueuedAgeMs,
      pass:
        snapshot.toolJobs.oldestQueuedAgeMs <= policy.maxOldestQueuedAgeMs,
    },
    {
      name: "tool_jobs_oldest_running_age",
      actual: snapshot.toolJobs.oldestRunningAgeMs,
      threshold: policy.maxOldestRunningAgeMs,
      pass:
        snapshot.toolJobs.oldestRunningAgeMs <= policy.maxOldestRunningAgeMs,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
  };
}

const SCENARIO_ENDPOINT_MAP = {
  gmail_push_webhook: "/api/gmail/push",
  whatsapp_webhook: "/api/whatsapp/webhook",
  chat_stream_http: "/api/chat",
};

function getOwner(surface, ownershipMatrix) {
  const fallback = ownershipMatrix?.defaults || {
    owner: "reliability-platform",
    secondary: "sendcat-oncall",
  };
  const resolved = ownershipMatrix?.surfaces?.[surface];
  return resolved || fallback;
}

function calculateScenarioRates(summary, allowedStatuses) {
  const totalRequests = Math.max(Number(summary?.totalRequests || 0), 1);
  const statuses = Object.entries(summary?.statuses || {}).map(
    ([status, count]) => ({
      status: Number(status),
      count: Number(count),
    }),
  );
  const fiveXxCount = statuses
    .filter((item) => item.status >= 500)
    .reduce((sum, item) => sum + item.count, 0);
  const unknownCount = statuses
    .filter((item) => !allowedStatuses.includes(item.status))
    .reduce((sum, item) => sum + item.count, 0);
  const networkErrorCount = Object.values(summary?.errors || {}).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  return {
    p95Ms: Number(summary?.latency?.p95Ms || 0),
    fiveXxRate: fiveXxCount / totalRequests,
    networkErrorRate: networkErrorCount / totalRequests,
    unknownStatusRate: unknownCount / totalRequests,
  };
}

function calculateBurnRate(rates, threshold) {
  const p95Burn =
    threshold.maxP95Ms > 0 ? rates.p95Ms / threshold.maxP95Ms : 0;
  const fiveXxBurn =
    threshold.maxFiveXxRate > 0 ? rates.fiveXxRate / threshold.maxFiveXxRate : 0;
  const networkBurn =
    threshold.maxNetworkErrorRate > 0
      ? rates.networkErrorRate / threshold.maxNetworkErrorRate
      : 0;
  const unknownBurn =
    threshold.maxUnknownStatusRate > 0
      ? rates.unknownStatusRate / threshold.maxUnknownStatusRate
      : 0;
  return {
    overall: Math.max(p95Burn, fiveXxBurn, networkBurn, unknownBurn),
    byMetric: {
      p95: p95Burn,
      fiveXx: fiveXxBurn,
      network: networkBurn,
      unknown: unknownBurn,
    },
  };
}

async function listRecentLoadReports(outputDir, profile, lookback) {
  const files = await readdir(outputDir);
  const candidates = files
    .filter((file) => file.startsWith(`load-drill-${profile}-`) && file.endsWith(".json"))
    .sort()
    .slice(-lookback);
  const reports = [];
  for (const file of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const parsed = JSON.parse(await readFile(resolve(outputDir, file), "utf8"));
      reports.push(parsed);
    } catch {
      // Ignore malformed historical artifacts.
    }
  }
  return reports;
}

function evaluateBurnRateGate({
  latestDrillReport,
  historicalDrillReports,
  sloBaseline,
  burnPolicy,
  ownershipMatrix,
}) {
  const checks = [];
  const scenarios = latestDrillReport?.scenarios || [];

  for (const scenario of scenarios) {
    if (scenario?.skipped) {
      continue;
    }
    const endpoint = SCENARIO_ENDPOINT_MAP[scenario.name];
    if (!endpoint) {
      continue;
    }
    const threshold = sloBaseline?.endpoints?.[endpoint];
    if (!threshold) {
      continue;
    }
    const rates = calculateScenarioRates(scenario.summary, threshold.allowedStatuses || []);
    const shortBurn = calculateBurnRate(rates, threshold);

    const historicalScenarioBurns = [];
    for (const report of historicalDrillReports) {
      const matching = (report.scenarios || []).find(
        (entry) => entry.name === scenario.name && !entry.skipped,
      );
      if (!matching) continue;
      const historicalRates = calculateScenarioRates(
        matching.summary,
        threshold.allowedStatuses || [],
      );
      const historicalBurn = calculateBurnRate(historicalRates, threshold);
      historicalScenarioBurns.push(historicalBurn.overall);
    }

    const longBurn =
      historicalScenarioBurns.length > 0
        ? historicalScenarioBurns.reduce((sum, value) => sum + value, 0) /
          historicalScenarioBurns.length
        : shortBurn.overall;

    const hasEnoughHistory =
      historicalScenarioBurns.length >= burnPolicy.minReportsForLongWindow;
    const owner = getOwner(endpoint, ownershipMatrix);
    const pass =
      shortBurn.overall <= burnPolicy.shortWindowMaxBurnRate &&
      (!hasEnoughHistory || longBurn <= burnPolicy.longWindowMaxBurnRate);

    checks.push({
      name: `burn_rate_${scenario.name}`,
      endpoint,
      owner,
      pass,
      shortWindowBurnRate: Number(shortBurn.overall.toFixed(3)),
      longWindowBurnRate: Number(longBurn.toFixed(3)),
      historySamples: historicalScenarioBurns.length,
      thresholds: {
        shortWindowMaxBurnRate: burnPolicy.shortWindowMaxBurnRate,
        longWindowMaxBurnRate: burnPolicy.longWindowMaxBurnRate,
        minReportsForLongWindow: burnPolicy.minReportsForLongWindow,
      },
      metricBurn: {
        p95: Number(shortBurn.byMetric.p95.toFixed(3)),
        fiveXx: Number(shortBurn.byMetric.fiveXx.toFixed(3)),
        network: Number(shortBurn.byMetric.network.toFixed(3)),
        unknown: Number(shortBurn.byMetric.unknown.toFixed(3)),
      },
      hasEnoughHistory,
    });
  }

  return {
    pass: checks.every((check) => check.pass),
    checks,
  };
}

async function runCommand(command, args) {
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
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

  const profile = (args.get("profile") || "quick").trim().toLowerCase();
  const minutes = toNumber(args.get("minutes"), 15);
  const limit = toNumber(args.get("limit"), 100);
  const skipProbes = toBoolean(args.get("skip-probes"));
  const skipDrill = toBoolean(args.get("skip-drill"));
  const policyPath = resolve(
    args.get("policy") || "scripts/reliability/release-gate-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const ownershipPath = resolve(
    args.get("ownership") || "scripts/reliability/ownership-matrix.json",
  );
  const ownershipMatrix = JSON.parse(await readFile(ownershipPath, "utf8"));
  const sloBaselinePath = resolve(
    args.get("slo-baseline") || "scripts/reliability/slo-baseline.json",
  );
  const sloBaseline = JSON.parse(await readFile(sloBaselinePath, "utf8"));

  const startedAt = new Date().toISOString();
  const steps = [];
  let latestDrillReport = null;
  let latestDrillReportPath = null;

  if (!skipProbes) {
    const probeRun = await runCommand("node", [
      "scripts/reliability/run-synthetic-probes.mjs",
      `--base-url=${baseUrl}`,
    ]);
    steps.push({
      name: "synthetic_probes",
      pass: probeRun.code === 0,
      report: extractReportPath(probeRun.stdout),
      exitCode: probeRun.code,
    });
  } else {
    steps.push({
      name: "synthetic_probes",
      pass: true,
      skipped: true,
    });
  }

  if (!skipDrill) {
    const drillRun = await runCommand("node", [
      "scripts/reliability/run-load-drills.mjs",
      `--profile=${profile}`,
      `--base-url=${baseUrl}`,
    ]);
    latestDrillReportPath = extractReportPath(drillRun.stdout);
    if (latestDrillReportPath) {
      latestDrillReport = JSON.parse(
        await readFile(resolve(latestDrillReportPath), "utf8"),
      );
    }
    steps.push({
      name: "load_drill",
      pass: drillRun.code === 0,
      report: latestDrillReportPath,
      exitCode: drillRun.code,
      profile,
    });
  } else {
    steps.push({
      name: "load_drill",
      pass: true,
      skipped: true,
      profile,
    });
  }

  const snapshotArgsJson = JSON.stringify({ minutes, limit });
  const snapshotRun =
    process.platform === "win32"
      ? await runCommand("powershell", [
          "-NoProfile",
          "-Command",
          `npx convex run ops:getReliabilitySnapshot '${snapshotArgsJson}'`,
        ])
      : await runCommand("npx", [
          "convex",
          "run",
          "ops:getReliabilitySnapshot",
          snapshotArgsJson,
        ]);
  if (snapshotRun.code !== 0) {
    throw new Error("Failed to collect ops:getReliabilitySnapshot for release gate.");
  }
  const snapshot = extractJson(snapshotRun.stdout);
  const snapshotEvaluation = evaluateSnapshot(snapshot, policy.snapshot);
  steps.push({
    name: "snapshot_gate",
    pass: snapshotEvaluation.pass,
    checks: snapshotEvaluation.checks.map((check) => ({
      ...check,
      owner: getOwner(`snapshot:${check.name}`, ownershipMatrix),
    })),
  });

  if (
    policy?.burnRate?.enabled &&
    !skipDrill &&
    latestDrillReport &&
    latestDrillReportPath
  ) {
    const outputDir = resolve(".output", "reliability");
    const historicalDrillReports = await listRecentLoadReports(
      outputDir,
      profile,
      Math.max(policy.burnRate.lookbackReports || 8, 1),
    );
    const burnEvaluation = evaluateBurnRateGate({
      latestDrillReport,
      historicalDrillReports,
      sloBaseline,
      burnPolicy: policy.burnRate,
      ownershipMatrix,
    });
    steps.push({
      name: "burn_rate_gate",
      pass: burnEvaluation.pass,
      checks: burnEvaluation.checks,
      sourceReport: latestDrillReportPath,
      lookbackReports: historicalDrillReports.length,
    });
  } else {
    steps.push({
      name: "burn_rate_gate",
      pass: true,
      skipped: true,
    });
  }

  const passed = steps.every((step) => step.pass);
  const finishedAt = new Date().toISOString();
  const report = {
    startedAt,
    finishedAt,
    baseUrl,
    profile,
    snapshotWindowMinutes: minutes,
    snapshotLimit: limit,
    policyPath,
    ownershipPath,
    sloBaselinePath,
    steps,
    passed,
    rollbackCriteria: [
      "Block release if any gate fails.",
      "Keep existing production deployment active.",
      "Investigate failing checks with `npm run reliability:snapshot` and RUNBOOK playbooks.",
      "Re-run release gate after mitigation before promoting build.",
    ],
  };

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `release-gate-${stamp}.json`);
  await writeFile(outputFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`Release gate completed. Overall pass: ${passed ? "YES" : "NO"}`);
  console.log(`Report: ${outputFile}`);
  for (const step of steps) {
    console.log(`- ${step.name}: ${step.pass ? "PASS" : "FAIL"}`);
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Release gate failed:", error);
  process.exitCode = 1;
});
