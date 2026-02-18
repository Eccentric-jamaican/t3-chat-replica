#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxReports = toNumber(args.get("max-reports"), 10);
  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });

  const files = await readdir(outputDir);
  const loadDrillFiles = files
    .filter((file) => file.startsWith("load-drill-") && file.endsWith(".json"))
    .sort()
    .slice(-maxReports);
  const probeFiles = files
    .filter((file) => file.startsWith("synthetic-probes-") && file.endsWith(".json"))
    .sort()
    .slice(-maxReports);
  const gateFiles = files
    .filter((file) => file.startsWith("release-gate-") && file.endsWith(".json"))
    .sort()
    .slice(-maxReports);

  const loadReports = (
    await Promise.all(loadDrillFiles.map((file) => readJsonIfExists(resolve(outputDir, file))))
  ).filter(Boolean);
  const probeReports = (
    await Promise.all(probeFiles.map((file) => readJsonIfExists(resolve(outputDir, file))))
  ).filter(Boolean);
  const gateReports = (
    await Promise.all(gateFiles.map((file) => readJsonIfExists(resolve(outputDir, file))))
  ).filter(Boolean);

  const scenarios = new Map();
  for (const report of loadReports) {
    for (const scenario of report.scenarios || []) {
      if (scenario.skipped) continue;
      const row = scenarios.get(scenario.name) || {
        runs: 0,
        pass: 0,
        p95: [],
      };
      row.runs += 1;
      if (scenario.slo?.pass) row.pass += 1;
      row.p95.push(Number(scenario.summary?.latency?.p95Ms || 0));
      scenarios.set(scenario.name, row);
    }
  }

  const scenarioRows = Array.from(scenarios.entries()).map(([name, stats]) => ({
    name,
    runs: stats.runs,
    passRate: stats.runs > 0 ? stats.pass / stats.runs : 0,
    avgP95Ms: average(stats.p95),
    maxP95Ms: stats.p95.length > 0 ? Math.max(...stats.p95) : 0,
  }));

  const dashboard = {
    generatedAt: new Date().toISOString(),
    source: {
      loadDrillReports: loadDrillFiles.length,
      probeReports: probeFiles.length,
      gateReports: gateFiles.length,
      maxReports,
    },
    loadDrills: {
      overallPassRate:
        loadReports.length > 0
          ? loadReports.filter((report) => report.passed).length / loadReports.length
          : 0,
      scenarios: scenarioRows,
    },
    probes: {
      overallPassRate:
        probeReports.length > 0
          ? probeReports.filter((report) => report.passed).length / probeReports.length
          : 0,
    },
    releaseGate: {
      overallPassRate:
        gateReports.length > 0
          ? gateReports.filter((report) => report.passed).length / gateReports.length
          : 0,
    },
  };

  const lines = [];
  lines.push("# Reliability SLO Dashboard");
  lines.push("");
  lines.push(`Generated: ${dashboard.generatedAt}`);
  lines.push("");
  lines.push("## Coverage");
  lines.push(
    `- Load drill reports analyzed: ${dashboard.source.loadDrillReports} (max ${dashboard.source.maxReports})`,
  );
  lines.push(
    `- Synthetic probe reports analyzed: ${dashboard.source.probeReports} (max ${dashboard.source.maxReports})`,
  );
  lines.push(
    `- Release gate reports analyzed: ${dashboard.source.gateReports} (max ${dashboard.source.maxReports})`,
  );
  lines.push("");
  lines.push("## Aggregate Pass Rates");
  lines.push(
    `- Load drills: ${(dashboard.loadDrills.overallPassRate * 100).toFixed(1)}%`,
  );
  lines.push(`- Synthetic probes: ${(dashboard.probes.overallPassRate * 100).toFixed(1)}%`);
  lines.push(
    `- Release gates: ${(dashboard.releaseGate.overallPassRate * 100).toFixed(1)}%`,
  );
  lines.push("");
  lines.push("## Scenario Trends");
  lines.push("");
  lines.push("| Scenario | Runs | Pass Rate | Avg p95 (ms) | Max p95 (ms) |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  if (scenarioRows.length === 0) {
    lines.push("| _none_ | 0 | 0% | 0 | 0 |");
  } else {
    for (const row of scenarioRows.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `| ${row.name} | ${row.runs} | ${(row.passRate * 100).toFixed(1)}% | ${row.avgP95Ms.toFixed(
          1,
        )} | ${row.maxP95Ms.toFixed(1)} |`,
      );
    }
  }

  const markdownPath = resolve(outputDir, "slo-dashboard.md");
  const jsonPath = resolve(outputDir, "slo-dashboard.json");
  await writeFile(markdownPath, lines.join("\n"), "utf8");
  await writeFile(jsonPath, JSON.stringify(dashboard, null, 2), "utf8");

  console.log("SLO dashboard generated.");
  console.log(`Markdown: ${markdownPath}`);
  console.log(`JSON: ${jsonPath}`);
}

main().catch((error) => {
  console.error("Failed to build SLO dashboard:", error);
  process.exitCode = 1;
});
