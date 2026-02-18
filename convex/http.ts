import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { encrypt, decrypt, hmacSha256Hex, timingSafeEqual } from "./integrations/crypto";
import { chatHandler } from "./chatHttp";
import { fetchWithRetry } from "./lib/network";
import {
  assertCircuitClosed,
  recordCircuitError,
  recordCircuitResponse,
} from "./lib/circuitBreaker";
import {
  acquireBulkheadSlot,
  isBulkheadSaturatedError,
  releaseBulkheadSlot,
} from "./lib/bulkhead";
import {
  gmailPushEnvelopeSchema,
  gmailHistoryPayloadSchema,
  whatsappWebhookSchema,
} from "./lib/httpContracts";
import {
  createHttpErrorResponse,
  formatValidationIssues,
} from "./lib/httpErrors";
import {
  getRateLimits,
  buildRateLimitErrorMessage,
  buildRetryAfterSeconds,
  isRateLimitContentionError,
} from "./lib/rateLimit";

const http = httpRouter();

// Build CORS allowed origins from environment variable
// Set ALLOWED_ORIGINS in Convex dashboard (comma-separated list)
// Falls back to localhost for development
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : [
      "http://localhost:3000",
      "http://localhost:3100",
      "http://localhost:5173",
    ];

const GMAIL_PUSH_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_MESSAGE_REPLAY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_WEBHOOK_PAYLOAD_BYTES = 256 * 1024;
const MAX_OAUTH_PARAM_LENGTH = 4096;

function getContentLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function enforceJsonRequestGuards(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return createHttpErrorResponse({
      status: 415,
      code: "unsupported_media_type",
      message: "Content-Type must be application/json",
    });
  }

  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    return createHttpErrorResponse({
      status: 413,
      code: "payload_too_large",
      message: "Request payload too large",
    });
  }

  return null;
}

function isAllowedOrigin(origin: string | null) {
  return !!origin && allowedOrigins.includes(origin);
}

function getClientIp(request: Request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor && xForwardedFor.trim()) {
    const first = xForwardedFor.split(",")[0];
    if (first && first.trim()) return first.trim();
  }

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp && xRealIp.trim()) return xRealIp.trim();

  return "unknown";
}

async function claimReplayProtectionKey(
  ctx: any,
  scope: string,
  key: string,
  ttlMs: number,
) {
  try {
    return await ctx.runMutation(internal.idempotency.claimKey, {
      scope,
      key,
      ttlMs,
    });
  } catch (error) {
    // Fail-open: webhook processing should continue even if replay tracking is unavailable.
    console.error("[Idempotency] claimKey failed", { scope, key, error });
    return { duplicate: false } as const;
  }
}

async function dedupeWhatsappMessages(ctx: any, payload: { entry: any[] }) {
  const dedupedEntries: any[] = [];
  let newMessages = 0;
  let duplicateMessages = 0;

  for (const entry of payload.entry ?? []) {
    const dedupedChanges: any[] = [];

    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;

      const messages = Array.isArray(change?.value?.messages)
        ? change.value.messages
        : [];
      if (messages.length === 0) continue;

      const dedupedMessages: any[] = [];
      for (const message of messages) {
        const messageId =
          typeof message?.id === "string" && message.id.trim()
            ? message.id.trim()
            : null;

        if (!messageId) {
          dedupedMessages.push(message);
          newMessages += 1;
          continue;
        }

        const claimed = await claimReplayProtectionKey(
          ctx,
          "whatsapp_message",
          messageId,
          WHATSAPP_MESSAGE_REPLAY_TTL_MS,
        );
        if (claimed.duplicate) {
          duplicateMessages += 1;
          continue;
        }

        dedupedMessages.push(message);
        newMessages += 1;
      }

      if (dedupedMessages.length === 0) continue;
      dedupedChanges.push({
        ...change,
        value: {
          ...(change?.value ?? {}),
          messages: dedupedMessages,
        },
      });
    }

    if (dedupedChanges.length === 0) continue;
    dedupedEntries.push({
      ...(entry ?? {}),
      changes: dedupedChanges,
    });
  }

  return {
    payload: {
      ...payload,
      entry: dedupedEntries,
    },
    newMessages,
    duplicateMessages,
  };
}

async function emitRateLimitEvent(
  ctx: any,
  event: {
    source: "http";
    bucket: string;
    key: string;
    outcome: "blocked" | "contention_fallback";
    retryAfterMs?: number;
    path?: string;
    method?: string;
  },
) {
  try {
    await ctx.scheduler.runAfter(0, internal.rateLimit.recordEvent, event);
  } catch {
    // Observability must never block request handling.
  }
}

