#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function mergeCounters(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
  return target;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStage({ name, total, durationMs, concurrency, makeRequest }) {
  const statuses = {};
  const errors = {};
  const latencies = [];

  let requestCursor = 0;
  let executed = 0;
  const normalizedConcurrency = Math.max(concurrency, 1);
  const normalizedTotal =
    typeof total === "number" && Number.isFinite(total)
      ? Math.max(Math.floor(total), 0)
      : null;
  const normalizedDurationMs =
    typeof durationMs === "number" && Number.isFinite(durationMs)
      ? Math.max(Math.floor(durationMs), 1)
      : null;
  const deadline =
    normalizedDurationMs !== null ? Date.now() + normalizedDurationMs : null;

  const workers = Array.from({ length: normalizedConcurrency }, async () => {
    while (true) {
      if (normalizedTotal !== null && requestCursor >= normalizedTotal) return;
      if (deadline !== null && Date.now() >= deadline) return;

      const current = requestCursor++;
      if (normalizedTotal !== null && current >= normalizedTotal) return;

      const startedAt = Date.now();
      executed += 1;
      try {
        const response = await makeRequest(current);
        const statusKey = String(response.status);
        statuses[statusKey] = (statuses[statusKey] ?? 0) + 1;
        latencies.push(Date.now() - startedAt);
        if (response.body) {
          await response.body.cancel();
        }
      } catch (error) {
        const key = error instanceof Error ? error.name : "UnknownError";
        errors[key] = (errors[key] ?? 0) + 1;
        latencies.push(Date.now() - startedAt);
      }
    }
  });

  const wallStart = Date.now();
  await Promise.all(workers);
  const wallMs = Date.now() - wallStart;
  const completed = Object.values(statuses).reduce((a, b) => a + b, 0);
  const failed = Object.values(errors).reduce((a, b) => a + b, 0);

  return {
    name,
    mode: normalizedDurationMs !== null ? "duration" : "count",
    requestedTotal: normalizedTotal,
    requestedDurationMs: normalizedDurationMs,
    executed,
    concurrency: normalizedConcurrency,
    wallMs,
    requestsPerSecond:
      executed > 0
        ? Number(((executed * 1000) / Math.max(wallMs, 1)).toFixed(2))
        : 0,
    completed,
    failed,
    statuses,
    errors,
    latency: {
      minMs: latencies.length > 0 ? Math.min(...latencies) : 0,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      maxMs: latencies.length > 0 ? Math.max(...latencies) : 0,
      avgMs:
        latencies.length > 0
          ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2))
          : 0,
    },
  };
}

function evaluateSlo(summary, slo) {
  const total = summary.totalRequests;
  const fiveXx = Object.entries(summary.statuses)
    .filter(([status]) => Number(status) >= 500)
    .reduce((acc, [, count]) => acc + count, 0);
  const unknownStatus = Object.entries(summary.statuses)
    .filter(([status]) => !slo.allowedStatuses.includes(Number(status)))
    .reduce((acc, [, count]) => acc + count, 0);

  const networkErrors = Object.values(summary.errors).reduce((acc, count) => acc + count, 0);

  const fiveXxRate = total > 0 ? fiveXx / total : 0;
  const networkErrorRate = total > 0 ? networkErrors / total : 0;
  const unknownStatusRate = total > 0 ? unknownStatus / total : 0;
  const p95Ms = summary.latency.p95Ms;

  const checks = [
    {
      name: "p95_latency",
      pass: p95Ms <= slo.maxP95Ms,
      actual: p95Ms,
      threshold: slo.maxP95Ms,
    },
    {
      name: "5xx_rate",
      pass: fiveXxRate <= slo.maxFiveXxRate,
      actual: Number(fiveXxRate.toFixed(4)),
      threshold: slo.maxFiveXxRate,
    },
    {
      name: "network_error_rate",
      pass: networkErrorRate <= slo.maxNetworkErrorRate,
      actual: Number(networkErrorRate.toFixed(4)),
      threshold: slo.maxNetworkErrorRate,
    },
    {
      name: "unknown_status_rate",
      pass: unknownStatusRate <= slo.maxUnknownStatusRate,
      actual: Number(unknownStatusRate.toFixed(4)),
      threshold: slo.maxUnknownStatusRate,
    },
  ];

  return {
    pass: checks.every((c) => c.pass),
    checks,
  };
}

