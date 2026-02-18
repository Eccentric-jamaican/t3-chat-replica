import { decrypt } from "../crypto";
import { fetchWithRetry } from "../../lib/network";

function looksEncrypted(token: string): boolean {
  return token.split(":").length === 3;
}

async function maybeDecryptToken(token: string): Promise<string> {
  if (!token) return token;
  return looksEncrypted(token) ? await decrypt(token) : token;
}

/**
 * Refreshes a Gmail access token using an encrypted refresh token.
 */
export async function refreshAccessToken(
  encryptedRefreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const refreshToken = await decrypt(encryptedRefreshToken);
  const response = await fetchWithRetry(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
        client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    },
    {
      timeoutMs: 10_000,
      retries: 2,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Returns a valid access token, refreshing if necessary.
 * Caller should persist the new token if `refreshed` is true.
 */
export async function getValidAccessToken(connection: {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  encryptedRefreshToken: string;
}): Promise<{
  accessToken: string;
  expiresAt: number;
  refreshed: boolean;
}> {
  // Use existing token if it has at least 60s of life left
  if (
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt > Date.now() + 60_000
  ) {
    return {
      accessToken: await maybeDecryptToken(connection.accessToken),
      expiresAt: connection.accessTokenExpiresAt,
      refreshed: false,
    };
  }
  const { accessToken, expiresAt } = await refreshAccessToken(
    connection.encryptedRefreshToken,
  );
  return { accessToken, expiresAt, refreshed: true };
}

/**
 * Lists Gmail messages matching a query, scoped to the last N days.
 */
export async function listMessages(
  accessToken: string,
  opts: {
    daysBack?: number;
    maxResults?: number;
    query?: string;
    pageToken?: string;
  },
): Promise<{
  messages: { id: string; threadId: string }[];
  nextPageToken?: string;
}> {
  const daysBack = opts.daysBack ?? 7;
  const after = new Date(Date.now() - daysBack * 86400_000);
  const afterStr = `${after.getFullYear()}/${after.getMonth() + 1}/${after.getDate()}`;
  const q = opts.query
    ? `after:${afterStr} ${opts.query}`
    : `after:${afterStr}`;

  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(opts.maxResults ?? 50));
  if (opts.pageToken) {
    url.searchParams.set("pageToken", opts.pageToken);
  }

  const res = await fetchWithRetry(
    url.toString(),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: 10_000,
      retries: 2,
    },
  );

  if (!res.ok) {
    throw new Error(`Gmail list failed (${res.status})`);
  }
  const data = await res.json();
  return {
    messages: data.messages || [],
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Fetches a full Gmail message by ID.
 */
export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<any> {
  const res = await fetchWithRetry(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: 10_000,
      retries: 2,
    },
  );
  if (!res.ok) {
    throw new Error(`Gmail get message failed (${res.status})`);
  }
  return await res.json();
}

/**
 * Fetches a Gmail message attachment body by attachmentId.
 * Used when message parts omit inline `body.data` (common for larger HTML emails).
 */
export async function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
): Promise<{ data?: string; size?: number }> {
  const res = await fetchWithRetry(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: 10_000,
      retries: 2,
    },
  );
  if (!res.ok) {
    throw new Error(`Gmail attachment get failed (${res.status})`);
  }
  return await res.json();
}

/**
 * Fetches message history since a given historyId.
 */
export async function getHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<any> {
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/history",
  );
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("maxResults", "100");

  const res = await fetchWithRetry(
    url.toString(),
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: 10_000,
      retries: 2,
    },
  );
  if (!res.ok) {
    throw new Error(`Gmail history failed (${res.status})`);
  }
  return await res.json();
}

/**
 * Sets up a Gmail push watch on the user's INBOX.
 */
export async function setupWatch(
  accessToken: string,
  topicName: string,
): Promise<{ historyId: string; expiration: string }> {
  const res = await fetchWithRetry(
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicName,
        labelIds: ["INBOX"],
      }),
    },
    {
      timeoutMs: 10_000,
      retries: 2,
    },
  );
  if (!res.ok) {
    throw new Error(`Gmail watch failed (${res.status})`);
  }
  return await res.json();
}
