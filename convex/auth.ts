import { betterAuth } from "better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { createClient, type CreateAuth, type AuthFunctions } from "@convex-dev/better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

// AuthFunctions must reference the auth module for triggers to work
const authFunctions: AuthFunctions = internal.auth;

/**
 * The auth component client - provides adapter, route registration, and helper methods.
 * Includes triggers to sync Better Auth users to the app's profiles table.
 */
export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, doc) => {
        console.log("[AUTH TRIGGER] onCreate - New user registered:", {
          userId: doc._id,
          email: doc.email,
          name: doc.name,
          timestamp: new Date().toISOString(),
        });
        const profileId = await ctx.db.insert("profiles", {
          sessionId: `auth-${doc._id}`,
          userId: doc._id,
          email: doc.email,
          fullName: doc.name ?? doc.email.split("@")[0],
        });
        console.log("[AUTH TRIGGER] onCreate - Profile created:", {
          profileId,
          userId: doc._id,
        });
      },
      onUpdate: async (ctx, newDoc, oldDoc) => {
        console.log("[AUTH TRIGGER] onUpdate - User updated:", {
          userId: newDoc._id,
          changes: {
            email: oldDoc.email !== newDoc.email ? `${oldDoc.email} -> ${newDoc.email}` : "unchanged",
            name: oldDoc.name !== newDoc.name ? `${oldDoc.name} -> ${newDoc.name}` : "unchanged",
          },
          timestamp: new Date().toISOString(),
        });
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
            console.log("[AUTH TRIGGER] onUpdate - Profile synced:", {
              profileId: existing._id,
              userId: newDoc._id,
            });
          } else {
            console.log("[AUTH TRIGGER] onUpdate - No profile found for user:", newDoc._id);
          }
        }
      },
      onDelete: async (ctx, doc) => {
        console.log("[AUTH TRIGGER] onDelete - User deleted:", {
          userId: doc._id,
          email: doc.email,
          timestamp: new Date().toISOString(),
        });
        const existing = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", doc._id))
          .unique();
        if (existing) {
          await ctx.db.delete(existing._id);
          console.log("[AUTH TRIGGER] onDelete - Profile deleted:", {
            profileId: existing._id,
            userId: doc._id,
          });
        } else {
          console.log("[AUTH TRIGGER] onDelete - No profile found for user:", doc._id);
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
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    // TODO: Update trustedOrigins for production - remove localhost and preview URLs,
    // keep only your production domain (e.g., "https://yourdomain.com")
    trustedOrigins: [
      "http://localhost:3000",
      "https://t3-chat-replica.vercel.app",
      "https://t3-chat-replica-eccentric-devs-projects.vercel.app",
      "https://t3-chat-replica-git-betterauth-eccentric-devs-projects.vercel.app",
    ],
    plugins: [
      convex({ authConfig }),
    ],
  });
};
