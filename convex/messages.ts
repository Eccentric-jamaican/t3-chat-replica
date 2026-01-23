import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    return Promise.all(messages.map(async (msg) => {
      if (!msg.attachments || msg.attachments.length === 0) return msg;
      const attachments = await Promise.all(msg.attachments.map(async (att) => ({
        ...att,
        url: await ctx.storage.getUrl(att.storageId)
      })));
      return { ...msg, attachments };
    }));
  },
});

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const send = mutation({
  args: { 
    threadId: v.id("threads"), 
    content: v.string(), 
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    status: v.optional(v.union(v.literal("streaming"), v.literal("completed"), v.literal("error"))),
    attachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      type: v.string(), 
      name: v.string(),
      size: v.number(),
    }))),
    toolCallId: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      ...args,
      status: args.status ?? "completed"
    });
    
    // Update thread last active
    await ctx.db.patch(args.threadId, {
      lastMessageAt: Date.now(),
    });

    return messageId;
  },
});

export const saveToolCalls = mutation({
  args: {
    messageId: v.id("messages"),
    toolCalls: v.array(v.object({
      id: v.string(),
      type: v.literal("function"),
      function: v.object({
        name: v.string(),
        arguments: v.string(),
      })
    }))
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { toolCalls: args.toolCalls });
  }
});

export const saveReasoningContent = mutation({
  args: {
    messageId: v.id("messages"),
    reasoningContent: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { reasoningContent: args.reasoningContent });
  }
});

export const initializeAssistantMessage = mutation({
  args: { 
    threadId: v.id("threads"),
    modelId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      threadId: args.threadId,
      role: "assistant",
      content: "",
      modelId: args.modelId,
      status: "streaming"
    });
  }
});

export const appendContent = mutation({
  args: { 
    messageId: v.id("messages"), 
    content: v.string(),
    status: v.optional(v.union(v.literal("streaming"), v.literal("completed"), v.literal("error"), v.literal("aborted")))
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");

    if (message.status === "aborted") {
      throw new Error("Message aborted");
    }

    await ctx.db.patch(args.messageId, {
      content: message.content + args.content,
      status: args.status ?? "streaming"
    });
  }
});

export const updateStatus = mutation({
  args: { 
    messageId: v.id("messages"), 
    status: v.union(v.literal("streaming"), v.literal("completed"), v.literal("error"), v.literal("aborted"))
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { status: args.status });
  }
});

export const abort = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { status: "aborted" });
  },
});

export const abortLatestInThread = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    console.log("abortLatestInThread called for thread:", args.threadId);
    const latest = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "streaming"))
      .first();

    console.log("Found latest streaming message:", latest?._id);

    if (latest) {
      await ctx.db.patch(latest._id, { status: "aborted" });
      console.log("Patched status to aborted");
    } else {
      console.log("No streaming message found to abort");
    }
  },
});

export const getStatus = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    return msg?.status;
  },
});

export const isThreadStreaming = query({
  args: { threadId: v.optional(v.id("threads")) },
  handler: async (ctx, args) => {
    if (!args.threadId) return false;
    const latest = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId!))
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "streaming"))
      .first();
    return !!latest;
  },
});

export const update = mutation({
  args: { id: v.id("messages"), content: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { content: args.content });
  },
});

// Delete all messages after a given message (for retry functionality)
export const deleteAfter = mutation({
  args: {
    threadId: v.id("threads"),
    afterMessageId: v.id("messages")
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();

    // Find the index of the target message
    const targetIndex = messages.findIndex(m => m._id === args.afterMessageId);
    if (targetIndex === -1) return;

    // Delete all messages after the target
    for (let i = targetIndex + 1; i < messages.length; i++) {
      await ctx.db.delete(messages[i]._id);
    }
  },
});
