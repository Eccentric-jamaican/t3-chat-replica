import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { getAuthUserId } from "./auth";

/**
 * Get the current user's profile.
 * - Authenticated users: returns profile by userId
 * - Anonymous users: returns profile by sessionId (if exists)
 */
export const get = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    // If authenticated, get profile by userId
    if (userId) {
      return await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
    }

    // Anonymous: get by sessionId
    return await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});

/**
 * Get current authenticated user's profile only.
 * Returns null if not authenticated.
 */
export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

// REMOVED: list() was returning ALL profiles - security vulnerability
// If you need to list profiles for admin purposes, create an internal query

export const update = mutation({
  args: {
    sessionId: v.string(),
    profile: v.object({
      fullName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      gender: v.optional(v.string()),
      dob: v.optional(v.number()),
      trn: v.optional(v.string()),
      address: v.optional(
        v.object({
          streetAddress: v.string(),
          streetAddress2: v.optional(v.string()),
          city: v.string(),
          parish: v.string(),
          postalCode: v.optional(v.string()),
        })
      ),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);

    // Basic validation
    if (args.profile.email && !args.profile.email.includes("@")) {
      throw new Error("Invalid email address");
    }

    if (args.profile.trn && !/^\d{3}-\d{3}-\d{3}$/.test(args.profile.trn)) {
      throw new Error("Invalid TRN format (expected XXX-XXX-XXX)");
    }

    let existing;

    // If authenticated, find profile by userId
    if (userId) {
      existing = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
    } else {
      // Anonymous: find by sessionId
      existing = await ctx.db
        .query("profiles")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .unique();
    }

    if (existing) {
      // Verify ownership before updating
      if (existing.userId && (!userId || existing.userId !== userId)) {
        console.log("[SECURITY] Profile update denied:", {
          profileOwner: existing.userId,
          requestingUser: userId ?? "anonymous",
        });
        throw new Error("Access denied: You can only update your own profile");
      }

      await ctx.db.patch(existing._id, args.profile);
      return existing._id;
    } else {
      // Create new profile
      return await ctx.db.insert("profiles", {
        sessionId: args.sessionId,
        userId: userId ?? undefined,
        ...args.profile,
      });
    }
  },
});

// Internal mutation - only callable from server-side code
export const upsertFromBetterAuth = internalMutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        fullName: args.name || existing.fullName,
        email: args.email || existing.email,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("profiles", {
        sessionId: `auth-${args.userId}`,
        userId: args.userId,
        fullName: args.name,
        email: args.email,
      });
    }
  },
});

// Internal mutations for Better Auth triggers
export const createFromAuth = internalMutation({
  args: {
    authId: v.string(),
    email: v.string(),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("createFromAuth triggered:", args);
    const id = await ctx.db.insert("profiles", {
      sessionId: `auth-${args.authId}`,
      userId: args.authId,
      email: args.email,
      fullName: args.fullName ?? args.email.split("@")[0],
    });
    console.log("Profile created with id:", id);
    return id;
  },
});

export const updateFromAuth = internalMutation({
  args: {
    authId: v.string(),
    email: v.string(),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.authId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        fullName: args.fullName ?? existing.fullName,
      });
    }
  },
});

export const deleteFromAuth = internalMutation({
  args: {
    authId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.authId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// Sync current authenticated user to profiles if not already synced
export const syncCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const { safeGetAuthUser } = await import("./auth");
    const user = await safeGetAuthUser(ctx);

    if (!user) {
      return { synced: false, reason: "not authenticated" };
    }

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (existing) {
      return { synced: false, reason: "already exists", profile: existing };
    }

    const id = await ctx.db.insert("profiles", {
      sessionId: `auth-${user._id}`,
      userId: user._id,
      email: user.email,
      fullName: user.name ?? user.email.split("@")[0],
    });

    return { synced: true, profileId: id };
  },
});

// Internal admin function - only callable from server-side code (dashboard, CLI)
export const adminCreateProfile = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    fullName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      return { created: false, reason: "already exists", profile: existing };
    }

    const id = await ctx.db.insert("profiles", {
      sessionId: `auth-${args.userId}`,
      userId: args.userId,
      email: args.email,
      fullName: args.fullName,
    });

    return { created: true, profileId: id };
  },
});
