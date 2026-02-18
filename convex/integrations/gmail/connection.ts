import { query, mutation, action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "../../auth";
import { encrypt } from "../crypto";
import { requireAuthenticatedUserId } from "../../lib/authGuards";

/**
 * Returns the current user's Gmail connection status.
 */
export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const connection = await ctx.db
      .query("integrationsGmail")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!connection || connection.status === "disconnected") {
      return { connected: false as const };
    }

    return {
      connected: true as const,
      email: connection.email,
      status: connection.status,
      lastSyncAt: connection.lastSyncAt,
      connectedAt: connection.connectedAt,
    };
  },
});

/**
 * Disconnects the current user's Gmail integration.
 */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.gmail.connection.disconnect",
    );

    const connection = await ctx.db
      .query("integrationsGmail")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});

/**
 * Builds the Gmail OAuth URL for the current user.
 * Uses auth identity to avoid userId spoofing.
 */
export const startOAuth = action({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.gmail.connection.startOAuth",
    );

    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!clientId || !siteUrl) {
      throw new Error("Gmail OAuth not configured");
    }

    const redirectUri = `${siteUrl}/api/gmail/auth/callback`;
    const state = await encrypt(JSON.stringify({ userId, ts: Date.now() }));

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", encodeURIComponent(state));

    return authUrl.toString();
  },
});

/**
 * Manually triggers a Gmail sync for the current user.
 */
export const triggerSync = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.gmail.connection.triggerSync",
    );

    return await ctx.runAction(internal.integrations.gmail.sync.syncGmail as any, {
      userId,
      daysBack: 30,
    });
  },
});
