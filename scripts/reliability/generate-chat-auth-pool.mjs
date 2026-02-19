#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { parseArgs } from "./parseArgs.mjs";

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractCookieHeader(response) {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .filter(Boolean);
    return cookies.join("; ");
  }
  const raw = response.headers.get("set-cookie");
  if (!raw) return "";
  // Split only at cookie boundaries, not inside Expires date values.
  return raw
    .split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function buildEmail(prefix, seed, index) {
  return `${prefix}-${seed}-${String(index).padStart(4, "0")}@example.com`;
}

function normalizeOrigin(appOrigin) {
  return appOrigin.trim().replace(/\/+$/, "");
}

async function postJson(url, payload, appOrigin) {
  const origin = normalizeOrigin(appOrigin);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin,
      referer: `${origin}/`,
    },
    body: JSON.stringify(payload),
  });
}

async function trySignIn({ appOrigin, email, password }) {
  const response = await postJson(
    `${appOrigin}/api/auth/sign-in/email`,
    {
      email,
      password,
      rememberMe: true,
    },
    appOrigin,
  );
  if (response.status !== 200) return null;
  const cookieHeader = extractCookieHeader(response);
  return cookieHeader || null;
}

async function signUp({ appOrigin, email, password, name }) {
  const response = await postJson(
    `${appOrigin}/api/auth/sign-up/email`,
    {
      name,
      email,
      password,
    },
    appOrigin,
  );

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(
      `sign-up failed for ${email} (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  const cookieHeader = extractCookieHeader(response);
  if (!cookieHeader) {
    throw new Error(`sign-up did not return session cookies for ${email}`);
  }
  return cookieHeader;
}

async function fetchConvexToken({ appOrigin, cookieHeader }) {
  const origin = normalizeOrigin(appOrigin);
  const response = await fetch(`${appOrigin}/api/auth/convex/token`, {
    method: "GET",
    headers: {
      cookie: cookieHeader,
      origin,
      referer: `${origin}/`,
    },
  });
  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(
      `convex token fetch failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = await response.json();
  if (!data?.token || typeof data.token !== "string") {
    throw new Error("convex token response missing token");
  }
  return data.token;
}

async function createThread({ convexUrl, token, sessionId, title, modelId }) {
  const convex = new ConvexHttpClient(convexUrl, { logger: false });
  convex.setAuth(token);
  return await convex.mutation("threads:create", {
    title,
    modelId,
    parentThreadId: undefined,
    sessionId,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appOrigin =
    args.get("app-origin") || process.env.RELIABILITY_APP_ORIGIN || "http://localhost:3000";
  const convexUrl =
    args.get("convex-url") ||
    process.env.RELIABILITY_CONVEX_URL ||
    process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error(
      "Missing convex URL. Set --convex-url or RELIABILITY_CONVEX_URL (or VITE_CONVEX_URL).",
    );
  }

  const count = Math.max(1, Math.round(toNumber(args.get("count"), 20)));
  const startIndex = Math.max(
    1,
    Math.round(toNumber(args.get("start-index"), 1)),
  );
  const password =
    args.get("password") || process.env.RELIABILITY_LOADTEST_PASSWORD || "Loadtest1234";
  const prefix = (args.get("prefix") || "loadtest").trim().toLowerCase();
  const seed =
    args.get("seed") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const modelId = args.get("model-id") || "moonshotai/kimi-k2.5";
  const threadTitlePrefix =
    args.get("thread-title-prefix") || "Load test thread";
  const outputArg = args.get("output");

  const outputDir = resolve(".output", "reliability");
  await mkdir(outputDir, { recursive: true });
  const outputPath =
    outputArg ||
    resolve(
      outputDir,
      `chat-auth-pool-${prefix}-${seed}-${startIndex}-${count}.json`,
    );

  const pool = [];
  const startedAt = Date.now();

  for (let i = 0; i < count; i += 1) {
    const ordinal = startIndex + i;
    const email = buildEmail(prefix, seed, ordinal);
    const userLabel = `u${ordinal}`;
    let cookieHeader = await trySignIn({ appOrigin, email, password });
    let source = "sign-in";
    if (!cookieHeader) {
      cookieHeader = await signUp({
        appOrigin,
        email,
        password,
        name: `Load User ${ordinal}`,
      });
      source = "sign-up";
    }

    const authToken = await fetchConvexToken({ appOrigin, cookieHeader });
    const threadId = await createThread({
      convexUrl,
      token: authToken,
      sessionId: `loadtest-${seed}-${ordinal}-${Date.now()}`,
      title: `${threadTitlePrefix} ${ordinal}`,
      modelId,
    });

    pool.push({
      userLabel,
      email,
      threadId,
      authToken,
      source,
    });

    if ((i + 1) % 10 === 0 || i === count - 1) {
      console.log(`Prepared ${i + 1}/${count} users`);
    }
  }

  await writeFile(outputPath, JSON.stringify(pool, null, 2), "utf8");
  const durationMs = Date.now() - startedAt;
  console.log(`Chat auth pool generated: ${outputPath}`);
  console.log(`Users: ${pool.length}, durationMs: ${durationMs}`);
}

main().catch((error) => {
  console.error("Failed to generate chat auth pool:", error);
  process.exitCode = 1;
});
