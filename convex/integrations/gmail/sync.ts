import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
  assertFunctionArgs,
  incrementalSyncArgsSchema,
  syncGmailArgsSchema,
} from "../../lib/functionBoundaries";
import { classifyGmailMessage } from "./classify";
import {
  buildFocusedSnippet,
  extractMessageBodiesWithAttachments,
  stripHtmlToText,
} from "./message";
import { merchantConfigs } from "./merchantConfig";
import { extractAmazonPurchaseData } from "./parsers/amazon";
import { extractSheinPurchaseData } from "./parsers/shein";
import {
  getValidAccessToken,
  listMessages,
  getMessage,
  getHistory,
  setupWatch,
} from "./api";
import { extractPurchaseData } from "../extractor";
import type { GmailMessageFull } from "./types";

type PurchaseDraftDoc = Doc<"purchaseDrafts">;

type MergeDuplicateCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

function splitOrderNumbers(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergeOrderNumbers(existing?: string | null, incoming?: string | null): string | null {
  const combined = [
    ...splitOrderNumbers(existing),
    ...splitOrderNumbers(incoming),
  ].map((v) => v.toUpperCase());
  const unique = Array.from(new Set(combined));
  return unique.length > 0 ? unique.join(",") : null;
}

function computeMissingFields(opts: {
  orderNumber?: string | null;
  valueUsd?: number | null;
  itemsSummary?: string | null;
  hasTracking: boolean;
}): string[] {
  const missing: string[] = [];
  if (!opts.orderNumber) missing.push("orderNumber");
  if (opts.valueUsd == null) missing.push("valueUsd");
  if (!opts.hasTracking) missing.push("trackingNumbers");
  if (!opts.itemsSummary) missing.push("itemsSummary");
  return missing;
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function mergeDuplicateDrafts(
  ctx: MergeDuplicateCtx,
  userId: string,
  primaryDraft: PurchaseDraftDoc,
  orderNumbers: string[],
  hasTracking: boolean,
) {
  if (orderNumbers.length === 0) return;

  const candidates: PurchaseDraftDoc[] = await ctx.runQuery(
    internal.integrations.evidence.getDraftsByOrderNumbers,
    { userId, orderNumbers },
  );
  const duplicates: PurchaseDraftDoc[] = candidates.filter(
    (draft) => draft._id !== primaryDraft._id,
  );
  if (duplicates.length === 0) return;

  let hasTrackingFinal = hasTracking;
  if (!hasTrackingFinal) {
    for (const dup of duplicates) {
      const dupHasTracking = await ctx.runQuery(
        internal.integrations.evidence.hasPreAlertsForDraft,
        { draftId: dup._id },
      );
      if (dupHasTracking) {
        hasTrackingFinal = true;
        break;
      }
    }
  }

  let mergedOrder = primaryDraft.orderNumber ?? null;
  for (const dup of duplicates) {
    mergedOrder = mergeOrderNumbers(mergedOrder, dup.orderNumber);
  }

  const mergedItemsSummary = primaryDraft.itemsSummary ??
    duplicates.find((d) => d.itemsSummary)?.itemsSummary ??
    null;
  const mergedValueUsd =
    primaryDraft.valueUsd != null && primaryDraft.valueUsd !== 0
      ? primaryDraft.valueUsd
      : duplicates.find((d) => d.valueUsd != null && d.valueUsd !== 0)
          ?.valueUsd ?? null;
  const mergedCurrency =
    primaryDraft.currency ??
    duplicates.find((d) => d.currency)?.currency ??
    null;
  const mergedOriginalValue =
    primaryDraft.originalValue != null && primaryDraft.originalValue !== 0
      ? primaryDraft.originalValue
      : duplicates.find(
            (d) => d.originalValue != null && d.originalValue !== 0,
          )?.originalValue ?? null;
  const mergedMerchant =
    primaryDraft.merchant && primaryDraft.merchant !== "unknown"
      ? primaryDraft.merchant
      : duplicates.find(
            (d) => d.merchant && d.merchant !== "unknown",
          )?.merchant;
  const mergedStoreName =
    primaryDraft.storeName ??
    duplicates.find((d) => d.storeName)?.storeName ??
    null;
  const mergedInvoicePresent =
    primaryDraft.invoicePresent ||
    duplicates.some((d) => d.invoicePresent);
  const mergedConfidence = Math.max(
    primaryDraft.confidence ?? 0,
    ...duplicates.map((d) => d.confidence ?? 0),
  );

  const updates: Record<string, unknown> = {};
  if (mergedMerchant && (!primaryDraft.merchant || primaryDraft.merchant === "unknown")) {
    updates.merchant = mergedMerchant;
  }
  if (!primaryDraft.storeName && mergedStoreName) {
    updates.storeName = mergedStoreName;
  }
  if (mergedOrder && mergedOrder !== primaryDraft.orderNumber) {
    updates.orderNumber = mergedOrder;
  }
  if (!primaryDraft.itemsSummary && mergedItemsSummary) {
    updates.itemsSummary = mergedItemsSummary;
  }
  if (
    (primaryDraft.valueUsd == null || primaryDraft.valueUsd === 0) &&
    mergedValueUsd != null
  ) {
    updates.valueUsd = mergedValueUsd;
  }
  if (!primaryDraft.currency && mergedCurrency) {
    updates.currency = mergedCurrency;
  }
  if (
    (primaryDraft.originalValue == null || primaryDraft.originalValue === 0) &&
    mergedOriginalValue != null
  ) {
    updates.originalValue = mergedOriginalValue;
  }
  if (mergedInvoicePresent && !primaryDraft.invoicePresent) {
    updates.invoicePresent = true;
  }
  if (mergedConfidence > (primaryDraft.confidence ?? 0)) {
    updates.confidence = mergedConfidence;
  }

  const finalOrder =
    (updates.orderNumber as string | undefined) ??
    primaryDraft.orderNumber ??
    null;
  const finalValue =
    (updates.valueUsd as number | undefined) ??
    primaryDraft.valueUsd ??
    null;
  const finalItems =
    (updates.itemsSummary as string | undefined) ??
    primaryDraft.itemsSummary ??
    null;
  const nextMissing = computeMissingFields({
    orderNumber: finalOrder,
    valueUsd: finalValue,
    itemsSummary: finalItems,
    hasTracking: hasTrackingFinal,
  });
  const currentMissing = primaryDraft.missingFields ?? [];
  if (JSON.stringify(nextMissing) !== JSON.stringify(currentMissing)) {
    updates.missingFields = nextMissing;
  }

  if (Object.keys(updates).length > 0) {
    await ctx.runMutation(
      internal.integrations.evidence.updateDraftFromExtraction,
      { draftId: primaryDraft._id, updates },
    );
  }

  await ctx.runMutation(internal.integrations.evidence.mergeDrafts, {
    primaryDraftId: primaryDraft._id,
    duplicateDraftIds: duplicates.map((d) => d._id),
  });
}

/**
 * Full sync: fetches recent messages, filters through merchant gate,
 * extracts purchase data, and creates drafts.
 */
export const syncGmail = internalAction({
  args: {
    userId: v.string(),
    daysBack: v.optional(v.number()),
    query: v.optional(v.string()),
    maxMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const input = assertFunctionArgs(
      syncGmailArgsSchema,
      args,
      "integrations.gmail.sync.syncGmail",
    );

    const connection = await ctx.runQuery(
      internal.integrations.gmail.oauth.getGmailConnection,
      { userId: input.userId },
    );
    if (!connection || connection.status !== "active") {
      throw new Error("Gmail not connected");
    }

    const prefs = await ctx.runQuery(
      internal.integrations.preferences.getByUserId,
      { userId: input.userId },
    );
    if (prefs && prefs.gmailSyncEnabled === false) {
      console.log("[Gmail Sync] Skipped (disabled by user)");
      return { processed: 0, draftsCreated: 0, draftsUpdated: 0 };
    }

    const { accessToken, expiresAt, refreshed } =
      await getValidAccessToken(connection);
    if (refreshed) {
      await ctx.runMutation(
        internal.integrations.gmail.oauth.updateAccessToken,
        {
          connectionId: connection._id,
          accessToken,
          accessTokenExpiresAt: expiresAt,
        },
      );
    }

    const daysBack = input.daysBack ?? 7;
    const maxMessages = Math.min(Math.max(input.maxMessages ?? 500, 1), 2000);

    // Gmail list is paginated; scan more than a single page so we don't miss
    // relevant receipts in busy inboxes. Also run targeted merchant queries
    // so high-volume inboxes still surface important receipts.
    const messages: { id: string; threadId: string }[] = [];
    const seen = new Set<string>();

    const addMessages = (items: { id: string; threadId: string }[]) => {
      for (const msg of items) {
        if (!msg?.id || seen.has(msg.id)) continue;
        seen.add(msg.id);
        messages.push(msg);
      }
    };

    if (input.query) {
      // Targeted sync: only process messages matching the query.
      let pageToken: string | undefined;
      for (let page = 0; page < 5 && messages.length < maxMessages; page += 1) {
        const pageRes = await listMessages(accessToken, {
          daysBack,
          maxResults: 100,
          pageToken,
          query: input.query,
        });
        addMessages(pageRes.messages ?? []);
        if (!pageRes.nextPageToken) break;
        pageToken = pageRes.nextPageToken;
      }
    } else {
      let pageToken: string | undefined;
      for (let page = 0; page < 5 && messages.length < maxMessages; page += 1) {
        const pageRes = await listMessages(accessToken, {
          daysBack,
          maxResults: 100,
          pageToken,
        });
        addMessages(pageRes.messages ?? []);
        if (!pageRes.nextPageToken) break;
        pageToken = pageRes.nextPageToken;
      }

      // Targeted merchant queries to ensure receipts aren't buried past 500.
      for (const merchant of Object.values(merchantConfigs)) {
        const domains = [
          ...merchant.dkimAllow,
          ...(merchant.fromAllow ?? []),
        ].filter(Boolean);
        if (domains.length === 0) continue;

        const fromQuery = domains.map((d) => `from:${d}`).join(" OR ");
        const subjectQuery = merchant.displayName
          ? `subject:${merchant.displayName}`
          : "";
        const q = subjectQuery
          ? `(${fromQuery}) OR ${subjectQuery}`
          : fromQuery;

        const res = await listMessages(accessToken, {
          daysBack,
          maxResults: 100,
          query: q,
        });
        addMessages(res.messages ?? []);
      }

      // Generic subject keyword query as a backstop.
      const keywordQuery =
        "subject:(order OR shipped OR delivered OR tracking OR confirmation OR dispatch)";
      const keywordRes = await listMessages(accessToken, {
        daysBack,
        maxResults: 100,
        query: keywordQuery,
      });
      addMessages(keywordRes.messages ?? []);
    }

    if (!messages?.length) {
      console.log("[Gmail Sync] No messages found");
      return { processed: 0, draftsCreated: 0, draftsUpdated: 0 };
    }

    let scanned = 0;
    let processed = 0;
    let draftsCreated = 0;
    let draftsUpdated = 0;

    for (const msgRef of messages) {
      scanned++;
      // Idempotency: skip already-processed messages
      const existing = await ctx.runQuery(
        internal.integrations.evidence.getBySourceMessageId,
        { sourceMessageId: msgRef.id },
      );
      if (existing) continue;

      // Fetch full message
      const fullMessage: GmailMessageFull = await getMessage(
        accessToken,
        msgRef.id,
      );

      const bodies = await extractMessageBodiesWithAttachments(
        accessToken,
        fullMessage,
      );

      // Run merchant classification
      const classification = classifyGmailMessage(fullMessage, bodies);
      if (!classification.matched) continue;

      // Extract bodies
      const { text, html } = bodies;
      const baseText = [text, html ? stripHtmlToText(html) : "", fullMessage.snippet || ""]
        .filter(Boolean)
        .join("\n");

      // Trim to max 4000 chars for data minimization, but focus around
      // order/tracking keywords if the email is very long.
      const trimmedText = buildFocusedSnippet(baseText, { maxLen: 4000 });

      // Create evidence record
      const evidenceId = await ctx.runMutation(
        internal.integrations.evidence.createEvidence,
          {
          userId: input.userId,
          source: "gmail" as const,
          sourceMessageId: msgRef.id,
          merchant: classification.merchant,
          rawTextSnippet: trimmedText,
          receivedAt: Number(fullMessage.internalDate || Date.now()),
          processedAt: Date.now(),
          status: "pending" as const,
        },
      );

      try {
        let extraction = null;
        if (classification.merchant === "shein") {
          extraction = extractSheinPurchaseData(trimmedText);
        } else if (classification.merchant === "amazon") {
          extraction = extractAmazonPurchaseData(trimmedText);
        }

        const needsFallback =
          !extraction ||
          (!extraction.orderNumber &&
            extraction.trackingNumbers.length === 0);

        if (needsFallback) {
          const apiKey = process.env.OPENROUTER_API_KEY;
          if (!apiKey) {
            throw new Error("OPENROUTER_API_KEY not configured");
          }
          extraction = await extractPurchaseData({
            text: trimmedText,
            source: "gmail",
            apiKey,
            merchantHint: classification.merchant,
          });
        }

        if (!extraction) {
          throw new Error("Extraction failed");
        }

        const hasCore =
          !!extraction.orderNumber || extraction.trackingNumbers.length > 0;
        if (!hasCore) {
          await ctx.runMutation(
            internal.integrations.evidence.updateEvidenceStatus,
            {
              evidenceId,
              status: "failed" as const,
              extractionError: "insufficient_core_fields",
            },
          );
          await ctx.runMutation(
            internal.integrations.evidence.redactEvidenceSnippet,
            { evidenceId },
          );
          processed++;
          continue;
        }

        let existingDraft = null;
        const orderNumbers = splitOrderNumbers(extraction.orderNumber);
        for (const order of orderNumbers) {
          existingDraft = await ctx.runQuery(
            internal.integrations.evidence.getDraftByOrderNumber,
            { userId: input.userId, orderNumber: order },
          );
          if (existingDraft) break;
        }

        if (!existingDraft) {
          for (const tracking of extraction.trackingNumbers) {
            existingDraft = await ctx.runQuery(
              internal.integrations.evidence.getDraftByTrackingNumber,
              {
                userId: input.userId,
                trackingNumber: tracking.number,
              },
            );
            if (existingDraft) break;
          }
        }

        if (existingDraft) {
          const existingOrder = existingDraft.orderNumber ?? null;
          const mergedOrder = mergeOrderNumbers(
            existingOrder,
            extraction.orderNumber,
          );

          const hasTracking =
            extraction.trackingNumbers.length > 0 ||
            (await ctx.runQuery(
              internal.integrations.evidence.hasPreAlertsForDraft,
              { draftId: existingDraft._id },
            ));

          const updates: Record<string, unknown> = {};
          if (
            (!existingDraft.merchant || existingDraft.merchant === "unknown") &&
            extraction.merchant
          ) {
            updates.merchant = extraction.merchant;
          }
          if (!existingDraft.storeName && extraction.storeName) {
            updates.storeName = extraction.storeName;
          }
          if (mergedOrder && mergedOrder !== existingOrder) {
            updates.orderNumber = mergedOrder;
          }
          if (!existingDraft.itemsSummary && extraction.itemsSummary) {
            updates.itemsSummary = extraction.itemsSummary;
          }
          if (
            (existingDraft.valueUsd == null || existingDraft.valueUsd === 0) &&
            extraction.valueUsd != null
          ) {
            updates.valueUsd = extraction.valueUsd;
          }
          if (!existingDraft.currency && extraction.currency) {
            updates.currency = extraction.currency;
          }
          if (
            (existingDraft.originalValue == null ||
              existingDraft.originalValue === 0) &&
            extraction.originalValue != null
          ) {
            updates.originalValue = extraction.originalValue;
          }
          if (extraction.invoicePresent && !existingDraft.invoicePresent) {
            updates.invoicePresent = true;
          }
          if (extraction.confidence > existingDraft.confidence) {
            updates.confidence = extraction.confidence;
          }

          const finalOrder =
            (updates.orderNumber as string | undefined) ??
            existingDraft.orderNumber ??
            null;
          const finalValue =
            (updates.valueUsd as number | undefined) ??
            existingDraft.valueUsd ??
            null;
          const finalItems =
            (updates.itemsSummary as string | undefined) ??
            existingDraft.itemsSummary ??
            null;

          updates.missingFields = computeMissingFields({
            orderNumber: finalOrder,
            valueUsd: finalValue,
            itemsSummary: finalItems,
            hasTracking,
          });

          const primarySnapshot = { ...existingDraft, ...updates };

          if (Object.keys(updates).length > 0) {
            await ctx.runMutation(
              internal.integrations.evidence.updateDraftFromExtraction,
              { draftId: existingDraft._id, updates },
            );
          }

          for (const tracking of extraction.trackingNumbers) {
            await ctx.runMutation(
              internal.integrations.evidence.createPackagePreAlert,
              {
                userId: input.userId,
                purchaseDraftId: existingDraft._id,
                trackingNumber: tracking.number,
                carrier: tracking.carrier ?? undefined,
              },
            );
          }

          await mergeDuplicateDrafts(
            ctx,
            input.userId,
            primarySnapshot,
            splitOrderNumbers(
              primarySnapshot.orderNumber ?? extraction.orderNumber,
            ),
            hasTracking,
          );

          await ctx.runMutation(
            internal.integrations.evidence.updateEvidenceStatus,
            { evidenceId, status: "extracted" as const },
          );
          await ctx.runMutation(
            internal.integrations.evidence.redactEvidenceSnippet,
            { evidenceId },
          );

          draftsUpdated++;
        } else {
          const draftId = await ctx.runMutation(
            internal.integrations.evidence.createPurchaseDraft,
            {
              userId: input.userId,
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
                userId: input.userId,
                purchaseDraftId: draftId,
                trackingNumber: tracking.number,
                carrier: tracking.carrier ?? undefined,
              },
            );
          }

          await ctx.runMutation(
            internal.integrations.evidence.updateEvidenceStatus,
            { evidenceId, status: "extracted" as const },
          );
          await ctx.runMutation(
            internal.integrations.evidence.redactEvidenceSnippet,
            { evidenceId },
          );

          draftsCreated++;
        }
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        console.error("[Gmail Sync] Extraction failed:", message);
        await ctx.runMutation(
          internal.integrations.evidence.updateEvidenceStatus,
          {
            evidenceId,
            status: "failed" as const,
            extractionError: message,
          },
        );
        await ctx.runMutation(
          internal.integrations.evidence.redactEvidenceSnippet,
          { evidenceId },
        );
      }

      processed++;
    }

    // Update lastSyncAt
    if (connection.historyId) {
      await ctx.runMutation(
        internal.integrations.gmail.oauth.updateHistoryId,
        {
          connectionId: connection._id,
          historyId: connection.historyId,
          lastSyncAt: Date.now(),
        },
      );
    }

    console.log(
      `[Gmail Sync] Done: ${processed} processed, ${draftsCreated} drafts created, ${draftsUpdated} drafts updated (scanned ${scanned})`,
    );
    return { processed, draftsCreated, draftsUpdated };
  },
});

/**
 * Incremental sync: processes new messages since last known historyId.
 * Triggered by Pub/Sub push notifications.
 */
export const incrementalSync = internalAction({
  args: {
    emailAddress: v.string(),
    newHistoryId: v.string(),
  },
  handler: async (ctx, args) => {
    const input = assertFunctionArgs(
      incrementalSyncArgsSchema,
      args,
      "integrations.gmail.sync.incrementalSync",
    );

    const connection = await ctx.runQuery(
      internal.integrations.gmail.oauth.getConnectionByEmail,
      { email: input.emailAddress },
    );
    if (!connection || connection.status !== "active") return;

    const prefs = await ctx.runQuery(
      internal.integrations.preferences.getByUserId,
      { userId: connection.userId },
    );
    if (prefs && prefs.gmailSyncEnabled === false) {
      return;
    }

    if (!connection.historyId) {
      // No historyId — trigger full sync instead
      await ctx.runAction(internal.integrations.gmail.sync.syncGmail, {
        userId: connection.userId,
        daysBack: 7,
      });
      return;
    }

    const { accessToken, expiresAt, refreshed } =
      await getValidAccessToken(connection);
    if (refreshed) {
      await ctx.runMutation(
        internal.integrations.gmail.oauth.updateAccessToken,
        {
          connectionId: connection._id,
          accessToken,
          accessTokenExpiresAt: expiresAt,
        },
      );
    }

    // Fetch history since last known historyId
    const history = await getHistory(accessToken, connection.historyId);

    // Extract new message IDs from history
    const messageIds = new Set<string>();
    for (const record of history.history || []) {
      for (const msg of record.messagesAdded || []) {
        const addedMessageId = msg.message?.id;
        if (addedMessageId) {
          messageIds.add(addedMessageId);
        }
      }
    }

    let draftsCreated = 0;
    let draftsUpdated = 0;

    for (const messageId of messageIds) {
      // Idempotency check
      const existing = await ctx.runQuery(
        internal.integrations.evidence.getBySourceMessageId,
        { sourceMessageId: messageId },
      );
      if (existing) continue;

      const fullMessage: GmailMessageFull = await getMessage(
        accessToken,
        messageId,
      );

      const bodies = await extractMessageBodiesWithAttachments(
        accessToken,
        fullMessage,
      );

      const classification = classifyGmailMessage(fullMessage, bodies);
      if (!classification.matched) continue;

      const { text, html } = bodies;
      const baseText = [text, html ? stripHtmlToText(html) : "", fullMessage.snippet || ""]
        .filter(Boolean)
        .join("\n");
      const trimmedText = buildFocusedSnippet(baseText, { maxLen: 4000 });

      const evidenceId = await ctx.runMutation(
        internal.integrations.evidence.createEvidence,
        {
          userId: connection.userId,
          source: "gmail" as const,
          sourceMessageId: messageId,
          merchant: classification.merchant,
          rawTextSnippet: trimmedText,
          receivedAt: Number(fullMessage.internalDate || Date.now()),
          processedAt: Date.now(),
          status: "pending" as const,
        },
      );

      try {
        let extraction = null;
        if (classification.merchant === "shein") {
          extraction = extractSheinPurchaseData(trimmedText);
        } else if (classification.merchant === "amazon") {
          extraction = extractAmazonPurchaseData(trimmedText);
        }

        const needsFallback =
          !extraction ||
          (!extraction.orderNumber &&
            extraction.trackingNumbers.length === 0);

        if (needsFallback) {
          const apiKey = process.env.OPENROUTER_API_KEY;
          if (!apiKey) {
            throw new Error("OPENROUTER_API_KEY not configured");
          }
          extraction = await extractPurchaseData({
            text: trimmedText,
            source: "gmail",
            apiKey,
            merchantHint: classification.merchant,
          });
        }

        if (!extraction) {
          throw new Error("Extraction failed");
        }

        const hasCore =
          !!extraction.orderNumber || extraction.trackingNumbers.length > 0;
        if (!hasCore) {
          await ctx.runMutation(
            internal.integrations.evidence.updateEvidenceStatus,
            {
              evidenceId,
              status: "failed" as const,
              extractionError: "insufficient_core_fields",
            },
          );
          await ctx.runMutation(
            internal.integrations.evidence.redactEvidenceSnippet,
            { evidenceId },
          );
          continue;
        }

        let existingDraft = null;
        const orderNumbers = splitOrderNumbers(extraction.orderNumber);
        for (const order of orderNumbers) {
          existingDraft = await ctx.runQuery(
            internal.integrations.evidence.getDraftByOrderNumber,
            { userId: connection.userId, orderNumber: order },
          );
          if (existingDraft) break;
        }

        if (!existingDraft) {
          for (const tracking of extraction.trackingNumbers) {
            existingDraft = await ctx.runQuery(
              internal.integrations.evidence.getDraftByTrackingNumber,
              {
                userId: connection.userId,
                trackingNumber: tracking.number,
              },
            );
            if (existingDraft) break;
          }
        }

        if (existingDraft) {
          const existingOrder = existingDraft.orderNumber ?? null;
          const mergedOrder = mergeOrderNumbers(
            existingOrder,
            extraction.orderNumber,
          );

          const hasTracking =
            extraction.trackingNumbers.length > 0 ||
            (await ctx.runQuery(
              internal.integrations.evidence.hasPreAlertsForDraft,
              { draftId: existingDraft._id },
            ));

          const updates: Record<string, unknown> = {};
          if (
            (!existingDraft.merchant || existingDraft.merchant === "unknown") &&
            extraction.merchant
          ) {
            updates.merchant = extraction.merchant;
          }
          if (!existingDraft.storeName && extraction.storeName) {
            updates.storeName = extraction.storeName;
          }
          if (mergedOrder && mergedOrder !== existingOrder) {
            updates.orderNumber = mergedOrder;
          }
          if (!existingDraft.itemsSummary && extraction.itemsSummary) {
            updates.itemsSummary = extraction.itemsSummary;
          }
          if (
            (existingDraft.valueUsd == null || existingDraft.valueUsd === 0) &&
            extraction.valueUsd != null
          ) {
            updates.valueUsd = extraction.valueUsd;
          }
          if (!existingDraft.currency && extraction.currency) {
            updates.currency = extraction.currency;
          }
          if (
            (existingDraft.originalValue == null ||
              existingDraft.originalValue === 0) &&
            extraction.originalValue != null
          ) {
            updates.originalValue = extraction.originalValue;
          }
          if (extraction.invoicePresent && !existingDraft.invoicePresent) {
            updates.invoicePresent = true;
          }
          if (extraction.confidence > existingDraft.confidence) {
            updates.confidence = extraction.confidence;
          }

          const finalOrder =
            (updates.orderNumber as string | undefined) ??
            existingDraft.orderNumber ??
            null;
          const finalValue =
            (updates.valueUsd as number | undefined) ??
            existingDraft.valueUsd ??
            null;
          const finalItems =
            (updates.itemsSummary as string | undefined) ??
            existingDraft.itemsSummary ??
            null;

          updates.missingFields = computeMissingFields({
            orderNumber: finalOrder,
            valueUsd: finalValue,
            itemsSummary: finalItems,
            hasTracking,
          });

          const primarySnapshot = { ...existingDraft, ...updates };

          if (Object.keys(updates).length > 0) {
            await ctx.runMutation(
              internal.integrations.evidence.updateDraftFromExtraction,
              { draftId: existingDraft._id, updates },
            );
          }

          for (const tracking of extraction.trackingNumbers) {
            await ctx.runMutation(
              internal.integrations.evidence.createPackagePreAlert,
              {
                userId: connection.userId,
                purchaseDraftId: existingDraft._id,
                trackingNumber: tracking.number,
                carrier: tracking.carrier ?? undefined,
              },
            );
          }

          await mergeDuplicateDrafts(
            ctx,
            connection.userId,
            primarySnapshot,
            splitOrderNumbers(
              primarySnapshot.orderNumber ?? extraction.orderNumber,
            ),
            hasTracking,
          );

          await ctx.runMutation(
            internal.integrations.evidence.updateEvidenceStatus,
            { evidenceId, status: "extracted" as const },
          );
          await ctx.runMutation(
            internal.integrations.evidence.redactEvidenceSnippet,
            { evidenceId },
          );

          draftsUpdated++;
        } else {
          const draftId = await ctx.runMutation(
            internal.integrations.evidence.createPurchaseDraft,
            {
              userId: connection.userId,
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
                userId: connection.userId,
                purchaseDraftId: draftId,
                trackingNumber: tracking.number,
                carrier: tracking.carrier ?? undefined,
              },
            );
          }

          await ctx.runMutation(
            internal.integrations.evidence.updateEvidenceStatus,
            { evidenceId, status: "extracted" as const },
          );
          await ctx.runMutation(
            internal.integrations.evidence.redactEvidenceSnippet,
            { evidenceId },
          );
          draftsCreated++;
        }
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        console.error("[Gmail Incremental] Extraction failed:", message);
        await ctx.runMutation(
          internal.integrations.evidence.updateEvidenceStatus,
          {
            evidenceId,
            status: "failed" as const,
            extractionError: message,
          },
        );
        await ctx.runMutation(
          internal.integrations.evidence.redactEvidenceSnippet,
          { evidenceId },
        );
      }
    }

    // Update historyId to the new one
    await ctx.runMutation(internal.integrations.gmail.oauth.updateHistoryId, {
      connectionId: connection._id,
      historyId: input.newHistoryId,
      lastSyncAt: Date.now(),
    });

    console.log(
      `[Gmail Incremental] ${messageIds.size} messages checked, ${draftsCreated} drafts created, ${draftsUpdated} drafts updated`,
    );
  },
});

