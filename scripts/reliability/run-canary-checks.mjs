#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function calculateRates(summary, allowedStatuses) {
  const total = Math.max(summary.totalRequests || 0, 1);
  const statuses = Object.entries(summary.statuses || {}).map(([status, count]) => ({
    status: Number(status),
    count: Number(count),
  }));
  const fiveXx = statuses
    .filter((item) => item.status >= 500)
    .reduce((sum, item) => sum + item.count, 0);
  const unknown = statuses
    .filter((item) => !allowedStatuses.includes(item.status))
    .reduce((sum, item) => sum + item.count, 0);
  const networkErrors = Object.values(summary.errors || {}).reduce(
    (sum, value) => sum + Number(value),
    0,
  );

  return {
    fiveXxRate: fiveXx / total,
    networkErrorRate: networkErrors / total,
    unknownStatusRate: unknown / total,
    p95Ms: Number(summary.latency?.p95Ms ?? 0),
  };
}

function normalizeScenarioMap(drillReport) {
  const map = new Map();
  for (const scenario of drillReport.scenarios || []) {
    if (scenario?.skipped) continue;
    map.set(scenario.name, scenario);
  }
  return map;
}

const DEFAULT_ALLOWED_STATUSES_BY_SCENARIO = {
  gmail_push_webhook: [200, 400, 403, 429],
  whatsapp_webhook: [200, 400, 403, 429],
  chat_stream_http: [200, 401, 429, 503],
};

async function runNodeScript(scriptPath, args) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
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

async function runProbe(baseUrl) {
  const run = await runNodeScript("scripts/reliability/run-synthetic-probes.mjs", [
    `--base-url=${baseUrl}`,
  ]);
  if (run.code !== 0) {
    throw new Error(`Synthetic probes failed for ${baseUrl}`);
  }
  const reportPath = extractReportPath(run.stdout);
  if (!reportPath) {
    throw new Error(`Probe run for ${baseUrl} did not emit report path`);
  }
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  return { reportPath, report };
}

