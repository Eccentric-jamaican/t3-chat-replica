#!/usr/bin/env node
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

function withPath(baseUrl, path, params) {
  const url = new URL(path, baseUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

function getHeader(headers, key) {
  return headers.get(key) ?? headers.get(key.toLowerCase()) ?? null;
}

async function runProbe(probe) {
  const startedAt = Date.now();
  try {
    const response = await probe.request();
    const latencyMs = Date.now() - startedAt;
    const evaluation = probe.evaluate(response);
    if (response.body) {
      await response.body.cancel();
    }
    return {
      name: probe.name,
      pass: evaluation.pass,
      latencyMs,
      status: response.status,
      details: evaluation.details,
    };
  } catch (error) {
    return {
      name: probe.name,
      pass: false,
      latencyMs: Date.now() - startedAt,
      status: null,
      details: error instanceof Error ? error.message : String(error),
    };
  }
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

  const probeOrigin = args.get("origin") || process.env.RELIABILITY_PROBE_ORIGIN || "https://www.sendcat.app";
  const gmailToken =
    args.get("gmail-token") || process.env.GMAIL_PUBSUB_VERIFY_TOKEN || "";

  const probes = [
    {
      name: "chat_options_cors",
      request: () =>
        fetch(withPath(baseUrl, "/api/chat"), {
          method: "OPTIONS",
          headers: {
            Origin: probeOrigin,
            "Access-Control-Request-Method": "POST",
          },
        }),
      evaluate: (response) => {
        const allowOrigin = getHeader(response.headers, "access-control-allow-origin");
        const statusOk = response.status === 200 || response.status === 204;
        const headerOk = allowOrigin === probeOrigin;
        return {
          pass: statusOk && headerOk,
          details: {
            expectedStatus: [200, 204],
            status: response.status,
            expectedAllowOrigin: probeOrigin,
            actualAllowOrigin: allowOrigin,
          },
        };
      },
    },
    {
      name: "chat_requires_auth",
      request: () =>
        fetch(withPath(baseUrl, "/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: probeOrigin },
          body: JSON.stringify({
            threadId: "jprobe0000000000000000000000000000",
            content: "synthetic probe",
            modelId: "moonshotai/kimi-k2.5",
            webSearch: false,
          }),
        }),
      evaluate: (response) => ({
        pass: response.status === 401,
        details: {
          expectedStatus: [401],
          status: response.status,
        },
      }),
    },
    {
      name: "gmail_push_guard",
      request: () =>
        fetch(
          withPath(baseUrl, "/api/gmail/push", gmailToken ? { token: gmailToken } : undefined),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                data: Buffer.from(
                  JSON.stringify({
                    emailAddress: "probe@example.com",
                    historyId: `${Date.now()}`,
                  }),
                ).toString("base64"),
              },
            }),
          },
        ),
      evaluate: (response) => ({
        pass: [200, 403, 429].includes(response.status),
        details: {
          expectedStatus: [200, 403, 429],
          status: response.status,
        },
      }),
    },
    {
      name: "whatsapp_verify_guard",
      request: () =>
        fetch(
          withPath(baseUrl, "/api/whatsapp/webhook", {
            "hub.mode": "subscribe",
            "hub.verify_token": "probe-invalid-token",
            "hub.challenge": "probe",
          }),
          { method: "GET" },
        ),
      evaluate: (response) => ({
        pass: response.status === 403,
        details: {
          expectedStatus: [403],
          status: response.status,
        },
      }),
    },
    {
      name: "whatsapp_post_guard",
      request: () =>
        fetch(withPath(baseUrl, "/api/whatsapp/webhook"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry: [
              {
                changes: [
                  {
                    field: "messages",
                    value: { messages: [] },
                  },
                ],
              },
            ],
          }),
        }),
      evaluate: (response) => ({
        pass: [400, 403, 429].includes(response.status),
        details: {
          expectedStatus: [400, 403, 429],
          status: response.status,
        },
      }),
    },
  ];

  const startedAt = new Date().toISOString();
  const results = [];
  for (const probe of probes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runProbe(probe);
    results.push(result);
  }
  const finishedAt = new Date().toISOString();
  const passed = results.every((result) => result.pass);

  const report = {
    startedAt,
    finishedAt,
    baseUrl,
    probeOrigin,
    probes: results,
    passed,
  };

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `synthetic-probes-${stamp}.json`);
  await writeFile(outputFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`Synthetic probes completed. Overall pass: ${passed ? "YES" : "NO"}`);
  console.log(`Report: ${outputFile}`);
  for (const probe of results) {
    console.log(
      `- ${probe.name}: ${probe.pass ? "PASS" : "FAIL"} ` +
        `(status=${probe.status ?? "error"}, latency=${probe.latencyMs}ms)`,
    );
  }

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Synthetic probes failed:", error);
  process.exitCode = 1;
});
