import { z } from "zod";
import { throwFunctionError } from "./functionErrors";

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => issue.message).join(", ");
}

export function assertFunctionArgs<T>(
  schema: z.ZodType<T>,
  args: unknown,
  functionName: string,
): T {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throwFunctionError(
      "invalid_function_args",
      functionName,
      formatIssues(parsed.error),
    );
  }
  return parsed.data;
}

export const gmailStoreConnectionArgsSchema = z.object({
  userId: z.string().min(1).max(256),
  email: z.string().email(),
  encryptedRefreshToken: z.string().min(1),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int().positive(),
  historyId: z.string().min(1).max(256).optional(),
});

export const syncGmailArgsSchema = z.object({
  userId: z.string().min(1).max(256),
  daysBack: z.number().int().min(1).max(30).optional(),
  query: z.string().min(1).max(512).optional(),
  maxMessages: z.number().int().min(1).max(2000).optional(),
});

export const incrementalSyncArgsSchema = z.object({
  emailAddress: z.string().email(),
  newHistoryId: z.string().min(1).max(256),
});

const whatsappMessageSchema = z
  .object({
    id: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    timestamp: z.string().optional(),
    type: z.string().min(1),
    text: z
      .object({
        body: z.string().optional(),
      })
      .optional(),
    image: z
      .object({
        id: z.string().min(1),
        caption: z.string().optional(),
      })
      .optional(),
    document: z
      .object({
        id: z.string().min(1),
        caption: z.string().optional(),
        filename: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const whatsappChangeSchema = z
  .object({
    field: z.string().min(1),
    value: z
      .object({
        messages: z.array(whatsappMessageSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const whatsappEntrySchema = z
  .object({
    changes: z.array(whatsappChangeSchema).default([]),
  })
  .passthrough();

export const processWhatsappWebhookArgsSchema = z.object({
  payload: z
    .object({
      entry: z.array(whatsappEntrySchema).default([]),
    })
    .passthrough(),
});
