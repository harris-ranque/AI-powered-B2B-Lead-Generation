import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { providerValidator } from "./mutations";

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
      .filter((q) => q.eq(q.field("validated"), true))
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

// Internal mutation to upsert API key (DB operations only, no crypto)
export const upsertApiKeyInternal = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    keyName: v.string(),
    encryptedKey: v.string(),
    keyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existingKey = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider_active", (q) =>
        q
          .eq("userId", args.userId)
          .eq("provider", args.provider)
          .eq("isActive", true),
      )
      .unique();

    const keyData = {
      userId: args.userId,
      provider: args.provider,
      keyName: args.keyName,
      encryptedKey: args.encryptedKey,
      keyHash: args.keyHash,
      validated: false, // Must be validated explicitly
      usageCount: existingKey?.usageCount ?? 0,
      isActive: true,
      updatedAt: Date.now(),
    };

    if (existingKey) {
      await ctx.db.patch(existingKey._id, keyData);

      return {
        success: true,
        keyId: existingKey._id,
        action: "updated" as const,
      };
    }

    const keyId = await ctx.db.insert("userApiKeys", {
      ...keyData,
      createdAt: Date.now(),
    });

    return {
      success: true,
      keyId,
      action: "created" as const,
    };
  },
});

// Internal mutation to log API key access for security audit trail
export const logApiKeyAccess = internalMutation({
  args: {
    userId: v.id("users"),
    keyId: v.id("userApiKeys"),
    action: v.union(
      v.literal("decrypted"),
      v.literal("validated"),
      v.literal("created"),
      v.literal("deleted"),
    ),
    purpose: v.string(), // e.g., "system_use", "enrichment", "user_validation"
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("apiKeyAuditLog", {
      userId: args.userId,
      keyId: args.keyId,
      action: args.action,
      purpose: args.purpose,
      success: args.success,
      errorMessage: args.errorMessage,
      timestamp: Date.now(),
    });
  },
});