/**
 * Renews Gmail watch subscriptions for all active connections.
 * Called by cron every 6 days (watches expire after 7).
 */
export const renewAllWatches = internalAction({
  args: {},
  handler: async (ctx) => {
    const topicName = process.env.GMAIL_PUBSUB_TOPIC;
    if (!topicName) {
      console.error("[Gmail Watch] GMAIL_PUBSUB_TOPIC not configured");
      return;
    }

    const connections = await ctx.runQuery(
      internal.integrations.gmail.oauth.listActiveConnections,
    );

    for (const conn of connections) {
      try {
        const prefs = await ctx.runQuery(
          internal.integrations.preferences.getByUserId,
          { userId: conn.userId },
        );
        if (prefs && prefs.gmailSyncEnabled === false) {
          continue;
        }

        const { accessToken, expiresAt, refreshed } =
          await getValidAccessToken(conn);
        if (refreshed) {
          await ctx.runMutation(
            internal.integrations.gmail.oauth.updateAccessToken,
            {
              connectionId: conn._id,
              accessToken,
              accessTokenExpiresAt: expiresAt,
            },
          );
        }

        const result = await setupWatch(accessToken, topicName);

        await ctx.runMutation(
          internal.integrations.gmail.oauth.updateWatchExpiration,
          {
            connectionId: conn._id,
            watchExpiration: Number(result.expiration),
            historyId: result.historyId,
          },
        );

        console.log(
          `[Gmail Watch] Renewed for user ${conn.userId}, expires ${result.expiration}`,
        );
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        console.error(
          `[Gmail Watch] Renewal failed for user ${conn.userId}:`,
          message,
        );
      }
    }
  },
});

/**
 * Catch-up sync for all active connections.
 * Runs periodically to handle missed Pub/Sub notifications.
 */
export const catchupSync = internalAction({
  args: {},
  handler: async (ctx) => {
    const connections = await ctx.runQuery(
      internal.integrations.gmail.oauth.listActiveConnections,
    );

    for (const conn of connections) {
      const prefs = await ctx.runQuery(
        internal.integrations.preferences.getByUserId,
        { userId: conn.userId },
      );
      if (prefs && prefs.gmailSyncEnabled === false) {
        continue;
      }

      // Only catch up if last sync was more than 25 minutes ago
      if (conn.lastSyncAt && Date.now() - conn.lastSyncAt < 25 * 60_000) {
        continue;
      }

      try {
        await ctx.runAction(internal.integrations.gmail.sync.syncGmail, {
          userId: conn.userId,
          daysBack: 1,
        });
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        console.error(
          `[Gmail Catchup] Failed for user ${conn.userId}:`,
          message,
        );
      }
    }
  },
});
