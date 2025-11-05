import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import {
  ensureUserCanManageKeys,
  providerValidator,
  SUPPORTED_PROVIDERS,
} from "./mutations";

// Required providers for enterprise BYOK (Bring Your Own Keys)
// These are the minimum set of API keys needed for full platform functionality
export const REQUIRED_ENTERPRISE_PROVIDERS = [
  "openai",      // LangGraph AI operations
  "tavily",      // Research and business intelligence
  "exa",         // Semantic deep research (Tier 2)
  "perplexity",  // Deep research and analysis
  "google_places", // Location and business discovery
  "findymail",   // Email enrichment
] as const;

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
        missingRequiredProviders: [],
        hasRequiredKeys: true,
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

    // For enterprise users, check if they have all REQUIRED providers
    const missingRequiredProviders = requiresApiKeys
      ? REQUIRED_ENTERPRISE_PROVIDERS.filter(
          (provider) => !configuredProviders.includes(provider),
        )
      : [];

    const hasRequiredKeys = requiresApiKeys
      ? missingRequiredProviders.length === 0
      : true;

    const totalUsage = apiKeys.reduce((sum, key) => sum + key.usageCount, 0);

    return {
      requiresApiKeys,
      configuredProviders,
      missingProviders, // All missing providers (for info/display)
      missingRequiredProviders, // Only required providers that are missing
      hasRequiredKeys, // True if all required keys are configured
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