async function enforceHttpRateLimit(
  ctx: any,
  request: Request,
  bucket: string,
  max: number,
  windowMs: number,
) {
  const ip = getClientIp(request);
  const key = `${bucket}:ip:${ip}`;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  let result;
  try {
    result = await ctx.runMutation(internal.rateLimit.checkAndIncrement, {
      key,
      max,
      windowMs,
    });
  } catch (error) {
    // Under extremely high concurrency, Convex OCC retries can still fail.
    // Fail closed (429) instead of leaking a 500.
    if (isRateLimitContentionError(error)) {
      console.warn(`[RateLimit] ${bucket} contention fallback`, { ip });
      await emitRateLimitEvent(ctx, {
        source: "http",
        bucket,
        key,
        outcome: "contention_fallback",
        retryAfterMs: 1000,
        path,
        method,
      });
      return createHttpErrorResponse({
        status: 429,
        code: "rate_limited",
        message: "Too many requests. Please retry in a moment.",
        headers: { "Retry-After": "1" },
      });
    }
    throw error;
  }

  if (result.allowed) return null;

  console.warn(`[RateLimit] ${bucket} limit exceeded`, {
    ip,
    retryAfterMs: result.retryAfterMs,
  });
  await emitRateLimitEvent(ctx, {
    source: "http",
    bucket,
    key,
    outcome: "blocked",
    retryAfterMs: result.retryAfterMs,
    path,
    method,
  });

  return createHttpErrorResponse({
    status: 429,
    code: "rate_limited",
    message: buildRateLimitErrorMessage(result.retryAfterMs),
    headers: {
      "Retry-After": buildRetryAfterSeconds(result.retryAfterMs),
    },
  });
}

// Register Better Auth routes on the Convex HTTP router with CORS enabled
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins,
  },
});

// ── Gmail OAuth: Start ─────────────────────────────────────────────────

// ── Gmail OAuth: Callback ──────────────────────────────────────────────

