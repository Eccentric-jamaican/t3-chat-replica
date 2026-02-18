import { describe, expect, test, vi } from "vitest";
import {
  assertOwnedByUser,
  requireAuthenticatedUserId,
  requireMessageAccess,
  requireThreadAccess,
} from "./authGuards";

type MockDoc = Record<string, any>;

function makeCtx(options?: {
  userId?: string | null;
  docs?: Record<string, MockDoc>;
}) {
  const docs = options?.docs ?? {};
  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(
        options?.userId ? { subject: options.userId } : null,
      ),
    },
    db: {
      get: vi.fn(async (id: string) => docs[id] ?? null),
    },
  };
}

describe("authGuards", () => {
  test("requireAuthenticatedUserId returns user id", async () => {
    const ctx = makeCtx({ userId: "user_1" });
    await expect(
      requireAuthenticatedUserId(ctx, "favorites.createList"),
    ).resolves.toBe("user_1");
  });

  test("requireAuthenticatedUserId throws classified unauthorized error", async () => {
    const ctx = makeCtx({ userId: null });
    await expect(
      requireAuthenticatedUserId(ctx, "favorites.createList"),
    ).rejects.toThrow("[unauthorized:favorites.createList]");
  });

  test("assertOwnedByUser throws forbidden on owner mismatch", () => {
    expect(() =>
      assertOwnedByUser("user_a", "user_b", "favorites.renameList"),
    ).toThrow("[forbidden:favorites.renameList]");
  });

  test("requireThreadAccess allows authenticated owner", async () => {
    const ctx = makeCtx({
      userId: "user_1",
      docs: {
        thread_1: { _id: "thread_1", userId: "user_1", sessionId: "sess_1" },
      },
    });

    await expect(
      requireThreadAccess(ctx as any, {
        threadId: "thread_1" as any,
        functionName: "messages.list",
      }),
    ).resolves.toMatchObject({ userId: "user_1" });
  });

  test("requireThreadAccess allows anonymous session owner", async () => {
    const ctx = makeCtx({
      userId: null,
      docs: {
        thread_1: { _id: "thread_1", userId: undefined, sessionId: "sess_1" },
      },
    });

    await expect(
      requireThreadAccess(ctx as any, {
        threadId: "thread_1" as any,
        sessionId: "sess_1",
        functionName: "messages.list",
      }),
    ).resolves.toBeTruthy();
  });

  test("requireThreadAccess rejects wrong owner/session", async () => {
    const ctx = makeCtx({
      userId: "user_2",
      docs: {
        thread_1: { _id: "thread_1", userId: "user_1", sessionId: "sess_1" },
      },
    });

    await expect(
      requireThreadAccess(ctx as any, {
        threadId: "thread_1" as any,
        functionName: "messages.list",
      }),
    ).rejects.toThrow("[forbidden:messages.list]");
  });

  test("requireMessageAccess resolves when parent thread is accessible", async () => {
    const ctx = makeCtx({
      userId: "user_1",
      docs: {
        message_1: { _id: "message_1", threadId: "thread_1" },
        thread_1: { _id: "thread_1", userId: "user_1", sessionId: "sess_1" },
      },
    });

    await expect(
      requireMessageAccess(ctx as any, {
        messageId: "message_1" as any,
        functionName: "messages.update",
      }),
    ).resolves.toMatchObject({ _id: "message_1" });
  });

  test("requireMessageAccess throws on missing message", async () => {
    const ctx = makeCtx({ userId: "user_1" });
    await expect(
      requireMessageAccess(ctx as any, {
        messageId: "missing" as any,
        functionName: "messages.update",
      }),
    ).rejects.toThrow("[not_found:messages.update]");
  });
});
