import { z } from "zod";

export const chatRequestSchema = z.object({
  threadId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  webSearch: z.boolean().optional(),
  sessionId: z.string().optional(),
});

export const gmailPushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
  }),
});

export const gmailHistoryPayloadSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.string().min(1),
});

export const whatsappWebhookSchema = z.object({
  entry: z.array(z.any()).default([]),
});

