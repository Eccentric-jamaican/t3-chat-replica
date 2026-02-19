import { betterAuth } from "better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { createClient, type CreateAuth, type AuthFunctions } from "@convex-dev/better-auth";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import authConfig from "./auth.config";
import { sendEmail } from "./integrations/email";
import {
  buildResetPasswordEmail,
  buildWelcomeEmail,
} from "./integrations/emailTemplates/content";

// AuthFunctions must reference the auth module for triggers to work
const authFunctions: AuthFunctions = internal.auth;

// PII redaction helpers - masks sensitive data in logs
const maskEmail = (email: string): string => {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  const maskedLocal = local.length > 2
    ? `${local[0]}***${local[local.length - 1]}`
    : "***";
  return `${maskedLocal}@${domain}`;
};

const maskName = (name: string | null | undefined): string => {
  if (!name) return "***";
  return name.length > 2 ? `${name[0]}***` : "***";
};

const truncateId = (id: string): string => {
  if (!id) return "***";
  return id.length > 8 ? `${id.slice(0, 4)}...${id.slice(-4)}` : id;
};

// Only emit verbose logs in development (set CONVEX_DEBUG_LOGS=true in Convex dashboard)
const isDebugMode = process.env.CONVEX_DEBUG_LOGS === "true";
const BRAND_COLOR = "#111827";
const SUPPORT_REPLY_TO = "support@mail.sendcat.app";
const DEFAULT_FROM = "SendCat <no-reply@mail.sendcat.app>";
const WELCOME_FROM = "SendCat <hi@mail.sendcat.app>";

const getAppUrl = (): string => {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [];
  const productionOrigin = allowedOrigins.find((o) => !o.includes("localhost"));
  return productionOrigin || "https://sendcat.app";
};

export const sendWelcomeEmailInternal = internalAction({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    try {
      const appUrl = getAppUrl();
      const { html, text } = buildWelcomeEmail({
        name: args.name,
        appUrl,
        brandColor: BRAND_COLOR,
      });
      await sendEmail({
        to: args.email,
        subject: "Welcome to SendCat",
        html,
        text,
        replyTo: SUPPORT_REPLY_TO,
        from: process.env.WELCOME_EMAIL_FROM || WELCOME_FROM,
      });
      if (isDebugMode) {
        console.log("[AUTH EMAIL] Welcome email sent:", maskEmail(args.email));
      }
    } catch (error) {
      console.error("[AUTH EMAIL] Failed to send welcome email:", error);
    }
  },
});

/**
 * The auth component client - provides adapter, route registration, and helper methods.
 * Includes triggers to sync Better Auth users to the app's profiles table.
 */
export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, doc) => {
        if (isDebugMode) {
          console.log("[AUTH TRIGGER] onCreate - New user registered:", {
            userId: truncateId(doc._id),
            email: maskEmail(doc.email),
            name: maskName(doc.name),
            timestamp: new Date().toISOString(),
          });
        }
        const profileId = await ctx.db.insert("profiles", {
          sessionId: `auth-${doc._id}`,
          userId: doc._id,
          email: doc.email,
          fullName: doc.name ?? (doc.email ? doc.email.split("@")[0] : "User"),
        });
        if (isDebugMode) {
          console.log("[AUTH TRIGGER] onCreate - Profile created:", {
            profileId: truncateId(profileId),
            userId: truncateId(doc._id),
          });
        }

        await ctx.scheduler.runAfter(0, internal.auth.sendWelcomeEmailInternal, {
          email: doc.email,
          name: doc.name ?? undefined,
        });
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        if (isDebugMode) {
          console.log("[AUTH TRIGGER] onUpdate - User updated:", {
            userId: truncateId(newDoc._id),
            changes: {
              email: oldDoc.email !== newDoc.email ? `${maskEmail(oldDoc.email)} -> ${maskEmail(newDoc.email)}` : "unchanged",
              name: oldDoc.name !== newDoc.name ? `${maskName(oldDoc.name)} -> ${maskName(newDoc.name)}` : "unchanged",
            },
            timestamp: new Date().toISOString(),
          });
        }
        if (newDoc.email !== oldDoc.email || newDoc.name !== oldDoc.name) {
          const existing = await ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", newDoc._id))
            .unique();
          if (existing) {
            await ctx.db.patch(existing._id, {
              email: newDoc.email,
              fullName: newDoc.name ?? existing.fullName,
            });
            if (isDebugMode) {
              console.log("[AUTH TRIGGER] onUpdate - Profile synced:", {
                profileId: truncateId(existing._id),
                userId: truncateId(newDoc._id),
              });
            }
          } else if (isDebugMode) {
            console.log("[AUTH TRIGGER] onUpdate - No profile found for user:", truncateId(newDoc._id));
          }
        }
      },
      onDelete: async (ctx, doc) => {
        if (isDebugMode) {
          console.log("[AUTH TRIGGER] onDelete - User deleted:", {
            userId: truncateId(doc._id),
            email: maskEmail(doc.email),
            timestamp: new Date().toISOString(),
          });
        }
        const existing = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", doc._id))
          .unique();
        if (existing) {
          await ctx.db.delete(existing._id);
          if (isDebugMode) {
            console.log("[AUTH TRIGGER] onDelete - Profile deleted:", {
              profileId: truncateId(existing._id),
              userId: truncateId(doc._id),
            });
          }
        } else if (isDebugMode) {
          console.log("[AUTH TRIGGER] onDelete - No profile found for user:", truncateId(doc._id));
        }
      },
    },
  },
});

