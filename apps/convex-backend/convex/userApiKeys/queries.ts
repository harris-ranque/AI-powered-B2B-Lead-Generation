import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import {
  ensureUserCanManageKeys,
  providerValidator,
  SUPPORTED_PROVIDERS,
  decryptApiKey,
} from "./mutations";

// Get all API keys for current user
export const getUserApiKeys = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    try {
      ensureUserCanManageKeys(user.plan);
    } catch (error) {
      return [];
    }

    const apiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Return keys without the actual encrypted key for security
    return apiKeys.map((key) => ({
      _id: key._id,
      provider: key.provider,
      keyName: key.keyName,
      validated: key.validated,
      validatedAt: key.validatedAt,
      lastError: key.lastError,
      usageCount: key.usageCount,
      lastUsed: key.lastUsed,
      isActive: key.isActive,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
    }));
  },
});

// Get API key status summary
export const getApiKeyStatus = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    let requiresApiKeys = false;

    try {
      ensureUserCanManageKeys(user.plan);
      requiresApiKeys = user.plan === "enterprise";
    } catch (error) {
      return {
        requiresApiKeys: false,
        configuredProviders: [],
        missingProviders: [],
        totalUsage: 0,
        validKeys: 0,
        totalKeys: 0,
      };
    }

    const apiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const configuredProviders = apiKeys
      .filter((key) => key.validated)
      .map((key) => key.provider);
    const missingProviders = SUPPORTED_PROVIDERS.filter(
      (provider) => !configuredProviders.includes(provider),
    );
    const totalUsage = apiKeys.reduce((sum, key) => sum + key.usageCount, 0);

    return {
      requiresApiKeys,
      configuredProviders,
      missingProviders,
      totalUsage,
      validKeys: apiKeys.filter((key) => key.validated).length,
      totalKeys: apiKeys.length,
    };
  },
});

// Check if user has required API keys for a service
export const hasApiKeyForService = query({
  args: {
    provider: providerValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    try {
      ensureUserCanManageKeys(user.plan);
    } catch (error) {
      return { hasKey: true, managed: false };
    }

    const apiKey = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider_active", (q) =>
        q
          .eq("userId", user._id)
          .eq("provider", args.provider)
          .eq("isActive", true)
      )
      .filter((q) => q.eq(q.field("validated"), true))
      .unique();

    return {
      hasKey: !!apiKey,
      managed: false,
      lastValidated: apiKey?.validatedAt,
      usageCount: apiKey?.usageCount || 0,
    };
  },
});

// Resolve user provider keys for use in actions
export const resolveUserProviderKeys = query({
  args: {
    userId: v.id("users"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const includeInactive = args.includeInactive ?? false;

    const keys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const providerKeys: Record<string, string> = {};

    for (const key of keys) {
      if (!includeInactive && (!key.isActive || !key.validated)) {
        continue;
      }

      try {
        providerKeys[key.provider] = decryptApiKey(key.encryptedKey);
      } catch (error) {
        console.warn("Failed to decrypt provider key", {
          provider: key.provider,
          userId: args.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return providerKeys;
  },
});
