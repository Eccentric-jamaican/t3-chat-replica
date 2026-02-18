import { getAuthUserId } from "../auth";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { throwFunctionError } from "./functionErrors";

type AuthContext = {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

type ThreadAccessContext = Pick<QueryCtx | MutationCtx, "db" | "auth">;

export async function requireAuthenticatedUserId(
  ctx: AuthContext,
  functionName: string,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throwFunctionError("unauthorized", functionName, "Authentication required");
  }
  return userId;
}

export async function getOptionalAuthenticatedUserId(ctx: AuthContext) {
  return await getAuthUserId(ctx);
}

export function assertOwnedByUser(
  userId: string,
  ownerId: string | undefined,
  functionName: string,
  options?: { notFoundMessage?: string; forbiddenMessage?: string },
) {
  if (!ownerId) {
    throwFunctionError(
      "not_found",
      functionName,
      options?.notFoundMessage ?? "Resource not found",
    );
  }
  if (ownerId !== userId) {
    throwFunctionError(
      "forbidden",
      functionName,
      options?.forbiddenMessage ?? "Access denied",
    );
  }
}

export async function requireThreadAccess(
  ctx: ThreadAccessContext,
  args: {
    threadId: Id<"threads">;
    sessionId?: string;
    functionName: string;
  },
) {
  const thread = await ctx.db.get(args.threadId);
  if (!thread) {
    throwFunctionError("not_found", args.functionName, "Thread not found");
  }

  const userId = await getAuthUserId(ctx);
  if (thread.userId) {
    if (!userId || thread.userId !== userId) {
      console.warn("[SECURITY] Thread access denied", {
        threadId: args.threadId,
        threadOwner: thread.userId,
        requester: userId ?? "anonymous",
      });
      throwFunctionError("forbidden", args.functionName, "Access denied");
    }
  } else if (!args.sessionId || thread.sessionId !== args.sessionId) {
    console.warn("[SECURITY] Anonymous thread access denied", {
      threadId: args.threadId,
      threadSessionId: thread.sessionId,
      requesterSessionId: args.sessionId ?? "none",
    });
    throwFunctionError("forbidden", args.functionName, "Access denied");
  }

  return { thread, userId };
}

export async function requireMessageAccess(
  ctx: ThreadAccessContext,
  args: {
    messageId: Id<"messages">;
    sessionId?: string;
    functionName: string;
  },
) {
  const message = await ctx.db.get(args.messageId);
  if (!message) {
    throwFunctionError("not_found", args.functionName, "Message not found");
  }
  await requireThreadAccess(ctx, {
    threadId: message.threadId,
    sessionId: args.sessionId,
    functionName: args.functionName,
  });
  return message;
}
