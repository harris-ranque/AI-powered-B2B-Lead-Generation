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
      v.literal("icypeas"),
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

// Internal query to fetch a user's API key by ID with full details
export const getApiKeyById = internalQuery({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    return apiKey;
  },
});

// Internal query to get all API keys for a user with full details
export const getUserApiKeysInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const apiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return apiKeys;
  },
});
