import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";
import { safeGetAuthUser } from "./auth";

/**
 * Verify the current user has access to a thread.
 * - If thread has userId: only that authenticated user can access
 * - If thread has no userId (anonymous): sessionId must match
 * Throws an error if access is denied.
 */
async function verifyThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
  sessionId?: string
): Promise<{ thread: Doc<"threads">; userId: string | undefined }> {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    throw new Error("Thread not found");
  }

  const user = await safeGetAuthUser(ctx);

  // If thread belongs to an authenticated user
  if (thread.userId) {
    if (!user || thread.userId !== user._id) {
      console.log("[SECURITY] Thread access denied:", {
        threadId,
        threadOwner: thread.userId,
        requestingUser: user?._id ?? "anonymous",
        timestamp: new Date().toISOString(),
      });
      throw new Error("Access denied: You don't have permission to access this thread");
    }
  } else {
    // Anonymous thread - verify sessionId matches
    if (!sessionId || thread.sessionId !== sessionId) {
      console.log("[SECURITY] Anonymous thread access denied:", {
        threadId,
        threadSession: thread.sessionId,
        requestingSession: sessionId ?? "none",
        timestamp: new Date().toISOString(),
      });
      throw new Error("Access denied: You don't have permission to access this thread");
    }
  }

  return { thread, userId: user?._id };
}

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    modelId: v.string(),
    sessionId: v.string()
  },
  handler: async (ctx, args) => {
    // Get authenticated user if available
    const user = await safeGetAuthUser(ctx);

    console.log("[THREADS] create - Auth state:", {
      isAuthenticated: !!user,
      userId: user?._id ?? null,
      userEmail: user?.email ?? null,
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
    });

    const threadId = await ctx.db.insert("threads", {
      ...args,
      userId: user?._id, // Associate with user if authenticated
      lastMessageAt: Date.now(),
    });

    console.log("[THREADS] create - Thread created:", {
      threadId,
      ownedBy: user?._id ? "user" : "session",
      ownerId: user?._id ?? args.sessionId,
    });

    return threadId;
  },
});

export const list = query({
  args: { sessionId: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Get authenticated user if available
    const user = await safeGetAuthUser(ctx);

    console.log("[THREADS] list - Auth state:", {
      isAuthenticated: !!user,
      userId: user?._id ?? null,
      userEmail: user?.email ?? null,
      sessionId: args.sessionId,
      queryMode: user ? "by_user" : "by_session",
      timestamp: new Date().toISOString(),
    });

    let threads;
    if (user) {
      // Authenticated: query by userId
      threads = await ctx.db
        .query("threads")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      console.log("[THREADS] list - Queried by userId:", {
        userId: user._id,
        threadCount: threads.length,
      });
    } else {
      // Anonymous: query by sessionId
      threads = await ctx.db
        .query("threads")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .collect();
      console.log("[THREADS] list - Queried by sessionId:", {
        sessionId: args.sessionId,
        threadCount: threads.length,
      });
    }

    if (args.search) {
      const searchLower = args.search.toLowerCase();
      threads = threads.filter(t =>
        t.title?.toLowerCase().includes(searchLower)
      );
    }

    // Sort: Pinned first, then by lastMessageAt desc
    return threads.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    });
  },
});

export const remove = mutation({
  args: { id: v.id("threads"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before deleting
    await verifyThreadAccess(ctx, args.id, args.sessionId);

    console.log("[THREADS] remove - Authorized deletion:", {
      threadId: args.id,
      timestamp: new Date().toISOString(),
    });

    // Delete messages first
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.id))
      .collect();

    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const togglePinned = mutation({
  args: { id: v.id("threads"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    const { thread } = await verifyThreadAccess(ctx, args.id, args.sessionId);
    await ctx.db.patch(args.id, { isPinned: !thread.isPinned });
  },
});

export const rename = mutation({
  args: { id: v.id("threads"), title: v.string(), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyThreadAccess(ctx, args.id, args.sessionId);
    await ctx.db.patch(args.id, { title: args.title });
  },
});

// Migrate threads from a sessionId to the current authenticated user
export const claimThreads = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await safeGetAuthUser(ctx);

    console.log("[THREADS] claimThreads - Auth state:", {
      isAuthenticated: !!user,
      userId: user?._id ?? null,
      userEmail: user?.email ?? null,
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
    });

    if (!user) {
      console.log("[THREADS] claimThreads - REJECTED: Not authenticated");
      throw new Error("Must be authenticated to claim threads");
    }

    // Find all threads with this sessionId that don't have a userId
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const unclaimedThreads = threads.filter((t) => !t.userId);
    let claimedCount = 0;

    console.log("[THREADS] claimThreads - Found threads:", {
      totalWithSession: threads.length,
      unclaimed: unclaimedThreads.length,
    });

    for (const thread of unclaimedThreads) {
      await ctx.db.patch(thread._id, { userId: user._id });
      claimedCount++;
    }

    console.log("[THREADS] claimThreads - Complete:", {
      claimedCount,
      userId: user._id,
    });

    return { claimedCount, userId: user._id };
  },
});

// Admin function to claim threads - SECURED: requires authenticated user
// Only the authenticated user can claim threads for themselves
export const adminClaimThreads = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await safeGetAuthUser(ctx);

    if (!user) {
      console.log("[SECURITY] adminClaimThreads - REJECTED: Not authenticated");
      throw new Error("Must be authenticated to claim threads");
    }

    console.log("[THREADS] adminClaimThreads - Authorized claim:", {
      userId: user._id,
      userEmail: user.email,
      sessionId: args.sessionId,
      timestamp: new Date().toISOString(),
    });

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const unclaimedThreads = threads.filter((t) => !t.userId);
    let claimedCount = 0;

    for (const thread of unclaimedThreads) {
      await ctx.db.patch(thread._id, { userId: user._id });
      claimedCount++;
    }

    console.log("[THREADS] adminClaimThreads - Complete:", {
      claimedCount,
      totalThreads: threads.length,
      userId: user._id,
    });

    return { claimedCount, totalThreads: threads.length, userId: user._id };
  },
});
