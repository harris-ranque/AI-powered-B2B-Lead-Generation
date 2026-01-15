import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { internal } from "../_generated/api";

export const SUPPORTED_PROVIDERS = [
  "openai",
  "tavily",
  "perplexity",
  "google_places",
  // Legacy enrichment providers remain for backwards compatibility
  "google_maps",
  "findymail",
  "apify",
  // Email sending platform
  "instantly",
] as const;

export const providerValidator = v.union(
  ...SUPPORTED_PROVIDERS.map((provider) => v.literal(provider)),
);

// Providers that are available to ALL users regardless of plan
// Exported for use in queries.ts to maintain consistency
export const UNIVERSAL_ACCESS_PROVIDERS = new Set(["instantly"]);

export function ensureUserCanManageKeys(plan: string, provider?: string) {
  if (!plan) {
    throw new Error("User plan missing for API key operation");
  }

  // Allow universal access providers for all plans
  if (provider && UNIVERSAL_ACCESS_PROVIDERS.has(provider)) {
    return; // All users can manage these providers
  }

  // Only enterprise plans support BYOK key management for other providers
  const allowedPlans = new Set(["enterprise"]);
  if (!allowedPlans.has(plan)) {
    throw new Error("API key management is not enabled for this plan");
  }
}

// NOTE: upsertApiKey has been moved to actions.ts to support Node.js crypto operations
// See convex/userApiKeys/actions.ts for the implementation

// Delete API key
export const deleteApiKey = mutation({
  args: {
    keyId: v.id("userApiKeys"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to delete this API key");
    }

    // Check plan permissions (pass provider for universal access check)
    ensureUserCanManageKeys(user.plan, apiKey.provider);

    // Log deletion before deleting the key
    await ctx.scheduler.runAfter(0, internal.userApiKeys.internal.logApiKeyAccess, {
      userId: user._id,
      keyId: args.keyId,
      action: "deleted",
      purpose: "user_deletion",
      success: true,
    });

    await ctx.db.delete(args.keyId);

    return { success: true };
  },
});

// Toggle API key active status
export const toggleApiKey = mutation({
  args: {
    keyId: v.id("userApiKeys"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to modify this API key");
    }

    // Check plan permissions (pass provider for universal access check)
    ensureUserCanManageKeys(user.plan, apiKey.provider);

    await ctx.db.patch(args.keyId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update API key usage (internal use)
export const recordApiKeyUsage = mutation({
  args: {
    provider: providerValidator,
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Use compound index for O(log n) performance instead of O(n) filtering
    const apiKey = await ctx.db
      .query("userApiKeys")
      .withIndex("by_user_provider_active", (q) =>
        q.eq("userId", args.userId)
         .eq("provider", args.provider)
         .eq("isActive", true)
      )
      .first();

    if (apiKey) {
      await ctx.db.patch(apiKey._id, {
        usageCount: apiKey.usageCount + 1,
        lastUsed: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Update API key validation status (internal use)
export const updateValidationStatus = mutation({
  args: {
    keyId: v.id("userApiKeys"),
    validated: v.boolean(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    await ctx.db.patch(args.keyId, {
      validated: args.validated,
      validatedAt: Date.now(),
      lastError: args.lastError || undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
