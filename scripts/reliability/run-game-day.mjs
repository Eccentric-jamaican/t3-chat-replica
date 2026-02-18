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

function extractReportPath(output) {
  const line = output
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("Report: "));
  if (!line) return null;
  return line.slice("Report: ".length).trim();
}

function parseProfiles(value) {
  if (!value) return ["burst", "soak"];
  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : ["burst", "soak"];
}

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

  const profiles = parseProfiles(args.get("profiles"));
  const startedAt = new Date().toISOString();
  const steps = [];

  const probeRun = await runNodeScript(
    "scripts/reliability/run-synthetic-probes.mjs",
    [`--base-url=${baseUrl}`],
  );
  const probeReportPath = extractReportPath(probeRun.stdout);
  const probeReport = probeReportPath
    ? JSON.parse(await readFile(resolve(probeReportPath), "utf8"))
    : null;
  steps.push({
    type: "probe",
    pass: probeRun.code === 0,
    reportPath: probeReportPath,
  });

  const drillReports = [];
  for (const profile of profiles) {
    // eslint-disable-next-line no-await-in-loop
    const drillRun = await runNodeScript(
      "scripts/reliability/run-load-drills.mjs",
      [`--base-url=${baseUrl}`, `--profile=${profile}`],
    );
    const drillReportPath = extractReportPath(drillRun.stdout);
    const drillReport = drillReportPath
      ? JSON.parse(await readFile(resolve(drillReportPath), "utf8"))
      : null;
    drillReports.push({
      profile,
      pass: drillRun.code === 0,
      reportPath: drillReportPath,
      report: drillReport,
    });
    steps.push({
      type: "drill",
      profile,
      pass: drillRun.code === 0,
      reportPath: drillReportPath,
    });
  }

  const findings = [];
  if (probeReport && probeReport.passed !== true) {
    findings.push("Synthetic probes reported at least one failing guard check.");
  }
  for (const drill of drillReports) {
    if (!drill.report) continue;
    if (drill.report.passed !== true) {
      findings.push(`Load drill profile ${drill.profile} failed SLO gate.`);
    }
    for (const scenario of drill.report.scenarios || []) {
      if (scenario.skipped) continue;
      const statuses = scenario.summary?.statuses || {};
      const throttled = Number(statuses["429"] || 0);
      const total = Number(scenario.summary?.totalRequests || 0);
      if (total > 0 && throttled / total > 0.3) {
        findings.push(
          `Profile ${drill.profile}, scenario ${scenario.name} had high 429 share (${(
            (throttled / total) *
            100
          ).toFixed(1)}%).`,
        );
      }
    }
  }

  const passed = steps.every((step) => step.pass);
  const finishedAt = new Date().toISOString();
  const report = {
    startedAt,
    finishedAt,
    baseUrl,
    profiles,
    passed,
    steps,
    findings,
    actionItems:
      findings.length === 0
        ? ["No immediate reliability action required from this game-day run."]
        : [
            "Investigate failed/flagged scenarios via runbook playbooks.",
            "Tune reliability env knobs conservatively and rerun game-day.",
          ],
  };

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `game-day-${stamp}.json`);
  await writeFile(outputFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`Game-day run completed. Overall pass: ${passed ? "YES" : "NO"}`);
  console.log(`Report: ${outputFile}`);
  for (const step of steps) {
    const suffix = step.profile ? ` (${step.profile})` : "";
    console.log(`- ${step.type}${suffix}: ${step.pass ? "PASS" : "FAIL"}`);
  }
  if (findings.length > 0) {
    console.log("Findings:");
    for (const finding of findings) {
      console.log(`- ${finding}`);
    }
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Game-day run failed:", error);
  process.exitCode = 1;
});
