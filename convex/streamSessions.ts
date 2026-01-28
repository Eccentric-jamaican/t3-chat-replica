import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { safeGetAuthUser } from "./auth";

/**
 * Verify the current user has access to a thread.
 */
async function verifyThreadAccess(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  sessionId?: string
): Promise<void> {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    throw new Error("Thread not found");
  }

  const user = await safeGetAuthUser(ctx);

  if (thread.userId) {
    if (!user || thread.userId !== user._id) {
      throw new Error("Access denied: You don't have permission to access this thread");
    }
  } else if (!sessionId || thread.sessionId !== sessionId) {
    throw new Error("Access denied: You don't have permission to access this thread");
  }
}

export const start = mutation({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before starting stream
    await verifyThreadAccess(ctx, args.threadId, args.sessionId);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error(`Message not found: ${args.messageId}`);
    }

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${args.threadId}`);
    }
    if (message.threadId !== args.threadId) {
      throw new Error(`Message ${args.messageId} does not belong to thread ${args.threadId}`);
    }

    const streamSessionId = await ctx.db.insert("streamSessions", {
      threadId: args.threadId,
      messageId: args.messageId,
      status: "streaming",
      startedAt: Date.now(),
    });

    await ctx.db.patch(args.messageId, { status: "streaming" });

    return streamSessionId;
  },
});

export const getStatus = query({
  args: { sessionId: v.id("streamSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    return session?.status;
  },
});

export const abort = mutation({
  args: { sessionId: v.id("streamSessions"), clientSessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    // Verify ownership via thread
    await verifyThreadAccess(ctx, session.threadId, args.clientSessionId);

    await ctx.db.patch(args.sessionId, {
      status: "aborted",
      endedAt: Date.now(),
    });
  },
});

export const abortLatestByThread = mutation({
  args: { threadId: v.id("threads"), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before aborting
    await verifyThreadAccess(ctx, args.threadId, args.sessionId);

    const latest = await ctx.db
      .query("streamSessions")
      .withIndex("by_thread_status", (q) =>
        q.eq("threadId", args.threadId).eq("status", "streaming"),
      )
      .order("desc")
      .first();

    if (!latest) return;

    await ctx.db.patch(latest._id, {
      status: "aborted",
      endedAt: Date.now(),
    });
  },
});

export const complete = mutation({
  args: { sessionId: v.id("streamSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    await ctx.db.patch(args.sessionId, {
      status: "completed",
      endedAt: Date.now(),
    });

    await ctx.db.patch(session.messageId, { status: "completed" });
  },
});

export const error = mutation({
  args: { sessionId: v.id("streamSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    await ctx.db.patch(args.sessionId, {
      status: "error",
      endedAt: Date.now(),
    });

    await ctx.db.patch(session.messageId, { status: "error" });
  },
});

export const heartbeat = mutation({
  args: { sessionId: v.id("streamSessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { lastHeartbeat: Date.now() });
  },
});
