import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Internal query to fetch a user's API key for a specific service
export const getApiKeyForUserAndService = internalQuery({
  args: {
    userId: v.id("users"),
    service: v.union(
      v.literal("openai"),
      v.literal("google_maps"),
      v.literal("findymail"),
      v.literal("apify"),
    ),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("userApiKeys")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("service"), args.service))
      .filter((q) => q.eq(q.field("isActive"), true))
      .unique();

    return apiKey;
  },
});
