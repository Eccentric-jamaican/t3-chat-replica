import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    parentThreadId: v.optional(v.id("threads")),
    sharedFromThreadId: v.optional(v.id("threads")),
  })
    .index("by_session", ["sessionId"])
    .index("by_user", ["userId"]),

  // ... rest of the tables

  messages: defineTable({
    threadId: v.id("threads"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool"),
    ),
    content: v.string(),
    modelId: v.optional(v.string()), // Track which model generated this message
    status: v.optional(
      v.union(
        v.literal("streaming"),
        v.literal("completed"),
        v.literal("error"),
        v.literal("aborted"),
      ),
    ),
    reasoningContent: v.optional(v.string()), // Store reasoning tokens from thinking models
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
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
          type: v.literal("function"),
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
          source: v.optional(v.union(v.literal("ebay"), v.literal("global"))),
          merchantName: v.optional(v.string()),
          merchantDomain: v.optional(v.string()),
          productUrl: v.optional(v.string()),
          sellerName: v.optional(v.string()),
          sellerFeedback: v.optional(v.string()),
          condition: v.optional(v.string()),
          rating: v.optional(v.number()),
          reviews: v.optional(v.number()),
        }),
      ),
    ),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_status", ["threadId", "status"]),

  streamSessions: defineTable({
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    status: v.union(
      v.literal("streaming"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("aborted"),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    lastHeartbeat: v.optional(v.number()),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_status", ["threadId", "status"])
    .index("by_message", ["messageId"])
    .index("by_status", ["status"]),

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
      }),
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
  }).index("by_user", ["userId"]),

  packages: defineTable({
    userId: v.string(), // Better Auth user ID
    trackingNumber: v.string(),
    merchant: v.string(),
    description: v.string(),
    status: v.union(
      v.literal("warehouse"), // Arrived at US warehouse
      v.literal("in_transit"), // On the way to Jamaica
      v.literal("ready_for_pickup"), // Ready in Jamaica
      v.literal("delivered"), // Already picked up
    ),
    weight: v.optional(v.number()), // weight in lbs
    cost: v.optional(v.number()), // cost in JMD
    location: v.optional(v.string()), // Pick up location / Branch
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_user_status", ["userId", "status"]),

  ebayCategories: defineTable({
    marketplaceId: v.string(),
    fetchedAt: v.number(),
    categoryId: v.string(),
    categoryName: v.string(),
    normalizedName: v.string(),
    parentId: v.optional(v.string()),
    path: v.string(),
    leaf: v.boolean(),
  })
    .index("by_marketplace", ["marketplaceId"])
    .index("by_category_id", ["categoryId"])
    .index("by_marketplace_parent", ["marketplaceId", "parentId"]),

  ebayTaxonomyMeta: defineTable({
    marketplaceId: v.string(),
    rootCategoryId: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_marketplace", ["marketplaceId"]),

  favoriteLists: defineTable({
    userId: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  favorites: defineTable({
    userId: v.string(),
    listId: v.optional(v.id("favoriteLists")),
    type: v.union(v.literal("product"), v.literal("brand")),
    externalId: v.string(), // The original product.id or brand identifier
    item: v.any(), // Store the full product/brand object for offline access
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_list", ["listId"])
    .index("by_user_item", ["userId", "externalId"])
    .index("by_user_item_type", ["userId", "externalId", "type"]),

  sharedThreads: defineTable({
    threadId: v.id("threads"),
    shareToken: v.string(),
    createdByUserId: v.optional(v.string()),
    createdBySessionId: v.string(),
    createdAt: v.number(),
    isRevoked: v.boolean(),
  })
    .index("by_thread", ["threadId"])
    .index("by_share_token", ["shareToken"]),

  rateLimitWindows: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key_window", ["key", "windowStart"])
    .index("by_expires_at", ["expiresAt"]),

  rateLimitEvents: defineTable({
    source: v.union(
      v.literal("chat_action"),
      v.literal("chat_http"),
      v.literal("http"),
    ),
    bucket: v.string(),
    key: v.string(),
    outcome: v.union(
      v.literal("allowed"),
      v.literal("blocked"),
      v.literal("contention_fallback"),
    ),
    reason: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
    path: v.optional(v.string()),
    method: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_expires_at", ["expiresAt"])
    .index("by_bucket_created", ["bucket", "createdAt"])
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_outcome_created", ["outcome", "createdAt"]),

  rateLimitAlerts: defineTable({
    alertKey: v.string(),
    bucket: v.string(),
    outcome: v.union(
      v.literal("blocked"),
      v.literal("contention_fallback"),
    ),
    threshold: v.number(),
    observed: v.number(),
    windowMinutes: v.number(),
    notifiedByEmail: v.optional(v.boolean()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_alert_key", ["alertKey"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_created_at", ["createdAt"]),

  idempotencyKeys: defineTable({
    scope: v.string(),
    key: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    hitCount: v.number(),
    expiresAt: v.number(),
  })
    .index("by_scope_key", ["scope", "key"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_scope_first_seen", ["scope", "firstSeenAt"])
    .index("by_first_seen", ["firstSeenAt"]),

  outboundCircuitBreakers: defineTable({
    provider: v.string(),
    state: v.union(
      v.literal("closed"),
      v.literal("open"),
      v.literal("half_open"),
    ),
    failureCount: v.number(),
    successCount: v.number(),
    lastFailureAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    cooldownUntil: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_provider", ["provider"])
    .index("by_updated_at", ["updatedAt"]),

  outboundBulkheadLeases: defineTable({
    provider: v.string(),
    leaseId: v.string(),
    acquiredAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_provider_lease", ["provider", "leaseId"])
    .index("by_provider_expires", ["provider", "expiresAt"])
    .index("by_expires_at", ["expiresAt"]),

  toolResultCache: defineTable({
    namespace: v.string(),
    key: v.string(),
    value: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_namespace_key", ["namespace", "key"])
    .index("by_expires_at", ["expiresAt"]),

  toolJobs: defineTable({
    source: v.union(v.literal("chat_action"), v.literal("chat_http")),
    toolName: v.string(),
    qosClass: v.optional(
      v.union(
        v.literal("realtime"),
        v.literal("interactive"),
        v.literal("batch"),
      ),
    ),
    argsJson: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("dead_letter"),
    ),
    attempts: v.number(),
    maxAttempts: v.number(),
    availableAt: v.number(),
    leaseExpiresAt: v.optional(v.number()),
    resultJson: v.optional(v.string()),
    lastError: v.optional(v.string()),
    deadLetterReason: v.optional(v.string()),
    deadLetterAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    expiresAt: v.number(),
  })
    .index("by_status_available", ["status", "availableAt"])
    .index("by_tool_status_available", ["toolName", "status", "availableAt"])
    .index("by_status_lease", ["status", "leaseExpiresAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_tool_status_updated", ["toolName", "status", "updatedAt"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_created_at", ["createdAt"]),

  toolQueueAlerts: defineTable({
    alertKey: v.string(),
    kind: v.union(
      v.literal("queued_depth"),
      v.literal("oldest_queued_age"),
      v.literal("oldest_running_age"),
      v.literal("dead_letter_depth"),
    ),
    observed: v.number(),
    threshold: v.number(),
    windowMinutes: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_alert_key", ["alertKey"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_created_at", ["createdAt"]),
});
