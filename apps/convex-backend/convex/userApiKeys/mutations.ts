import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

export const SUPPORTED_PROVIDERS = [
  "openai",
  "tavily",
  "perplexity",
  "google_places",
  // Legacy enrichment providers remain for backwards compatibility
  "google_maps",
  "findymail",
  "icypeas",
  "apify",
] as const;

export const providerValidator = v.union(
  ...SUPPORTED_PROVIDERS.map((provider) => v.literal(provider)),
);

export function ensureUserCanManageKeys(plan: string) {
  if (!plan) {
    throw new Error("User plan missing for API key operation");
  }

  // Starter historically supported BYOK for enrichment, enterprise requires it.
  const allowedPlans = new Set(["starter", "enterprise", "business"]);
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
    ensureUserCanManageKeys(user.plan);

    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to delete this API key");
    }

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
    ensureUserCanManageKeys(user.plan);

    const apiKey = await ctx.db.get(args.keyId);

    if (!apiKey) {
      throw new Error("API key not found");
    }

    if (apiKey.userId !== user._id) {
      throw new Error("Not authorized to modify this API key");
    }

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
    const apiKey = await ctx.db
      .query("userApiKeys")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("provider"), args.provider))
      .filter((q) => q.eq(q.field("isActive"), true))
      .unique();

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
