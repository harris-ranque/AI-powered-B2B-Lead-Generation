import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get all API keys for current user
export const getUserApiKeys = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Only starter tier users can view their API keys
    if (user.plan !== "starter") {
      return [];
    }

    const apiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Return keys without the actual encrypted key for security
    return apiKeys.map((key) => ({
      _id: key._id,
      service: key.service,
      keyName: key.keyName,
      isValid: key.isValid,
      lastValidated: key.lastValidated,
      validationError: key.validationError,
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

    // Only starter tier users need API key status
    if (user.plan !== "starter") {
      return {
        requiresApiKeys: false,
        configuredServices: [],
        missingServices: [],
        totalUsage: 0,
      };
    }

    const apiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const allServices = ["openai", "google_maps", "findymail", "icypeas", "apify"];
    const configuredServices = apiKeys
      .filter((key) => key.isValid)
      .map((key) => key.service);
    const missingServices = allServices.filter(
      (service) => !configuredServices.includes(service as any),
    );
    const totalUsage = apiKeys.reduce((sum, key) => sum + key.usageCount, 0);

    return {
      requiresApiKeys: true,
      configuredServices,
      missingServices,
      totalUsage,
      validKeys: apiKeys.filter((key) => key.isValid).length,
      totalKeys: apiKeys.length,
    };
  },
});

// Check if user has required API keys for a service
export const hasApiKeyForService = query({
  args: {
    service: v.union(
      v.literal("openai"),
      v.literal("google_maps"),
      v.literal("findymail"),
      v.literal("icypeas"),
      v.literal("apify"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Non-starter users don't need API keys
    if (user.plan !== "starter") {
      return { hasKey: true, managed: true };
    }

    const apiKey = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_service_active", (q) => 
        q.eq("userId", user._id).eq("service", args.service).eq("isActive", true)
      )
      .filter((q) => q.eq(q.field("isValid"), true))
      .unique();

    return {
      hasKey: !!apiKey,
      managed: false,
      lastValidated: apiKey?.lastValidated,
      usageCount: apiKey?.usageCount || 0,
    };
  },
});
