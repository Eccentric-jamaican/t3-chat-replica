import { query, mutation } from "./_generated/server";
import {
  getOptionalAuthenticatedUserId,
  requireAuthenticatedUserId,
} from "./lib/authGuards";

/**
 * List all packages for the current authenticated user.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalAuthenticatedUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("packages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/**
 * Internal seed mutation to provide some realistic data for the user.
 */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(ctx, "packages.seed");

    const existing = await ctx.db
      .query("packages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) return "Already seeded";

    const now = Date.now();
    const mockPackages = [
      {
        userId,
        trackingNumber: "1Z999AA10123456784",
        merchant: "Amazon",
        description: "Sony WH-1000XM5 Headphones",
        status: "ready_for_pickup" as const,
        weight: 1.2,
        cost: 4500,
        location: "Kingston Branch (New Kingston)",
        updatedAt: now - 1000 * 60 * 60 * 2, // 2 hours ago
      },
      {
        userId,
        trackingNumber: "42012345678901234567",
        merchant: "SHEIN",
        description: "Summer Apparel (5 items)",
        status: "in_transit" as const,
        weight: 3.5,
        cost: 2800,
        updatedAt: now - 1000 * 60 * 60 * 24, // 1 day ago
      },
      {
        userId,
        trackingNumber: "LX123456789CN",
        merchant: "eBay",
        description: "Vintage Mechanical Watch",
        status: "warehouse" as const,
        weight: 0.5,
        updatedAt: now - 1000 * 60 * 60 * 48, // 2 days ago
      },
      {
        userId,
        trackingNumber: "TBA123456789",
        merchant: "Amazon",
        description: "Ergonomic Keyboard",
        status: "delivered" as const,
        weight: 2.1,
        cost: 3200,
        location: "Home Delivery",
        updatedAt: now - 1000 * 60 * 60 * 72, // 3 days ago
      },
    ];

    for (const pkg of mockPackages) {
      await ctx.db.insert("packages", pkg);
    }

    return "Successfully seeded 4 packages";
  },
});