async function runScenario(config) {
  if (!config.enabled) {
    return {
      name: config.name,
      skipped: true,
      reason: config.skipReason || "disabled",
    };
  }

  const stageResults = [];
  for (const stage of config.stages) {
    const result = await runStage({
      name: stage.name,
      total: stage.total,
      durationMs: stage.durationMs,
      concurrency: stage.concurrency,
      makeRequest: config.makeRequest,
    });
    stageResults.push(result);
    if (stage.pauseAfterMs) {
      // Cooldown between aggressive stages to avoid synthetic overlap noise.
      // eslint-disable-next-line no-await-in-loop
      await sleep(stage.pauseAfterMs);
    }
  }

  const summary = {
    totalRequests: stageResults.reduce((acc, s) => acc + s.executed, 0),
    completed: stageResults.reduce((acc, s) => acc + s.completed, 0),
    failed: stageResults.reduce((acc, s) => acc + s.failed, 0),
    statuses: stageResults.reduce((acc, s) => mergeCounters(acc, s.statuses), {}),
    errors: stageResults.reduce((acc, s) => mergeCounters(acc, s.errors), {}),
    latency: {
      p95Ms: Math.max(...stageResults.map((s) => s.latency.p95Ms), 0),
    },
  };

  const slo = evaluateSlo(summary, config.slo);
  return {
    name: config.name,
    skipped: false,
    stages: stageResults,
    summary,
    slo,
  };
}

function withPath(baseUrl, path, params) {
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v.length > 0) {
        url.searchParams.set(k, v);
      }
    }
  }
  return url.toString();
}

function parseProfile(rawProfile, quickMode) {
  if (quickMode) return "quick";
  const profile = (rawProfile || "standard").trim().toLowerCase();
  const allowed = new Set(["quick", "standard", "burst", "soak"]);
  return allowed.has(profile) ? profile : "standard";
}

function createStagesForProfile(profile) {
  switch (profile) {
    case "quick":
      return [{ name: "quick", total: 30, concurrency: 6 }];
    case "burst":
      return [
        { name: "warmup", total: 80, concurrency: 10, pauseAfterMs: 300 },
        { name: "burst", total: 1200, concurrency: 120, pauseAfterMs: 500 },
      ];
    case "soak":
      return [
        // ~4 minute steady run for drift/memory style checks.
        { name: "soak", durationMs: 4 * 60_000, concurrency: 12, pauseAfterMs: 500 },
      ];
    case "standard":
    default:
      return [
        { name: "low", total: 80, concurrency: 8, pauseAfterMs: 250 },
        { name: "medium", total: 240, concurrency: 24, pauseAfterMs: 300 },
        { name: "spike", total: 500, concurrency: 60 },
      ];
  }
}

function createChatStages(profile) {
  if (profile === "quick") {
    return [{ name: "quick", total: 3, concurrency: 1 }];
  }
  if (profile === "burst") {
    return [
      { name: "warmup", total: 6, concurrency: 2, pauseAfterMs: 250 },
      { name: "burst", total: 24, concurrency: 6 },
    ];
  }
  if (profile === "soak") {
    return [{ name: "soak", durationMs: 90_000, concurrency: 2 }];
  }
  return [
    { name: "low", total: 6, concurrency: 2, pauseAfterMs: 200 },
    { name: "medium", total: 12, concurrency: 3 },
  ];
}

