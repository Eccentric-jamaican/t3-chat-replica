import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";
import { encrypt, decrypt, hmacSha256Hex, timingSafeEqual } from "./integrations/crypto";

const http = httpRouter();

// Build CORS allowed origins from environment variable
// Set ALLOWED_ORIGINS in Convex dashboard (comma-separated list)
// Falls back to localhost for development
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:3000"];

// Register Better Auth routes on the Convex HTTP router with CORS enabled
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins,
  },
  onRequest: (request) => {
    const url = new URL(request.url);
    console.log("[AUTH HTTP] Incoming request:", {
      method: request.method,
      path: url.pathname,
      timestamp: new Date().toISOString(),
    });
  },
  onResponse: (request, response) => {
    const url = new URL(request.url);
    console.log("[AUTH HTTP] Response:", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      timestamp: new Date().toISOString(),
    });
  },
});

// ── Gmail OAuth: Start ─────────────────────────────────────────────────

// ── Gmail OAuth: Callback ──────────────────────────────────────────────

http.route({
  path: "/api/gmail/auth/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const frontendUrl =
      process.env.ALLOWED_ORIGINS?.split(",")[0]?.trim() ||
      "http://localhost:3000";

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
      const tokenResponse = await fetch(
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
      );

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

      // Validate refresh token — Google omits it on re-auth unless
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
      const profileResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );

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
      return Response.redirect(
        `${frontendUrl}/settings?tab=connections&gmail=error`,
        302,
      );
    }
  }),
});

// ── Gmail Pub/Sub Push ─────────────────────────────────────────────────

http.route({
  path: "/api/gmail/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
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
          return new Response("Forbidden", { status: 403 });
        }
      }

      const body = await request.json();

      if (!body.message?.data) {
        return new Response("Invalid push notification", { status: 400 });
      }

      // Decode the Pub/Sub base64 message
      let data: { emailAddress?: string; historyId?: string };
      try {
        data = JSON.parse(atob(body.message.data));
      } catch {
        return new Response("Malformed base64 or JSON in message.data", {
          status: 400,
        });
      }
      const { emailAddress, historyId } = data;

      if (!emailAddress || !historyId) {
        return new Response("Missing emailAddress or historyId", {
          status: 400,
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
      return new Response("Internal error", { status: 500 });
    }
  }),
});

// ── WhatsApp Webhook: Verification ─────────────────────────────────────

http.route({
  path: "/api/whatsapp/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }),
});

// ── WhatsApp Webhook: Message Handler ──────────────────────────────────

http.route({
  path: "/api/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("x-hub-signature-256");
    const body = await request.text();

    // Verify HMAC signature
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret || !signature) {
      return new Response("Missing signature or secret", { status: 403 });
    }

    const hex = await hmacSha256Hex(secret, body);
    const expectedSignature = `sha256=${hex}`;
    if (!timingSafeEqual(signature, expectedSignature)) {
      return new Response("Invalid signature", { status: 403 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Malformed JSON body", { status: 400 });
    }

    // Schedule async processing
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.whatsapp.processWebhook,
      { payload },
    );

    return new Response("OK", { status: 200 });
  }),
});

export default http;
