import { betterAuth } from "better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { createClient, type CreateAuth, type AuthFunctions } from "@convex-dev/better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

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
 * Creates a Better Auth instance configured for Convex.
 * Used by the HTTP router to handle auth requests.
 * @param ctx - The Convex context
 */
export const createAuth: CreateAuth<DataModel> = (ctx) => {
  return betterAuth({
    database: authComponent.adapter(ctx),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes cache
      },
    },
    emailAndPassword: {
      enabled: true,
      // Server-side password validation
      password: {
        minLength: 8,
        maxLength: 128,
        // Custom validation function
        validate: (password: string) => {
          if (password.length < 8) {
            return { valid: false, message: "Password must be at least 8 characters" };
          }
          if (!/\d/.test(password)) {
            return { valid: false, message: "Password must contain at least one number" };
          }
          return { valid: true };
        },
      },
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
    // In production, only include your actual domains
    trustedOrigins: [
      // Development
      "http://localhost:3000",
      // Production (update with your actual domain)
      "https://t3-chat-replica.vercel.app",
    ],
    plugins: [
      convex({ authConfig }),
    ],
  });
};
