import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  mutation,
  QueryCtx,
  MutationCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { assertOwnedByUser, requireAuthenticatedUserId } from "../lib/authGuards";
import { throwFunctionError } from "../lib/functionErrors";

// ── Internal functions (called from actions) ───────────────────────────

export const getBySourceMessageId = internalQuery({
  args: { sourceMessageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evidence")
      .withIndex("by_source_message", (q) =>
        q.eq("sourceMessageId", args.sourceMessageId),
      )
      .first();
  },
});

export const getDraftByOrderNumber = internalQuery({
  args: { userId: v.string(), orderNumber: v.string() },
  handler: async (ctx, args) => {
    const needle = args.orderNumber.trim().toUpperCase();
    if (!needle) return null;

    const drafts = await ctx.db
      .query("purchaseDrafts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return (
      drafts.find((draft) => {
        if (!draft.orderNumber) return false;
        const parts = draft.orderNumber
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean);
        return parts.includes(needle);
      }) ?? null
    );
  },
});

export const getDraftsByOrderNumbers = internalQuery({
  args: { userId: v.string(), orderNumbers: v.array(v.string()) },
  handler: async (ctx, args) => {
    const needles = new Set(
      args.orderNumbers.map((n) => n.trim().toUpperCase()).filter(Boolean),
    );
    if (needles.size === 0) return [];

    const drafts = await ctx.db
      .query("purchaseDrafts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return drafts.filter((draft) => {
      if (!draft.orderNumber) return false;
      const parts = draft.orderNumber
        .split(",")
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean);
      return parts.some((p) => needles.has(p));
    });
  },
});

export const getDraftByTrackingNumber = internalQuery({
  args: { userId: v.string(), trackingNumber: v.string() },
  handler: async (ctx, args) => {
    const tracking = args.trackingNumber.trim().toUpperCase();
    if (!tracking) return null;

    const preAlert = await ctx.db
      .query("packagePreAlerts")
      .withIndex("by_user_tracking", (q) =>
        q.eq("userId", args.userId).eq("trackingNumber", tracking),
      )
      .first();

    if (!preAlert) return null;
    return await ctx.db.get(preAlert.purchaseDraftId);
  },
});

export const hasPreAlertsForDraft = internalQuery({
  args: { draftId: v.id("purchaseDrafts") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("packagePreAlerts")
      .withIndex("by_purchase_draft", (q) =>
        q.eq("purchaseDraftId", args.draftId),
      )
      .first();
    return !!existing;
  },
});

export const createEvidence = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("evidence", args);
  },
});

export const updateEvidenceStatus = internalMutation({
  args: {
    evidenceId: v.id("evidence"),
    status: v.union(
      v.literal("pending"),
      v.literal("extracted"),
      v.literal("failed"),
      v.literal("duplicate"),
    ),
    extractionError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.evidenceId, {
      status: args.status,
      extractionError: args.extractionError,
    });
  },
});

export const redactEvidenceSnippet = internalMutation({
  args: { evidenceId: v.id("evidence") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.evidenceId, {
      rawTextSnippet: "[redacted]",
    });
  },
});

export const createPurchaseDraft = internalMutation({
  args: {
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
    invoicePresent: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("purchaseDrafts", {
      userId: args.userId,
      evidenceId: args.evidenceId,
      merchant: args.merchant,
      storeName: args.storeName,
      orderNumber: args.orderNumber,
      itemsSummary: args.itemsSummary,
      valueUsd: args.valueUsd,
      currency: args.currency,
      originalValue: args.originalValue,
      confidence: args.confidence,
      missingFields: args.missingFields,
      invoicePresent: args.invoicePresent,
      status: "draft",
    });
  },
});