// Export the trigger API mutations - required for triggers to work
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

// Export helper to get authenticated user in queries/mutations
export const { getAuthUser, safeGetAuthUser } = authComponent;

/**
 * Lightweight auth check — extracts user ID from the JWT token
 * with ZERO database queries. The JWT is already cryptographically
 * validated by Convex infrastructure.
 *
 * Use this instead of safeGetAuthUser() when you only need the
 * user ID for access control (not email, name, or other fields).
 *
 * Returns null for anonymous (unauthenticated) users.
 */
export async function getAuthUserId(
  ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

/**
 * Creates a Better Auth instance configured for Convex.
 * Used by the HTTP router to handle auth requests.
 * @param ctx - The Convex context
 */
// Dynamically determine base URL from ALLOWED_ORIGINS
// Prefers production URL for OAuth callbacks since Google needs a fixed redirect URI
// Local development will still work because:
// 1. Client-side uses window.location.origin for API calls
// 2. Sessions are stored in Convex (shared between environments)
// 3. After OAuth, Better Auth redirects based on the request origin stored in state
const getBaseURL = (): string => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [];
  // Always prefer production URL for OAuth redirect consistency
  const productionOrigin = allowedOrigins.find((o) => !o.includes("localhost"));
  if (productionOrigin) {
    return productionOrigin;
  }
  // Fallback for local-only development
  return process.env.BETTER_AUTH_URL || "http://localhost:3000";
};

export const createAuth: CreateAuth<DataModel> = (ctx) => {
  const baseURL = getBaseURL();
  const adapter = authComponent.adapter(ctx);
  
  return betterAuth({
    baseURL, // Dynamic base URL for OAuth callbacks
    database: adapter,
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes cache
      },
    },
    rateLimit: {
      enabled: true,
      customRules: {
        "/request-password-reset": {
          window: 60 * 15, // 15 minutes
          max: 5,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          const accounts =
            (await adapter.findMany({
              model: "account",
              where: [
                {
                  field: "userId",
                  value: user.id,
                },
              ],
            })) ?? [];
          const hasCredentialAccount = accounts.some(
            (account) => account.providerId === "credential" && account.password,
          );
          if (!hasCredentialAccount) {
            if (isDebugMode) {
              console.log(
                "[AUTH] Password reset skipped (no credential account):",
                maskEmail(user.email),
              );
            }
            return;
          }
        } catch (error) {
          if (isDebugMode) {
            console.warn(
              "[AUTH] Password reset account check failed; sending anyway",
              error,
            );
          }
        }

        const { html, text } = buildResetPasswordEmail({
          name: user.name,
          resetUrl: url,
          brandColor: BRAND_COLOR,
        });

        await sendEmail({
          to: user.email,
          subject: "Reset your SendCat password",
          html,
          text,
          replyTo: SUPPORT_REPLY_TO,
          from: process.env.EMAIL_FROM || DEFAULT_FROM,
        });
        if (isDebugMode) {
          console.log("[AUTH EMAIL] Reset password email sent:", maskEmail(user.email));
        }
      },
      // Note: Password validation is handled client-side
      // Better Auth only supports custom hash/verify functions, not validation
    },
    socialProviders: {
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : (console.warn(
            "[AUTH] Google OAuth disabled: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set"
          ),
          {})),
    },
    // Trusted origins for auth requests
    trustedOrigins: [
      "http://localhost:3000",
      "https://www.sendcat.app/",
    ],
    plugins: [
      convex({ authConfig }),
    ],
  });
};