export async function gmailOAuthCallbackHandler(ctx: any, request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const frontendUrl =
    process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() ||
    "http://localhost:3000";
  const rateLimits = getRateLimits();

  const rateLimitResponse = await enforceHttpRateLimit(
    ctx,
    request,
    "gmail_oauth_callback",
    rateLimits.gmailOAuthCallback.max,
    rateLimits.gmailOAuthCallback.windowMs,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  if (
    (typeof code === "string" && code.length > MAX_OAUTH_PARAM_LENGTH) ||
    (typeof state === "string" && state.length > MAX_OAUTH_PARAM_LENGTH) ||
    (typeof error === "string" && error.length > 512)
  ) {
    return Response.redirect(
      `${frontendUrl}/settings?tab=connections&gmail=error`,
      302,
    );
  }

  if (error || !code || !state) {
    return Response.redirect(
      `${frontendUrl}/settings?tab=connections&gmail=error`,
      302,
    );
  }

  try {
    // Decrypt state to recover userId
    const stateData = JSON.parse(await decrypt(decodeURIComponent(state)));

    // Validate state payload before using it
    if (
      typeof stateData !== "object" ||
      stateData === null ||
      typeof stateData.userId !== "string" ||
      !stateData.userId ||
      typeof stateData.ts !== "number" ||
      !Number.isFinite(stateData.ts)
    ) {
      console.error("[Gmail OAuth] Invalid state payload:", stateData);
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=error`,
        302,
      );
    }

    const userId: string = stateData.userId;

    // Verify state is not stale (10 minute max)
    if (Date.now() - stateData.ts > 600_000) {
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=expired`,
        302,
      );
    }

    // Exchange authorization code for tokens
    const siteUrl = process.env.CONVEX_SITE_URL;
    const gmailTokenLease = await acquireBulkheadSlot(ctx, "gmail_oauth");
    let tokenResponse: Response;
    try {
      await assertCircuitClosed(ctx, "gmail_oauth");
      tokenResponse = await fetchWithRetry(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
            client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
            code,
            grant_type: "authorization_code",
            redirect_uri: `${siteUrl}/api/gmail/auth/callback`,
          }),
        },
        {
          timeoutMs: 10_000,
          retries: 2,
        },
      );
      await recordCircuitResponse(ctx, "gmail_oauth", tokenResponse.status);
    } catch (error) {
      await recordCircuitError(ctx, "gmail_oauth", error);
      throw error;
    } finally {
      await releaseBulkheadSlot(ctx, "gmail_oauth", gmailTokenLease);
    }

    if (!tokenResponse.ok) {
      console.error(
        "[Gmail OAuth] Token exchange failed:",
        tokenResponse.status,
      );
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=error`,
        302,
      );
    }

    const tokens = await tokenResponse.json();

    // Validate refresh token - Google omits it on re-auth unless
    // prompt=consent was set. Fail early so the caller can retry.
    if (!tokens.refresh_token) {
      console.error(
        "[Gmail OAuth] No refresh_token returned. " +
          "The user may need to re-authenticate with prompt=consent.",
      );
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=reauth`,
        302,
      );
    }

    // Get user's email and historyId from Gmail profile
    const gmailProfileLease = await acquireBulkheadSlot(ctx, "gmail_oauth");
    let profileResponse: Response;
    try {
      await assertCircuitClosed(ctx, "gmail_oauth");
      profileResponse = await fetchWithRetry(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        {
          timeoutMs: 10_000,
          retries: 2,
        },
      );
      await recordCircuitResponse(ctx, "gmail_oauth", profileResponse.status);
    } catch (error) {
      await recordCircuitError(ctx, "gmail_oauth", error);
      throw error;
    } finally {
      await releaseBulkheadSlot(ctx, "gmail_oauth", gmailProfileLease);
    }

    if (!profileResponse.ok) {
      const profileError = await profileResponse.text();
      console.error(
        "[Gmail OAuth] Profile fetch failed:",
        profileResponse.status,
        profileError,
      );
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=error`,
        302,
      );
    }

    const profile = await profileResponse.json();

    if (!profile.emailAddress || !profile.historyId) {
      console.error(
        "[Gmail OAuth] Profile response missing required fields:",
        {
          hasEmail: !!profile.emailAddress,
          hasHistoryId: !!profile.historyId,
        },
      );
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=error`,
        302,
      );
    }

    // Encrypt refresh token and store connection
    const encryptedRefreshToken = await encrypt(tokens.refresh_token);

    await ctx.runMutation(
      internal.integrations.gmail.oauth.storeGmailConnection,
      {
        userId,
        email: profile.emailAddress,
        encryptedRefreshToken,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        historyId: profile.historyId,
      },
    );

    // Schedule initial sync (backfill last 30 days)
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.gmail.sync.syncGmail,
      // One-time backfill on connect: cover recent orders/shipments that may
      // have arrived weeks before the user linked their inbox.
      { userId, daysBack: 30 },
    );

    return Response.redirect(
      `${frontendUrl}/settings?tab=connections&gmail=connected`,
      302,
    );
  } catch (err) {
    console.error("[Gmail OAuth] Callback error:", err);
    if (isBulkheadSaturatedError(err)) {
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=busy`,
        302,
      );
    }
    return Response.redirect(
      `${frontendUrl}/settings?tab=connections&gmail=error`,
      302,
    );
  }
}

http.route({
  path: "/api/gmail/auth/callback",
  method: "GET",
  handler: httpAction(gmailOAuthCallbackHandler),
});

// ── Gmail Pub/Sub Push ─────────────────────────────────────────────────

export async function gmailPushHandler(ctx: any, request: Request) {
  try {
    const requestGuard = enforceJsonRequestGuards(
      request,
      MAX_WEBHOOK_PAYLOAD_BYTES,
    );
    if (requestGuard) {
      return requestGuard;
    }

    const rateLimits = getRateLimits();
    const rateLimitResponse = await enforceHttpRateLimit(
      ctx,
      request,
      "gmail_push",
      rateLimits.gmailPushWebhook.max,
      rateLimits.gmailPushWebhook.windowMs,
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const expectedToken = process.env.GMAIL_PUBSUB_VERIFY_TOKEN;
    if (expectedToken) {
      const url = new URL(request.url);
      const headerToken =
        request.headers.get("x-pubsub-token") ||
        request.headers.get("x-gmail-pubsub-token") ||
        request.headers
          .get("authorization")
          ?.replace(/^Bearer\s+/i, "") ||
        null;
      const queryToken = url.searchParams.get("token");
      const token = headerToken ?? queryToken ?? "";
      if (token !== expectedToken) {
        return createHttpErrorResponse({
          status: 403,
          code: "forbidden",
          message: "Forbidden",
        });
      }
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return createHttpErrorResponse({
        status: 400,
        code: "invalid_json",
        message: "Invalid JSON body",
      });
    }
    const parsed = gmailPushEnvelopeSchema.safeParse(rawBody);
    if (!parsed.success) {
      return createHttpErrorResponse({
        status: 400,
        code: "invalid_request",
        message: `Invalid push notification: ${formatValidationIssues(parsed.error)}`,
      });
    }

    // Decode the Pub/Sub base64 message
    let decodedData: unknown;
    try {
      decodedData = JSON.parse(atob(parsed.data.message.data));
    } catch {
      return createHttpErrorResponse({
        status: 400,
        code: "invalid_request",
        message: "Malformed base64 or JSON in message.data",
      });
    }
    const payload = gmailHistoryPayloadSchema.safeParse(decodedData);
    if (!payload.success) {
      return createHttpErrorResponse({
        status: 400,
        code: "invalid_request",
        message: `Missing emailAddress or historyId: ${formatValidationIssues(
          payload.error,
        )}`,
      });
    }
    const { emailAddress, historyId } = payload.data;

    const replayKey = `${emailAddress}:${historyId}`;
    const claimed = await claimReplayProtectionKey(
      ctx,
      "gmail_push_history",
      replayKey,
      GMAIL_PUSH_REPLAY_TTL_MS,
    );
    if (claimed.duplicate) {
      return new Response("OK", {
        status: 200,
        headers: { "X-Idempotent-Replay": "1" },
      });
    }

    // Schedule incremental sync
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.gmail.sync.incrementalSync,
      { emailAddress, newHistoryId: historyId },
    );

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[Gmail Push] Error:", err);
    return createHttpErrorResponse({
      status: 500,
      code: "internal_error",
      message: "Internal error",
    });
  }
}

http.route({
  path: "/api/gmail/push",
  method: "POST",
  handler: httpAction(gmailPushHandler),
});

// ── WhatsApp Webhook: Verification ─────────────────────────────────────

export async function whatsappWebhookVerifyHandler(
  _ctx: any,
  request: Request,
) {
  const url = new URL(request.url);
  const modeValue = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (modeValue === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return createHttpErrorResponse({
    status: 403,
    code: "forbidden",
    message: "Forbidden",
  });
}

http.route({
  path: "/api/whatsapp/webhook",
  method: "GET",
  handler: httpAction(whatsappWebhookVerifyHandler),
});

// ── WhatsApp Webhook: Message Handler ──────────────────────────────────

export async function whatsappWebhookPostHandler(ctx: any, request: Request) {
  const requestGuard = enforceJsonRequestGuards(
    request,
    MAX_WEBHOOK_PAYLOAD_BYTES,
  );
  if (requestGuard) {
    return requestGuard;
  }

  const rateLimits = getRateLimits();
  const rateLimitResponse = await enforceHttpRateLimit(
    ctx,
    request,
    "whatsapp_webhook",
    rateLimits.whatsappWebhook.max,
    rateLimits.whatsappWebhook.windowMs,
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const signature = request.headers.get("x-hub-signature-256");
  const body = await request.text();

  // Verify HMAC signature
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature) {
    return createHttpErrorResponse({
      status: 403,
      code: "forbidden",
      message: "Missing signature or secret",
    });
  }

  const hex = await hmacSha256Hex(secret, body);
  const expectedSignature = `sha256=${hex}`;
  if (!timingSafeEqual(signature, expectedSignature)) {
    return createHttpErrorResponse({
      status: 403,
      code: "forbidden",
      message: "Invalid signature",
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return createHttpErrorResponse({
      status: 400,
      code: "invalid_json",
      message: "Malformed JSON body",
    });
  }
  const parsed = whatsappWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return createHttpErrorResponse({
      status: 400,
      code: "invalid_request",
      message: `Invalid webhook payload: ${formatValidationIssues(parsed.error)}`,
    });
  }

  const deduped = await dedupeWhatsappMessages(ctx, parsed.data);
  if (deduped.newMessages === 0) {
    return new Response("OK", {
      status: 200,
      headers: { "X-Idempotent-Replay": "1" },
    });
  }

  // Schedule async processing
  await ctx.scheduler.runAfter(
    0,
    internal.integrations.whatsapp.processWebhook,
    { payload: deduped.payload },
  );

  return new Response("OK", { status: 200 });
}

http.route({
  path: "/api/whatsapp/webhook",
  method: "POST",
  handler: httpAction(whatsappWebhookPostHandler),
});

// ── Chat: Streaming SSE ────────────────────────────────────────────────

export async function chatOptionsHandler(_ctx: any, request: Request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers();
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(null, { status: 204, headers });
}

http.route({
  path: "/api/chat",
  method: "OPTIONS",
  handler: httpAction(chatOptionsHandler),
});

export async function chatPostHandler(ctx: any, request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && !isAllowedOrigin(origin)) {
    return createHttpErrorResponse({
      status: 403,
      code: "forbidden",
      message: "Forbidden origin",
    });
  }

  let response: Response;
  try {
    response = await chatHandler(ctx, request);
  } catch (error) {
    console.error("[/api/chat] Unhandled error", error);
    response = createHttpErrorResponse({
      status: 500,
      code: "internal_error",
      message: "Internal error",
    });
  }
  if (origin && isAllowedOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return response;
}

http.route({
  path: "/api/chat",
  method: "POST",
  handler: httpAction(chatPostHandler),
});

export default http;
