import { z } from "zod";

export const chatRequestSchema = z.object({
  threadId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  webSearch: z.boolean().optional(),
  sessionId: z.string().min(1).optional(),
});

export const chatAbortRequestSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
});

export const gmailPushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
  }),
});

export const gmailHistoryPayloadSchema = z.object({
  emailAddress: z.email(),
  historyId: z.string().min(1),
});

export const whatsappWebhookSchema = z.object({
  entry: z.array(z.any()).default([]),
});
