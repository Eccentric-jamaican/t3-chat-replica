import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  mutation,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthUserId } from "../auth";
import { extractPurchaseData, extractFromImage } from "./extractor";
import { getWhatsAppMediaUrl } from "./whatsapp/messaging";
import { requireAuthenticatedUserId } from "../lib/authGuards";
import {
  assertFunctionArgs,
  processWhatsappWebhookArgsSchema,
} from "../lib/functionBoundaries";
import { enforceFunctionRateLimit } from "../lib/functionRateLimit";
import { getRateLimits } from "../lib/rateLimit";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[misconfigured:${name}] missing`);
  }
  return value;
}

// ── Webhook processing ─────────────────────────────────────────────────

export const processWebhook = internalAction({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const input = assertFunctionArgs(
      processWhatsappWebhookArgsSchema,
      args,
      "integrations.whatsapp.processWebhook",
    );
    const entries = input.payload.entry || [];
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error("[WhatsApp] OPENROUTER_API_KEY not configured");
      return;
    }

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") continue;

        const messages = change.value?.messages || [];
        for (const message of messages) {
          const from = message.from; // E.164 phone number
          const sourceMessageId = message.id;
          if (!from || !sourceMessageId) continue;

          // Check if this is a linking code attempt (before user is linked)
          if (message.type === "text") {
            const text: string = message.text?.body || "";
            const linked = await tryLinkAccount(ctx, from, text);
            if (linked) continue;
          }

          // Find linked user
          const link = await ctx.runQuery(
            internal.integrations.whatsapp.getUserByPhone,
            { phoneNumber: from },
          );
          if (!link || link.status !== "active") continue;

          // Idempotency: check if message already processed
          const existing = await ctx.runQuery(
            internal.integrations.evidence.getBySourceMessageId,
            { sourceMessageId },
          );
          if (existing) continue;

          // Update last message time (for 24h window tracking)
          await ctx.runMutation(
            internal.integrations.whatsapp.updateLastMessageAt,
            { phoneNumber: from },
          );

          try {
            if (message.type === "image") {
              await processImageMessage(
                ctx,
                link.userId,
                message,
                apiKey,
              );
            } else if (message.type === "document") {
              await processDocumentMessage(
                ctx,
                link.userId,
                message,
                apiKey,
              );
            } else if (message.type === "text") {
              await processTextMessage(
                ctx,
                link.userId,
                message,
                apiKey,
              );
            }
          } catch (err: any) {
            console.error(
              `[WhatsApp] Processing failed for message ${message.id}:`,
              err.message,
            );
          }
        }
      }
    }
  },
});

async function tryLinkAccount(
  ctx: any,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const code = text.trim().toUpperCase();
  // Linking codes are 6 alphanumeric characters
  if (!/^[A-Z0-9]{6}$/.test(code)) return false;

  const pending = await ctx.runQuery(
    internal.integrations.whatsapp.getByLinkingCode,
    { linkingCode: code },
  );

  if (!pending) return false;
  if (
    pending.linkingCodeExpiresAt &&
    Date.now() > pending.linkingCodeExpiresAt
  ) {
    return false;
  }

  await ctx.runMutation(internal.integrations.whatsapp.completeLinking, {
    integrationId: pending._id,
    phoneNumber,
  });

  return true;
}

async function processImageMessage(
  ctx: any,
  userId: string,
  message: any,
  apiKey: string,
) {
  const mediaUrl = await getWhatsAppMediaUrl(message.image.id);
  if (!mediaUrl) {
    console.error("[WhatsApp] Could not get media URL for", message.image.id);
    return;
  }

  // Download and store in Convex storage
  const accessToken = getRequiredEnv("WHATSAPP_ACCESS_TOKEN");
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const blob = await response.blob();
  const storageId = await ctx.storage.store(blob);
  const fileUrl = await ctx.storage.getUrl(storageId);

  const evidenceId = await ctx.runMutation(
    internal.integrations.evidence.createEvidence,
    {
      userId,
      source: "whatsapp" as const,
      sourceMessageId: message.id,
      rawTextSnippet: message.image.caption || "[Image]",
      rawStorageId: storageId,
      receivedAt: Number(message.timestamp) * 1000,
      processedAt: Date.now(),
      status: "pending" as const,
    },
  );

  try {
    const extraction = await extractFromImage({ imageUrl: fileUrl, apiKey });
    await createDraftFromExtraction(ctx, userId, evidenceId, extraction);
    await ctx.runMutation(
      internal.integrations.evidence.updateEvidenceStatus,
      { evidenceId, status: "extracted" as const },
    );
    await ctx.runMutation(
      internal.integrations.evidence.redactEvidenceSnippet,
      { evidenceId },
    );
  } catch (err: any) {
    await ctx.runMutation(
      internal.integrations.evidence.updateEvidenceStatus,
      {
        evidenceId,
        status: "failed" as const,
        extractionError: err.message,
      },
    );
    await ctx.runMutation(
      internal.integrations.evidence.redactEvidenceSnippet,
      { evidenceId },
    );
  }
}

async function processDocumentMessage(
  ctx: any,
  userId: string,
  message: any,
  apiKey: string,
) {
  const mediaUrl = await getWhatsAppMediaUrl(message.document.id);
  if (!mediaUrl) return;

  const accessToken = getRequiredEnv("WHATSAPP_ACCESS_TOKEN");
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const blob = await response.blob();
  const storageId = await ctx.storage.store(blob);

  const evidenceId = await ctx.runMutation(
    internal.integrations.evidence.createEvidence,
    {
      userId,
      source: "whatsapp" as const,
      sourceMessageId: message.id,
      rawTextSnippet:
        message.document.caption ||
        message.document.filename ||
        "[Document]",
      rawStorageId: storageId,
      receivedAt: Number(message.timestamp) * 1000,
      processedAt: Date.now(),
      status: "pending" as const,
    },
  );

  // For PDFs: try extracting from the document as text via the LLM
  try {
    const fileUrl = await ctx.storage.getUrl(storageId);
    const extraction = await extractFromImage({ imageUrl: fileUrl, apiKey });
    await createDraftFromExtraction(ctx, userId, evidenceId, extraction);
    await ctx.runMutation(
      internal.integrations.evidence.updateEvidenceStatus,
      { evidenceId, status: "extracted" as const },
    );
    await ctx.runMutation(
      internal.integrations.evidence.redactEvidenceSnippet,
      { evidenceId },
    );
  } catch (err: any) {
    await ctx.runMutation(
      internal.integrations.evidence.updateEvidenceStatus,
      {
        evidenceId,
        status: "failed" as const,
        extractionError: err.message,
      },
    );
    await ctx.runMutation(
      internal.integrations.evidence.redactEvidenceSnippet,
      { evidenceId },
    );
  }
}

async function processTextMessage(
  ctx: any,
  userId: string,
  message: any,
  apiKey: string,
) {
  const text: string = message.text?.body || "";
  if (!text || text.length < 10) return; // Skip very short messages

  const trimmedText = text.slice(0, 4000);

  const evidenceId = await ctx.runMutation(
    internal.integrations.evidence.createEvidence,
    {
      userId,
      source: "whatsapp" as const,
      sourceMessageId: message.id,
      rawTextSnippet: trimmedText,
      receivedAt: Number(message.timestamp) * 1000,
      processedAt: Date.now(),
      status: "pending" as const,
    },
  );

  try {
    const extraction = await extractPurchaseData({
      text: trimmedText,
      source: "whatsapp",
      apiKey,
    });
    await createDraftFromExtraction(ctx, userId, evidenceId, extraction);
    await ctx.runMutation(
      internal.integrations.evidence.updateEvidenceStatus,
      { evidenceId, status: "extracted" as const },
    );
    await ctx.runMutation(
      internal.integrations.evidence.redactEvidenceSnippet,
      { evidenceId },
    );
  } catch (err: any) {
    await ctx.runMutation(
      internal.integrations.evidence.updateEvidenceStatus,
      {
        evidenceId,
        status: "failed" as const,
        extractionError: err.message,
      },
    );
    await ctx.runMutation(
      internal.integrations.evidence.redactEvidenceSnippet,
      { evidenceId },
    );
  }
}

async function createDraftFromExtraction(
  ctx: any,
  userId: string,
  evidenceId: any,
  extraction: any,
) {
  const draftId = await ctx.runMutation(
    internal.integrations.evidence.createPurchaseDraft,
    {
      userId,
      evidenceId,
      merchant: extraction.merchant,
      storeName: extraction.storeName,
      orderNumber: extraction.orderNumber ?? undefined,
      itemsSummary: extraction.itemsSummary ?? undefined,
      valueUsd: extraction.valueUsd ?? undefined,
      currency: extraction.currency ?? undefined,
      originalValue: extraction.originalValue ?? undefined,
      confidence: extraction.confidence,
      missingFields: extraction.missingFields,
      invoicePresent: extraction.invoicePresent,
    },
  );

  for (const tracking of extraction.trackingNumbers) {
    await ctx.runMutation(
      internal.integrations.evidence.createPackagePreAlert,
      {
        userId,
        purchaseDraftId: draftId,
        trackingNumber: tracking.number,
        carrier: tracking.carrier ?? undefined,
      },
    );
  }
}

// ── Internal queries/mutations ─────────────────────────────────────────

export const getUserByPhone = internalQuery({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("integrationsWhatsapp")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();
  },
});

export const getByLinkingCode = internalQuery({
  args: { linkingCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("integrationsWhatsapp")
      .withIndex("by_linking_code", (q) =>
        q.eq("linkingCode", args.linkingCode),
      )
      .first();
  },
});

export const completeLinking = internalMutation({
  args: {
    integrationId: v.id("integrationsWhatsapp"),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.integrationId, {
      phoneNumber: args.phoneNumber,
      status: "active" as const,
      linkingCode: undefined,
      linkingCodeExpiresAt: undefined,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
    });
  },
});

export const updateLastMessageAt = internalMutation({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("integrationsWhatsapp")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .first();
    if (link) {
      await ctx.db.patch(link._id, { lastMessageAt: Date.now() });
    }
  },
});

// ── Public queries/mutations (frontend) ────────────────────────────────

export const getLinkingStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const link = await ctx.db
      .query("integrationsWhatsapp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!link) return { linked: false as const };
    if (link.status === "active") {
      return {
        linked: true as const,
        phoneNumber: link.phoneNumber,
        connectedAt: link.connectedAt,
      };
    }
    if (link.status === "pending_link") {
      return {
        linked: false as const,
        linkingCode: link.linkingCode,
        linkingCodeExpiresAt: link.linkingCodeExpiresAt,
      };
    }
    return { linked: false as const };
  },
});

export const requestLinkingCode = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.whatsapp.requestLinkingCode",
    );

    const rateLimits = getRateLimits();
    await enforceFunctionRateLimit(ctx, {
      functionName: "integrations.whatsapp.requestLinkingCode",
      key: `whatsapp_linking_code:user:${userId}`,
      max: rateLimits.whatsappLinkingCode.max,
      windowMs: rateLimits.whatsappLinkingCode.windowMs,
    });

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = Date.now() + 10 * 60_000; // 10 minutes

    const existing = await ctx.db
      .query("integrationsWhatsapp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        linkingCode: code,
        linkingCodeExpiresAt: expiresAt,
        status: "pending_link" as const,
      });
    } else {
      await ctx.db.insert("integrationsWhatsapp", {
        userId,
        phoneNumber: "",
        linkingCode: code,
        linkingCodeExpiresAt: expiresAt,
        status: "pending_link",
      });
    }

    return code;
  },
});

export const disconnectWhatsapp = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(
      ctx,
      "integrations.whatsapp.disconnectWhatsapp",
    );

    const link = await ctx.db
      .query("integrationsWhatsapp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (link) {
      await ctx.db.patch(link._id, { status: "disconnected" as const });
    }
  },
});