async function runDrill(baseUrl, profile) {
  const run = await runNodeScript("scripts/reliability/run-load-drills.mjs", [
    `--base-url=${baseUrl}`,
    `--profile=${profile}`,
  ]);
  if (run.code !== 0) {
    throw new Error(`Load drill failed for ${baseUrl}`);
  }
  const reportPath = extractReportPath(run.stdout);
  if (!reportPath) {
    throw new Error(`Load drill run for ${baseUrl} did not emit report path`);
  }
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  return { reportPath, report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const controlUrl =
    args.get("control-url") ||
    process.env.RELIABILITY_CONTROL_URL ||
    process.env.RELIABILITY_BASE_URL;
  const candidateUrl =
    args.get("candidate-url") ||
    process.env.RELIABILITY_CANDIDATE_URL ||
    process.env.RELIABILITY_BASE_URL;
  if (!controlUrl || !candidateUrl) {
    throw new Error(
      "Missing control/candidate URL. Set RELIABILITY_CONTROL_URL and RELIABILITY_CANDIDATE_URL (or pass --control-url/--candidate-url).",
    );
  }

  const profile = (args.get("profile") || "quick").trim().toLowerCase();
  const policyPath = resolve(
    args.get("policy") || "scripts/reliability/canary-policy.json",
  );
  const policy = JSON.parse(await readFile(policyPath, "utf8")).comparison;
  const maxP95RegressionRatio = toNumber(
    args.get("max-p95-regression-ratio"),
    policy.maxP95RegressionRatio,
  );
  const maxP95AbsoluteRegressionMs = toNumber(
    args.get("max-p95-absolute-regression-ms"),
    policy.maxP95AbsoluteRegressionMs,
  );
  const maxFiveXxRateRegression = toNumber(
    args.get("max-5xx-regression-rate"),
    policy.maxFiveXxRateRegression,
  );
  const maxNetworkErrorRateRegression = toNumber(
    args.get("max-network-regression-rate"),
    policy.maxNetworkErrorRateRegression,
  );
  const maxUnknownStatusRateRegression = toNumber(
    args.get("max-unknown-regression-rate"),
    policy.maxUnknownStatusRateRegression,
  );

  const startedAt = new Date().toISOString();
  const controlProbe = await runProbe(controlUrl);
  const candidateProbe = await runProbe(candidateUrl);
  const controlDrill = await runDrill(controlUrl, profile);
  const candidateDrill = await runDrill(candidateUrl, profile);

  const checks = [];
  checks.push({
    name: "control_probe_pass",
    pass: controlProbe.report.passed === true,
    details: {
      reportPath: controlProbe.reportPath,
      passed: controlProbe.report.passed,
    },
  });
  checks.push({
    name: "candidate_probe_pass",
    pass: candidateProbe.report.passed === true,
    details: {
      reportPath: candidateProbe.reportPath,
      passed: candidateProbe.report.passed,
    },
  });
  checks.push({
    name: "control_drill_pass",
    pass: controlDrill.report.passed === true,
    details: {
      reportPath: controlDrill.reportPath,
      passed: controlDrill.report.passed,
    },
  });
  checks.push({
    name: "candidate_drill_pass",
    pass: candidateDrill.report.passed === true,
    details: {
      reportPath: candidateDrill.reportPath,
      passed: candidateDrill.report.passed,
    },
  });

  const controlScenarios = normalizeScenarioMap(controlDrill.report);
  const candidateScenarios = normalizeScenarioMap(candidateDrill.report);
  const scenarioComparisons = [];
  for (const [scenarioName, controlScenario] of controlScenarios.entries()) {
    const candidateScenario = candidateScenarios.get(scenarioName);
    if (!candidateScenario) continue;
    const statusAllowList =
      DEFAULT_ALLOWED_STATUSES_BY_SCENARIO[scenarioName] ||
      [200, 400, 401, 403, 429, 503];
    const controlRates = calculateRates(
      controlScenario.summary,
      statusAllowList,
    );
    const candidateRates = calculateRates(
      candidateScenario.summary,
      statusAllowList,
    );
    const p95Ratio =
      controlRates.p95Ms > 0 ? candidateRates.p95Ms / controlRates.p95Ms : 1;
    const p95DeltaMs = candidateRates.p95Ms - controlRates.p95Ms;
    const fiveXxDelta = candidateRates.fiveXxRate - controlRates.fiveXxRate;
    const networkDelta =
      candidateRates.networkErrorRate - controlRates.networkErrorRate;
    const unknownDelta =
      candidateRates.unknownStatusRate - controlRates.unknownStatusRate;

    scenarioComparisons.push({
      scenario: scenarioName,
      pass:
        (p95Ratio <= maxP95RegressionRatio ||
          p95DeltaMs <= maxP95AbsoluteRegressionMs) &&
        fiveXxDelta <= maxFiveXxRateRegression &&
        networkDelta <= maxNetworkErrorRateRegression &&
        unknownDelta <= maxUnknownStatusRateRegression,
      control: controlRates,
      candidate: candidateRates,
      deltas: {
        p95Ratio: Number(p95Ratio.toFixed(3)),
        p95DeltaMs: Number(p95DeltaMs.toFixed(1)),
        fiveXxRate: Number(fiveXxDelta.toFixed(4)),
        networkErrorRate: Number(networkDelta.toFixed(4)),
        unknownStatusRate: Number(unknownDelta.toFixed(4)),
      },
      thresholds: {
        maxP95RegressionRatio,
        maxP95AbsoluteRegressionMs,
        maxFiveXxRateRegression,
        maxNetworkErrorRateRegression,
        maxUnknownStatusRateRegression,
      },
    });
  }

  checks.push(
    ...scenarioComparisons.map((comparison) => ({
      name: `scenario_${comparison.scenario}`,
      pass: comparison.pass,
      details: comparison,
    })),
  );

  const passed = checks.every((check) => check.pass);
  const finishedAt = new Date().toISOString();
  const report = {
    startedAt,
    finishedAt,
    profile,
    controlUrl,
    candidateUrl,
    policyPath,
    checks,
    artifacts: {
      controlProbe: controlProbe.reportPath,
      candidateProbe: candidateProbe.reportPath,
      controlDrill: controlDrill.reportPath,
      candidateDrill: candidateDrill.reportPath,
    },
    passed,
    rollbackCriteria: [
      "If candidate canary checks fail, block promotion.",
      "Keep control deployment serving traffic.",
      "Inspect scenario deltas and reliability reports before retrying.",
    ],
  };

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `canary-check-${stamp}.json`);
  await writeFile(outputFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`Canary check completed. Overall pass: ${passed ? "YES" : "NO"}`);
  console.log(`Report: ${outputFile}`);
  for (const check of checks) {
    console.log(`- ${check.name}: ${check.pass ? "PASS" : "FAIL"}`);
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Canary check failed:", error);
  process.exitCode = 1;
});
