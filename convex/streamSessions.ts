import {
  mutation,
  internalMutation,
  internalQuery,
  MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireThreadAccess as enforceThreadAccess } from "./lib/authGuards";
import { throwFunctionError } from "./lib/functionErrors";

/**
 * Verify the current user has access to a thread.
 */
async function verifyThreadAccess(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  sessionId?: string,
  functionName = "streamSessions.verifyThreadAccess",
): Promise<void> {
  await enforceThreadAccess(ctx, {
    threadId,
    sessionId,
    functionName,
  });
}

export const start = mutation({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before starting stream
    await verifyThreadAccess(
      ctx,
      args.threadId,
      args.sessionId,
      "streamSessions.start",
    );

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throwFunctionError(
        "not_found",
        "streamSessions.start",
        `Message not found: ${args.messageId}`,
      );
    }

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throwFunctionError(
        "not_found",
        "streamSessions.start",
        `Thread not found: ${args.threadId}`,
      );
    }
    if (message.threadId !== args.threadId) {
      throwFunctionError(
        "forbidden",
        "streamSessions.start",
        `Message ${args.messageId} does not belong to thread ${args.threadId}`,
      );
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

// Internal query for server-side streaming action (skips auth check)
export const internalGetStatus = internalQuery({
  args: { sessionId: v.id("streamSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    return session?.status;
  },
});

export const abort = mutation({
  args: {
    sessionId: v.id("streamSessions"),
    clientSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    // Verify ownership via thread
    await verifyThreadAccess(
      ctx,
      session.threadId,
      args.clientSessionId,
      "streamSessions.abort",
    );

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
    await verifyThreadAccess(
      ctx,
      args.threadId,
      args.sessionId,
      "streamSessions.abortLatestByThread",
    );

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

// Internal mutations for server-side streaming action (skips auth check)
export const internalAbort = internalMutation({
  args: { sessionId: v.id("streamSessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    await ctx.db.patch(args.sessionId, {
      status: "aborted",
      endedAt: Date.now(),
    });
  },
});

export const internalComplete = internalMutation({
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

export const internalError = internalMutation({
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

// Internal version for server-side streaming action (skips auth check)
export const internalStart = internalMutation({
  args: {
    threadId: v.id("threads"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    // If message doesn't exist (e.g., was deleted or request was cancelled), skip
    if (!message) {
      console.log(
        `[internalStart] Message ${args.messageId} not found, skipping stream session creation`,
      );
      return null;
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
