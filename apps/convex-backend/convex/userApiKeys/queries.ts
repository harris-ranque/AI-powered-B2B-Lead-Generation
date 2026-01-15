import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import {
  providerValidator,
  SUPPORTED_PROVIDERS,
  UNIVERSAL_ACCESS_PROVIDERS, // Shared with mutations.ts to prevent duplication
} from "./mutations";

// Required providers for enterprise BYOK (Bring Your Own Keys)
// These are the minimum set of API keys needed for full platform functionality
export const REQUIRED_ENTERPRISE_PROVIDERS = [
  "openai",      // LangGraph AI operations
  "tavily",      // Research and business intelligence
  "perplexity",  // Deep research and analysis
  "google_places", // Location and business discovery
  "findymail",   // Email enrichment
] as const;

// Get all API keys for current user
export const getUserApiKeys = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const isEnterprise = user.plan === "enterprise";

    const apiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Filter keys based on plan:
    // - Enterprise users see all keys
    // - Other users only see keys for universal access providers (e.g., Instantly)
    const filteredKeys = isEnterprise
      ? apiKeys
      : apiKeys.filter((key) => UNIVERSAL_ACCESS_PROVIDERS.has(key.provider));

    // Return keys without the actual encrypted key for security
    return filteredKeys.map((key) => ({
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
    const isEnterprise = user.plan === "enterprise";
    const requiresApiKeys = isEnterprise;

    const allApiKeys = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Filter keys based on plan for status display:
    // - Enterprise users see all keys
    // - Other users only see keys for universal access providers
    const apiKeys = isEnterprise
      ? allApiKeys
      : allApiKeys.filter((key) => UNIVERSAL_ACCESS_PROVIDERS.has(key.provider));

    const configuredProviders = apiKeys
      .filter((key) => key.validated)
      .map((key) => key.provider);

    // For enterprise users, show all missing providers
    // For other users, only show missing universal access providers
    const relevantProviders = isEnterprise
      ? SUPPORTED_PROVIDERS
      : SUPPORTED_PROVIDERS.filter((p) => UNIVERSAL_ACCESS_PROVIDERS.has(p));
    const missingProviders = relevantProviders.filter(
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
      missingProviders, // Missing providers relevant to user's plan
      missingRequiredProviders, // Only required providers that are missing (enterprise only)
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
    const isEnterprise = user.plan === "enterprise";
    const isUniversalProvider = UNIVERSAL_ACCESS_PROVIDERS.has(args.provider);

    // If user is not enterprise and the provider is not universal, they don't manage keys
    if (!isEnterprise && !isUniversalProvider) {
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
      managed: true,
      lastValidated: apiKey?.validatedAt,
      usageCount: apiKey?.usageCount || 0,
    };
  },
});
