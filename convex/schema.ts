import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// Note: Better Auth tables (user, session, account, verification) are managed
// by the @convex-dev/better-auth component. User data is synced to the
// profiles table via triggers defined in auth.ts.

export default defineSchema({
  threads: defineTable({
    title: v.optional(v.string()),
    modelId: v.string(), // e.g. "gpt-5-nano"
    sessionId: v.string(), // UUID for anonymous users
    userId: v.optional(v.string()), // For logged in users (Better Auth)
    lastMessageAt: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
  })
    .index('by_session', ['sessionId'])
    .index('by_user', ['userId']),
  
  // ... rest of the tables

  messages: defineTable({
    threadId: v.id('threads'),
    role: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('system'),
      v.literal('tool'),
    ),
    content: v.string(),
    modelId: v.optional(v.string()), // Track which model generated this message
    status: v.optional(
      v.union(
        v.literal('streaming'),
        v.literal('completed'),
        v.literal('error'),
        v.literal('aborted'),
      ),
    ),
    reasoningContent: v.optional(v.string()), // Store reasoning tokens from thinking models
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          type: v.string(), // e.g., "image/png"
          name: v.string(),
          size: v.number(),
        }),
      ),
    ),
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          type: v.literal('function'),
          function: v.object({
            name: v.string(),
            arguments: v.string(),
          }),
        }),
      ),
    ),
    toolCallId: v.optional(v.string()),
    name: v.optional(v.string()),
    products: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          price: v.string(),
          image: v.string(),
          url: v.string(),
          sellerName: v.optional(v.string()),
          sellerFeedback: v.optional(v.string()),
          condition: v.optional(v.string()),
          rating: v.optional(v.number()),
          reviews: v.optional(v.number()),
        }),
      ),
    ),
  })
    .index('by_thread', ['threadId'])
    .index('by_thread_status', ['threadId', 'status']),

  streamSessions: defineTable({
    threadId: v.id('threads'),
    messageId: v.id('messages'),
    status: v.union(
      v.literal('streaming'),
      v.literal('completed'),
      v.literal('error'),
      v.literal('aborted'),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    lastHeartbeat: v.optional(v.number()),
  })
    .index('by_thread', ['threadId'])
    .index('by_thread_status', ['threadId', 'status'])
    .index('by_message', ['messageId'])
    .index('by_status', ['status']),

  profiles: defineTable({
    sessionId: v.string(),
    userId: v.optional(v.string()),
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
  })
    .index("by_session", ["sessionId"])
    .index("by_user", ["userId"]),

  // ── Pre-alert system tables ──────────────────────────────────────────

  evidence: defineTable({
    userId: v.string(),
    source: v.union(
      v.literal("gmail"),
      v.literal("whatsapp"),
      v.literal("manual"),
    ),
    sourceMessageId: v.optional(v.string()),
    merchant: v.optional(v.string()),
    rawTextSnippet: v.string(),
    rawStorageId: v.optional(v.id("_storage")),
    receivedAt: v.number(),
    processedAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
      v.literal("duplicate"),
    ),
    extractionError: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_source", ["userId", "source"])
    .index("by_source_message", ["sourceMessageId"]),

  purchaseDrafts: defineTable({
    userId: v.string(),
    evidenceId: v.id("evidence"),
    merchant: v.string(),
    storeName: v.optional(v.string()),
    orderNumber: v.optional(v.string()),
    itemsSummary: v.optional(v.string()),
    valueUsd: v.optional(v.number()),
    currency: v.optional(v.string()),
    originalValue: v.optional(v.number()),
    confidence: v.number(),
    missingFields: v.array(v.string()),
    invoiceStorageId: v.optional(v.id("_storage")),
    invoicePresent: v.boolean(),
    status: v.union(
      v.literal("draft"),
      v.literal("confirmed"),
      v.literal("rejected"),
    ),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_evidence", ["evidenceId"]),

  packagePreAlerts: defineTable({
    userId: v.string(),
    purchaseDraftId: v.id("purchaseDrafts"),
    trackingNumber: v.string(),
    carrier: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("confirmed"),
      v.literal("submitted"),
      v.literal("rejected"),
    ),
    confirmedAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_purchase_draft", ["purchaseDraftId"])
    .index("by_user_tracking", ["userId", "trackingNumber"]),

  integrationsGmail: defineTable({
    userId: v.string(),
    email: v.string(),
    encryptedRefreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    historyId: v.optional(v.string()),
    watchExpiration: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("needs_reauth"),
      v.literal("disconnected"),
    ),
    connectedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  integrationsWhatsapp: defineTable({
    userId: v.string(),
    phoneNumber: v.string(),
    linkingCode: v.optional(v.string()),
    linkingCodeExpiresAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending_link"),
      v.literal("active"),
      v.literal("disconnected"),
    ),
    lastMessageAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_phone", ["phoneNumber"])
    .index("by_linking_code", ["linkingCode"]),

  userPreferences: defineTable({
    userId: v.string(),
    autoCreatePreAlerts: v.boolean(),
    gmailSyncEnabled: v.boolean(),
    whatsappSyncEnabled: v.boolean(),
  })
    .index("by_user", ["userId"]),
})