export const updateDraftFromExtraction = internalMutation({
  args: {
    draftId: v.id("purchaseDrafts"),
    updates: v.object({
      merchant: v.optional(v.string()),
      storeName: v.optional(v.string()),
      orderNumber: v.optional(v.string()),
      itemsSummary: v.optional(v.string()),
      valueUsd: v.optional(v.number()),
      currency: v.optional(v.string()),
      originalValue: v.optional(v.number()),
      invoicePresent: v.optional(v.boolean()),
      confidence: v.optional(v.number()),
      missingFields: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, args.updates);
  },
});

export const mergeDrafts = internalMutation({
  args: {
    primaryDraftId: v.id("purchaseDrafts"),
    duplicateDraftIds: v.array(v.id("purchaseDrafts")),
  },
  handler: async (ctx, args) => {
    let moved = 0;
    let deleted = 0;

    for (const dupId of args.duplicateDraftIds) {
      const preAlerts = await ctx.db
        .query("packagePreAlerts")
        .withIndex("by_purchase_draft", (q) =>
          q.eq("purchaseDraftId", dupId),
        )
        .collect();

      for (const pa of preAlerts) {
        await ctx.db.patch(pa._id, { purchaseDraftId: args.primaryDraftId });
        moved++;
      }

      await ctx.db.delete(dupId);
      deleted++;
    }

    return { preAlertsMoved: moved, draftsDeleted: deleted };
  },
});

export const deleteDraftsAndEvidence = internalMutation({
  args: { draftIds: v.array(v.id("purchaseDrafts")) },
  handler: async (ctx, args) => {
    let draftsDeleted = 0;
    let evidenceDeleted = 0;
    let preAlertsDeleted = 0;

    for (const draftId of args.draftIds) {
      const draft = await ctx.db.get(draftId);
      if (!draft) continue;

      const preAlerts = await ctx.db
        .query("packagePreAlerts")
        .withIndex("by_purchase_draft", (q) =>
          q.eq("purchaseDraftId", draftId),
        )
        .collect();

      for (const pa of preAlerts) {
        await ctx.db.delete(pa._id);
        preAlertsDeleted++;
      }

      await ctx.db.delete(draftId);
      draftsDeleted++;

      if (draft.evidenceId) {
        const evidence = await ctx.db.get(draft.evidenceId);
        if (evidence) {
          await ctx.db.delete(draft.evidenceId);
          evidenceDeleted++;
        }
      }
    }

    return { draftsDeleted, evidenceDeleted, preAlertsDeleted };
  },
});

export const createPackagePreAlert = internalMutation({
  args: {
    userId: v.string(),
    purchaseDraftId: v.id("purchaseDrafts"),
    trackingNumber: v.string(),
    carrier: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotency: check if tracking number already exists for this user
    const existing = await ctx.db
      .query("packagePreAlerts")
      .withIndex("by_user_tracking", (q) =>
        q.eq("userId", args.userId).eq("trackingNumber", args.trackingNumber),
      )
      .first();
    if (existing) {
      if (existing.purchaseDraftId !== args.purchaseDraftId) {
        await ctx.db.patch(existing._id, {
          purchaseDraftId: args.purchaseDraftId,
        });
      }
      return existing._id;
    }
    return await ctx.db.insert("packagePreAlerts", {
      userId: args.userId,
      purchaseDraftId: args.purchaseDraftId,
      trackingNumber: args.trackingNumber,
      carrier: args.carrier,
      status: "draft",
    });
  },
});

// ── Public queries (called from frontend) ──────────────────────────────

async function requireOwnedDraft(
  ctx: QueryCtx | MutationCtx,
  draftId: Id<"purchaseDrafts">,
  functionName: string,
) {
  const userId = await requireAuthenticatedUserId(ctx, functionName);
  const draft = await ctx.db.get(draftId);
  if (!draft) {
    throwFunctionError("not_found", functionName, "Draft not found");
  }
  assertOwnedByUser(userId, draft.userId, functionName, {
    forbiddenMessage: "Draft not found or access denied",
  });
  return { draft, userId };
}

export const listDrafts = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("confirmed"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.evidence.listDrafts",
    );

    if (args.status) {
      return await ctx.db
        .query("purchaseDrafts")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", args.status!),
        )
        .collect();
    }
    return await ctx.db
      .query("purchaseDrafts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const listPreAlerts = query({
  args: { purchaseDraftId: v.optional(v.id("purchaseDrafts")) },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.evidence.listPreAlerts",
    );

    if (args.purchaseDraftId) {
      const draft = await ctx.db.get(args.purchaseDraftId);
      if (!draft) {
        throwFunctionError(
          "not_found",
          "integrations.evidence.listPreAlerts",
          "Draft not found",
        );
      }
      assertOwnedByUser(
        userId,
        draft.userId,
        "integrations.evidence.listPreAlerts",
        { forbiddenMessage: "Draft not found or access denied" },
      );
      return await ctx.db
        .query("packagePreAlerts")
        .withIndex("by_purchase_draft", (q) =>
          q.eq("purchaseDraftId", args.purchaseDraftId!),
        )
        .collect();
    }
    return await ctx.db
      .query("packagePreAlerts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getDraft = query({
  args: { draftId: v.id("purchaseDrafts") },
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.evidence.getDraft",
    );

    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.userId !== userId) return null;
    return draft;
  },
});

// ── Public mutations (called from frontend) ────────────────────────────

export const updateDraft = mutation({
  args: {
    draftId: v.id("purchaseDrafts"),
    updates: v.object({
      merchant: v.optional(v.string()),
      storeName: v.optional(v.string()),
      orderNumber: v.optional(v.string()),
      itemsSummary: v.optional(v.string()),
      valueUsd: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await requireOwnedDraft(
      ctx,
      args.draftId,
      "integrations.evidence.updateDraft",
    );

    await ctx.db.patch(args.draftId, args.updates);
  },
});

export const confirmDraft = mutation({
  args: { draftId: v.id("purchaseDrafts") },
  handler: async (ctx, args) => {
    await requireOwnedDraft(
      ctx,
      args.draftId,
      "integrations.evidence.confirmDraft",
    );

    await ctx.db.patch(args.draftId, {
      status: "confirmed",
      confirmedAt: Date.now(),
    });

    // Also confirm all related pre-alerts
    const preAlerts = await ctx.db
      .query("packagePreAlerts")
      .withIndex("by_purchase_draft", (q) =>
        q.eq("purchaseDraftId", args.draftId),
      )
      .collect();

    for (const pa of preAlerts) {
      if (pa.status === "draft") {
        await ctx.db.patch(pa._id, {
          status: "confirmed",
          confirmedAt: Date.now(),
        });
      }
    }
  },
});

export const rejectDraft = mutation({
  args: { draftId: v.id("purchaseDrafts") },
  handler: async (ctx, args) => {
    await requireOwnedDraft(
      ctx,
      args.draftId,
      "integrations.evidence.rejectDraft",
    );

    await ctx.db.patch(args.draftId, { status: "rejected" });
  },
});

export const uploadInvoice = mutation({
  args: {
    draftId: v.id("purchaseDrafts"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireOwnedDraft(
      ctx,
      args.draftId,
      "integrations.evidence.uploadInvoice",
    );

    await ctx.db.patch(args.draftId, {
      invoiceStorageId: args.storageId,
      invoicePresent: true,
    });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUserId(
      ctx,
      "integrations.evidence.generateUploadUrl",
    );
    return await ctx.storage.generateUploadUrl();
  },
});