function parseScenarioFilter(value) {
  if (!value) return null;
  const raw = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length > 0 ? new Set(raw) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const quickMode = args.get("quick") === "true";
  const profile = parseProfile(args.get("profile"), quickMode);
  const scenarioFilter = parseScenarioFilter(args.get("scenarios"));
  const baseUrl =
    args.get("base-url") ||
    process.env.RELIABILITY_BASE_URL ||
    process.env.CONVEX_SITE_URL ||
    process.env.VITE_CONVEX_SITE_URL;

  if (!baseUrl) {
    throw new Error(
      "Missing base URL. Set RELIABILITY_BASE_URL (or pass --base-url=https://...convex.site).",
    );
  }

  const startedAt = new Date().toISOString();
  const authToken =
    args.get("auth-token") || process.env.RELIABILITY_AUTH_TOKEN || "";
  const threadId = args.get("thread-id") || process.env.RELIABILITY_THREAD_ID || "";
  const gmailVerifyToken =
    args.get("gmail-token") || process.env.GMAIL_PUBSUB_VERIFY_TOKEN || "";
  const whatsappAppSecret =
    args.get("whatsapp-secret") || process.env.WHATSAPP_APP_SECRET || "";
  const stages = createStagesForProfile(profile);

  const scenarios = [
    {
      name: "gmail_push_webhook",
      enabled: !scenarioFilter || scenarioFilter.has("gmail_push_webhook"),
      stages,
      slo: {
        maxP95Ms: 1500,
        maxFiveXxRate: 0.01,
        maxNetworkErrorRate: 0.02,
        maxUnknownStatusRate: 0.05,
        allowedStatuses: [200, 400, 403, 429],
      },
      makeRequest: (i) => {
        const payload = {
          message: {
            data: Buffer.from(
              JSON.stringify({
                emailAddress: `loadtest+${i}@example.com`,
                historyId: `${Date.now()}-${i}`,
              }),
            ).toString("base64"),
          },
        };
        const url = withPath(baseUrl, "/api/gmail/push", {
          token: gmailVerifyToken || undefined,
        });
        return fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      },
    },
    {
      name: "whatsapp_webhook",
      enabled: !scenarioFilter || scenarioFilter.has("whatsapp_webhook"),
      stages,
      slo: {
        maxP95Ms: 1500,
        maxFiveXxRate: 0.01,
        maxNetworkErrorRate: 0.02,
        maxUnknownStatusRate: 0.05,
        allowedStatuses: [200, 400, 403, 429],
      },
      makeRequest: (i) => {
        const body = JSON.stringify({
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    messages: [
                      {
                        id: `wamid.load.${Date.now()}.${i}`,
                        from: "15551234567",
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "Load test webhook message" },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
        const headers = {
          "Content-Type": "application/json",
        };

        if (whatsappAppSecret) {
          const sig = createHmac("sha256", whatsappAppSecret)
            .update(body)
            .digest("hex");
          headers["x-hub-signature-256"] = `sha256=${sig}`;
        }

        return fetch(withPath(baseUrl, "/api/whatsapp/webhook"), {
          method: "POST",
          headers,
          body,
        });
      },
    },
    {
      name: "chat_stream_http",
      enabled:
        (!scenarioFilter || scenarioFilter.has("chat_stream_http")) &&
        Boolean(authToken && threadId),
      skipReason:
        "Set RELIABILITY_AUTH_TOKEN and RELIABILITY_THREAD_ID to enable chat load drill.",
      stages: createChatStages(profile),
      slo: {
        maxP95Ms: 12_000,
        maxFiveXxRate: 0.05,
        maxNetworkErrorRate: 0.05,
        maxUnknownStatusRate: 0.1,
        allowedStatuses: [200, 401, 429, 503],
      },
      makeRequest: () =>
        fetch(withPath(baseUrl, "/api/chat"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            threadId,
            modelId: "moonshotai/kimi-k2.5",
            webSearch: false,
          }),
        }),
    },
  ];

  const scenarioResults = [];
  for (const scenario of scenarios) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runScenario(scenario);
    scenarioResults.push(result);
  }

  const finishedAt = new Date().toISOString();
  const passed = scenarioResults
    .filter((r) => !r.skipped)
    .every((r) => r.slo?.pass === true);

  const report = {
    startedAt,
    finishedAt,
    baseUrl,
    quickMode,
    profile,
    scenarioFilter: scenarioFilter ? Array.from(scenarioFilter) : null,
    scenarios: scenarioResults,
    passed,
  };

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `load-drill-${profile}-${stamp}.json`);
  await writeFile(outputFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`Load drill completed. Overall pass: ${passed ? "YES" : "NO"}`);
  console.log(`Report: ${outputFile}`);
  for (const scenario of scenarioResults) {
    if (scenario.skipped) {
      console.log(`- ${scenario.name}: SKIPPED (${scenario.reason})`);
      continue;
    }
    console.log(
      `- ${scenario.name}: ${scenario.slo.pass ? "PASS" : "FAIL"} ` +
        `(p95=${scenario.summary.latency.p95Ms}ms, statuses=${JSON.stringify(
          scenario.summary.statuses,
        )})`,
    );
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Load drill failed:", error);
  process.exitCode = 1;
});
