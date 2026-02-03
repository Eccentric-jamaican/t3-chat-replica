import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "./auth";

type EpnConfig = {
  campid: string;
  mkcid: string;
  mkrid: string;
  toolid: string;
  mkevt: string;
  customid?: string;
};

async function hashCustomId(value: string, salt: string) {
  const input = new TextEncoder().encode(`${salt}:${value}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const getEpnConfig = query({
  args: {
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EpnConfig | null> => {
    const campid = process.env.EPN_CAMPID;
    const mkcid = process.env.EPN_MKCID;
    const mkrid = process.env.EPN_MKRID;
    const toolid = process.env.EPN_TOOLID;
    const mkevt = process.env.EPN_MKEVT;

    if (!campid || !mkcid || !mkrid || !toolid || !mkevt) {
      return null;
    }

    const userId = await getAuthUserId(ctx);
    const rawId = userId ?? args.sessionId ?? null;
    const salt = process.env.EPN_CUSTOMID_SALT;
    const customid =
      rawId && salt ? await hashCustomId(rawId, salt) : undefined;

    return {
      campid,
      mkcid,
      mkrid,
      toolid,
      mkevt,
      customid,
    };
  },
});
