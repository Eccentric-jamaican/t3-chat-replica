import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});

export const update = mutation({
  args: {
    sessionId: v.string(),
    profile: v.object({
      fullName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      gender: v.optional(v.string()),
      dob: v.optional(v.number()),
      trn: v.optional(v.string()),
      address: v.optional(
        v.object({
          streetAddress: v.string(),
          streetAddress2: v.optional(v.string()),
          city: v.string(),
          parish: v.string(),
          postalCode: v.optional(v.string()),
        })
      ),
    }),
  },
  handler: async (ctx, args) => {
    // Basic validation
    if (args.profile.email && !args.profile.email.includes("@")) {
      throw new Error("Invalid email address");
    }

    if (args.profile.trn && !/^\d{3}-\d{3}-\d{3}$/.test(args.profile.trn)) {
      throw new Error("Invalid TRN format (expected XXX-XXX-XXX)");
    }

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args.profile);
      return existing._id;
    } else {
      return await ctx.db.insert("profiles", {
        sessionId: args.sessionId,
        ...args.profile,
      });
    }
  },
});
