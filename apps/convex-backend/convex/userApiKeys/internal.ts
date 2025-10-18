import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Internal query to fetch a user's API key for a specific provider
export const getApiKeyForUserAndProvider = internalQuery({
  args: {
    userId: v.id("users"),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("userApiKeys")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("provider"), args.provider))
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
