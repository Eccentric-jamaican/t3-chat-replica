import { v } from "convex/values";
import { mutation, query, internalQuery, QueryCtx, MutationCtx } from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId, safeGetAuthUser } from "./auth";

const isDebugMode = process.env.CONVEX_DEBUG_LOGS === "true";
const shareTokenPrefix = "share_";

function generateShareToken() {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

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
): Promise<{ thread: Doc<"threads">; userId: string | null }> {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    throw new Error("Thread not found");
  }

  const userId = await getAuthUserId(ctx);

  // If thread belongs to an authenticated user
  if (thread.userId) {
    if (!userId || thread.userId !== userId) {
      console.log("[SECURITY] Thread access denied:", {
        threadId,
        threadOwner: thread.userId,
        requestingUser: userId ?? "anonymous",
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

  return { thread, userId };
}

// Internal auth check for actions (single DB read, no extra data returned)
export const internalVerifyThreadAccess = internalQuery({
  args: { threadId: v.id("threads"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    const userId = await getAuthUserId(ctx);

    if (thread.userId) {
      if (!userId || thread.userId !== userId) {
        throw new Error("Access denied: You don't have permission to access this thread");
      }
    } else {
      if (!args.sessionId || thread.sessionId !== args.sessionId) {
        throw new Error("Access denied: You don't have permission to access this thread");
      }
    }

    return { ok: true };
  },
});

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    modelId: v.string(),
    parentThreadId: v.optional(v.id("threads")),
    sessionId: v.string()
  },
  handler: async (ctx, args) => {
    // Get authenticated user ID if available (JWT-only, no DB query)
    const userId = await getAuthUserId(ctx);

    if (isDebugMode) {
      console.log("[THREADS] create - Auth state:", {
        isAuthenticated: !!userId,
        userId,
        sessionId: args.sessionId,
      });
    }

    const threadId = await ctx.db.insert("threads", {
      ...args,
      userId: userId ?? undefined, // Associate with user if authenticated
      lastMessageAt: Date.now(),
    });

    if (isDebugMode) {
      console.log("[THREADS] create - Thread created:", {
        threadId,
        ownedBy: userId ? "user" : "session",
      });
    }

    return threadId;
  },
});

export const get = query({
  args: { id: v.id("threads"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { thread } = await verifyThreadAccess(ctx, args.id, args.sessionId);
    return thread;
  },
});

export const list = query({
  args: { sessionId: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Get authenticated user ID if available (JWT-only, no DB query)
    const userId = await getAuthUserId(ctx);

    if (isDebugMode) {
      console.log("[THREADS] list - Auth state:", {
        isAuthenticated: !!userId,
        userId,
        queryMode: userId ? "by_user" : "by_session",
      });
    }

    let threads;
    if (userId) {
      // Authenticated: query by userId
      threads = await ctx.db
        .query("threads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      if (isDebugMode) {
        console.log("[THREADS] list - Queried by userId:", {
          threadCount: threads.length,
        });
      }
    } else {
      // Anonymous: query by sessionId
      threads = await ctx.db
        .query("threads")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .collect();
      if (isDebugMode) {
        console.log("[THREADS] list - Queried by sessionId:", {
          threadCount: threads.length,
        });
      }
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

    if (isDebugMode) {
      console.log("[THREADS] remove - Authorized deletion:", { threadId: args.id });
    }

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

export const createShareToken = mutation({
  args: { threadId: v.id("threads"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { thread, userId } = await verifyThreadAccess(
      ctx,
      args.threadId,
      args.sessionId,
    );

    const existing = await ctx.db
      .query("sharedThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .collect();

    const activeToken = existing.find((entry) => !entry.isRevoked);
    if (activeToken) {
      return { shareToken: activeToken.shareToken };
    }

    const shareToken = generateShareToken();
    await ctx.db.insert("sharedThreads", {
      threadId: thread._id,
      shareToken,
      createdByUserId: userId ?? undefined,
      createdBySessionId: thread.sessionId,
      createdAt: Date.now(),
      isRevoked: false,
    });

    return { shareToken };
  },
});

export const createShareFork = mutation({
  args: { token: v.string(), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const normalizedToken = args.token.trim();
    let shareEntry = await ctx.db
      .query("sharedThreads")
      .withIndex("by_share_token", (q) => q.eq("shareToken", normalizedToken))
      .first();

    if (!shareEntry && !normalizedToken.startsWith(shareTokenPrefix)) {
      shareEntry = await ctx.db
        .query("sharedThreads")
        .withIndex("by_share_token", (q) =>
          q.eq("shareToken", `${shareTokenPrefix}${normalizedToken}`)
        )
        .first();
    }

    if (!shareEntry || shareEntry.isRevoked) {
      throw new Error("Share link is invalid or revoked");
    }

    const thread = await ctx.db.get(shareEntry.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    const userId = await getAuthUserId(ctx);
    const sessionId = args.sessionId || thread.sessionId;

    if (!sessionId && !userId) {
      throw new Error("Missing session id");
    }

    const newThreadId = await ctx.db.insert("threads", {
      title: thread.title || "Shared chat",
      modelId: thread.modelId,
      sessionId: sessionId || "",
      userId: userId ?? undefined,
      lastMessageAt: Date.now(),
      parentThreadId: thread._id,
      sharedFromThreadId: thread._id,
    });

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("asc")
      .collect();

    for (const message of messages) {
      await ctx.db.insert("messages", {
        threadId: newThreadId,
        role: message.role,
        content: message.content,
        modelId: message.modelId,
        status: message.status,
        reasoningContent: message.reasoningContent,
        attachments: message.attachments,
        toolCalls: message.toolCalls,
        toolCallId: message.toolCallId,
        name: message.name,
        products: message.products,
      });
    }

    return { threadId: newThreadId };
  },
});

// Migrate threads from a sessionId to the current authenticated user
export const claimThreads = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await safeGetAuthUser(ctx);

    if (isDebugMode) {
      console.log("[THREADS] claimThreads - Auth state:", {
        isAuthenticated: !!user,
        userId: user?._id ?? null,
      });
    }

    if (!user) {
      if (isDebugMode) console.log("[THREADS] claimThreads - REJECTED: Not authenticated");
      throw new Error("Must be authenticated to claim threads");
    }

    // Find all threads with this sessionId that don't have a userId
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const unclaimedThreads = threads.filter((t) => !t.userId);
    let claimedCount = 0;

    if (isDebugMode) {
      console.log("[THREADS] claimThreads - Found threads:", {
        totalWithSession: threads.length,
        unclaimed: unclaimedThreads.length,
      });
    }

    for (const thread of unclaimedThreads) {
      await ctx.db.patch(thread._id, { userId: user._id });
      claimedCount++;
    }

    if (isDebugMode) {
      console.log("[THREADS] claimThreads - Complete:", { claimedCount });
    }

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

    if (isDebugMode) {
      console.log("[THREADS] adminClaimThreads - Authorized claim:", {
        userId: user._id,
      });
    }

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

    if (isDebugMode) {
      console.log("[THREADS] adminClaimThreads - Complete:", {
        claimedCount,
        totalThreads: threads.length,
      });
    }

    return { claimedCount, totalThreads: threads.length, userId: user._id };
  },
});
