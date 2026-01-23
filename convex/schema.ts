import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  threads: defineTable({
    title: v.optional(v.string()),
    modelId: v.string(), // e.g. "gpt-5-nano"
    sessionId: v.string(), // UUID for anonymous users
    userId: v.optional(v.string()), // For logged in users (Clerk)
    lastMessageAt: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
  }).index("by_session", ["sessionId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    content: v.string(),
    modelId: v.optional(v.string()), // Track which model generated this message
    status: v.optional(v.union(v.literal("streaming"), v.literal("completed"), v.literal("error"), v.literal("aborted"))),
    reasoningContent: v.optional(v.string()), // Store reasoning tokens from thinking models
    attachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      type: v.string(), // e.g., "image/png"
      name: v.string(),
      size: v.number(),
    }))),
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      type: v.literal("function"),
      function: v.object({
        name: v.string(),
        arguments: v.string(),
      })
    }))),
    toolCallId: v.optional(v.string()),
    name: v.optional(v.string()),
  }).index("by_thread", ["threadId"]),

});
