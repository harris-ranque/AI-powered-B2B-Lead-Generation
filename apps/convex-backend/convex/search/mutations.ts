import { mutation } from "../_generated/server";
import { api } from "../_generated/api";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { withSubscriptionCheck } from "../middleware/subscriptionMiddleware";
import {
  isUpdatedAtSchemaError,
  withUpdatedAtIfSupported,
} from "./utils";
import { getMissingKeysBeforeOperationError } from "../lib/errorMessages";
import { captureAnalyticsEvent } from "../lib/analytics";

const DEFAULT_TARGET_ROLES = ["CEO", "Founder", "Owner"] as const;
const MAX_TARGET_ROLES = 3;

function sanitizeRolesInput(roles?: string[] | null): string[] {
  if (!roles || roles.length === 0) {
    return [...DEFAULT_TARGET_ROLES];
  }

  const normalized = roles
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
    .map((role) =>
      role
        .split(/\s+/)
        .map((word) =>
          word.length > 0
            ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            : "",
        )
        .join(" "),
    );

  const deduped: string[] = [];
  for (const role of normalized) {
    if (!deduped.includes(role)) {
      deduped.push(role);
    }
    if (deduped.length >= MAX_TARGET_ROLES) {
      break;
    }
  }

  if (deduped.length === 0) {
    return [...DEFAULT_TARGET_ROLES];
  }

  return deduped.slice(0, MAX_TARGET_ROLES);
}

// Create a new search
export const createSearch = mutation({
  args: {
    name: v.string(),
    parameters: v.object({
      location: v.string(),
      radius: v.number(),
      keywords: v.array(v.string()),
      industries: v.optional(v.array(v.string())),
      excludeTerms: v.optional(v.array(v.string())),
      roles: v.optional(v.array(v.string())),
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      deduplication: v.optional(
        v.object({
          enablePlaceNameDedup: v.optional(v.boolean()),
          enableEmailDedup: v.optional(v.boolean()),
          enableAddressDedup: v.optional(v.boolean()),
        }),
      ),
    }),
    autoStart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    return await withSubscriptionCheck(
      ctx.db,
      identity,
      "search",
      1,
      async (middleware) => {
        // Validate search parameters against plan limits
        const validation = middleware.validateSearchParameters(
          args.parameters.maxResults,
        );
        if (!validation.valid) {
          throw new Error(validation.reason || "Invalid search parameters");
        }

        // Use adjusted max leads if necessary
        const sanitizedRoles = sanitizeRolesInput(
          args.parameters.roles,
        );

        const adjustedParameters = {
          ...args.parameters,
          maxResults: validation.adjustedMaxLeads || args.parameters.maxResults,
          roles: sanitizedRoles,
        };

        const user = await requireAuth(ctx);

        // NOTE: Plan-based restrictions removed - all users can create searches (limited only by credits)

        // Validate enterprise users have required API keys
        if (user.plan === "enterprise") {
          const apiKeys = await ctx.db
            .query("userApiKeys")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .filter((q) => q.eq(q.field("isActive"), true))
            .filter((q) => q.eq(q.field("validated"), true))
            .collect();

          const hasOpenAI = apiKeys.some((key) => key.provider === "openai");
          const hasGooglePlaces = apiKeys.some(
            (key) => key.provider === "google_places",
          );
          const hasLegacyGoogleMaps = apiKeys.some(
            (key) => key.provider === "google_maps",
          );
          const hasFindyMail = apiKeys.some((key) => key.provider === "findymail");
          const hasTavily = apiKeys.some((key) => key.provider === "tavily");
          const hasPerplexity = apiKeys.some((key) => key.provider === "perplexity");

          const missingKeys: string[] = [];
          if (!hasOpenAI) missingKeys.push("OpenAI");
          if (!hasGooglePlaces && !hasLegacyGoogleMaps) {
            missingKeys.push("Google Places");
          }
          if (!hasFindyMail) missingKeys.push("FindyMail");
          if (!hasTavily) missingKeys.push("Tavily");
          if (!hasPerplexity) missingKeys.push("Perplexity");

          if (!hasGooglePlaces && hasLegacyGoogleMaps) {
            console.warn(
              `BYOK: Enterprise user ${user._id} has legacy google_maps key only; instruct them to re-save as google_places`,
            );
          }

          if (missingKeys.length > 0) {
            captureAnalyticsEvent(user._id, "search_creation_blocked", {
              reason: "missing_byok_keys",
              missingProviders: missingKeys,
              maxResults: args.parameters.maxResults,
            });
            throw new Error(
              getMissingKeysBeforeOperationError("a search", missingKeys)
            );
          }
        }

        const now = Date.now();

        const baseSearchDoc = {
          userId: user._id,
          name: args.name,
          parameters: adjustedParameters,
          status: "pending" as const,
          progress: {
            discovered: 0,
            enriched: 0,
            analyzed: 0,
            total: 0,
          },
          results: {
            totalFound: 0,
            enrichedCount: 0,
            analyzedCount: 0,
            avgRelevanceScore: 0,
          },
          creditsUsed: 0,
          createdAt: now,
        };

        try {
          const searchId = await ctx.db.insert("searches", {
            ...baseSearchDoc,
            updatedAt: now,
          });
          captureAnalyticsEvent(user._id, "search_created", {
            searchId,
            maxResults: adjustedParameters.maxResults,
            plan: user.plan,
            usingUserKeys: user.plan === "enterprise",
          });

          return { searchId };
        } catch (error) {
          if (!isUpdatedAtSchemaError(error)) {
            throw error;
          }

          const searchId = await ctx.db.insert("searches", baseSearchDoc);
          captureAnalyticsEvent(user._id, "search_created", {
            searchId,
            maxResults: adjustedParameters.maxResults,
            plan: user.plan,
            usingUserKeys: user.plan === "enterprise",
          });
          return { searchId };
        }
      },
    );
  },
});

// Complete the createSearch mutation
export const createSearchCompleted = mutation({
  args: {
    name: v.string(),
    parameters: v.object({
      location: v.string(),
      radius: v.number(),
      keywords: v.array(v.string()),
      industries: v.optional(v.array(v.string())),
      excludeTerms: v.optional(v.array(v.string())),
      roles: v.optional(v.array(v.string())),
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      deduplication: v.optional(
        v.object({
          enablePlaceNameDedup: v.optional(v.boolean()),
          enableEmailDedup: v.optional(v.boolean()),
          enableAddressDedup: v.optional(v.boolean()),
        }),
      ),
    }),
    autoStart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const searchId = await withSubscriptionCheck(
      ctx.db,
      identity,
      "search",
      1,
      async (middleware) => {
        // Validate search parameters against plan limits
        const validation = middleware.validateSearchParameters(
          args.parameters.maxResults,
        );
        if (!validation.valid) {
          throw new Error(validation.reason || "Invalid search parameters");
        }

        // Use adjusted max leads if necessary
        const sanitizedRoles = sanitizeRolesInput(
          args.parameters.roles,
        );

        const adjustedParameters = {
          ...args.parameters,
          maxResults: validation.adjustedMaxLeads || args.parameters.maxResults,
          roles: sanitizedRoles,
        };

        const user = await requireAuth(ctx);

        // NOTE: Plan-based restrictions removed - all users can create searches (limited only by credits)

        // Validate enterprise users have required API keys
        if (user.plan === "enterprise") {
          const apiKeys = await ctx.db
            .query("userApiKeys")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .filter((q) => q.eq(q.field("isActive"), true))
            .filter((q) => q.eq(q.field("validated"), true))
            .collect();

          const hasOpenAI = apiKeys.some((key) => key.provider === "openai");
          const hasGooglePlaces = apiKeys.some(
            (key) => key.provider === "google_places",
          );
          const hasLegacyGoogleMaps = apiKeys.some(
            (key) => key.provider === "google_maps",
          );
          const hasFindyMail = apiKeys.some((key) => key.provider === "findymail");
          const hasTavily = apiKeys.some((key) => key.provider === "tavily");
          const hasPerplexity = apiKeys.some((key) => key.provider === "perplexity");

          const missingKeys: string[] = [];
          if (!hasOpenAI) missingKeys.push("OpenAI");
          if (!hasGooglePlaces && !hasLegacyGoogleMaps) {
            missingKeys.push("Google Places");
          }
          if (!hasFindyMail) missingKeys.push("FindyMail");
          if (!hasTavily) missingKeys.push("Tavily");
          if (!hasPerplexity) missingKeys.push("Perplexity");

          if (!hasGooglePlaces && hasLegacyGoogleMaps) {
            console.warn(
              `BYOK: Enterprise user ${user._id} has legacy google_maps key only; instruct them to re-save as google_places`,
            );
          }

          if (missingKeys.length > 0) {
            throw new Error(
              getMissingKeysBeforeOperationError("a search", missingKeys)
            );
          }
        }

        const now = Date.now();

        const baseSearchDoc = {
          userId: user._id,
          name: args.name,
          parameters: adjustedParameters,
          status: "pending" as const,
          progress: {
            discovered: 0,
            enriched: 0,
            analyzed: 0,
            total: 0,
          },
          results: {
            totalFound: 0,
            enrichedCount: 0,
            analyzedCount: 0,
            avgRelevanceScore: 0,
          },
          creditsUsed: 0,
          createdAt: now,
        };

        try {
          return await ctx.db.insert("searches", {
            ...baseSearchDoc,
            updatedAt: now,
          });
        } catch (error) {
          if (!isUpdatedAtSchemaError(error)) {
            throw error;
          }

          return await ctx.db.insert("searches", baseSearchDoc);
        }
      },
    );

    // If autoStart is true, schedule the orchestration
    if (args.autoStart) {
      // Check if lead generation is enabled
      const systemConfig = await ctx.db.query("systemConfiguration").unique();
      const isEnabled =
        systemConfig?.orchestrationSettings?.leadGenerationEnabled ?? true;

      if (!isEnabled) {
        // Mark search as failed due to system pause
        const search = await ctx.db.get(searchId);
        const nowTimestamp = Date.now();

        const failurePatch = withUpdatedAtIfSupported(
          {
            status: "failed" as const,
            error: "Lead generation is currently paused by administrator",
            completedAt: nowTimestamp,
          },
          search,
          nowTimestamp,
        );

        try {
          await ctx.db.patch(searchId, failurePatch);
        } catch (error) {
          if (!isUpdatedAtSchemaError(error)) {
            throw error;
          }
          // Retry without updatedAt field for backward compatibility
          const { updatedAt: _unused, ...patchWithoutTimestamp } = failurePatch as typeof failurePatch & { updatedAt?: number };
          await ctx.db.patch(searchId, patchWithoutTimestamp);
        }
        throw new Error("Lead generation is currently paused by administrator");
      }

      // Schedule the Google Maps search action
      await ctx.scheduler.runAfter(0, (api as any).search.actions.searchGoogleMaps, {
        searchId,
        forceRestart: false,
      });
    }

    return { searchId };
  },
});

// Update search status
export const updateSearchStatus = mutation({
  args: {
    searchId: v.id("searches"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const now = Date.now();

    let updates: Record<string, any> = {
      status: args.status,
    };

    if (args.error) {
      updates.error = args.error;
    }

    if (args.status === "in_progress" && !search.startedAt) {
      updates.startedAt = now;
    }

    if (args.status === "completed" || args.status === "failed") {
      updates.completedAt = now;
    }

    updates = withUpdatedAtIfSupported(updates, search, now);

    try {
      await ctx.db.patch(args.searchId, updates);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      // Retry without updatedAt field for backward compatibility
      const { updatedAt, ...updatesWithoutTimestamp } = updates;
      await ctx.db.patch(args.searchId, updatesWithoutTimestamp);
    }

    return { success: true };
  },
});

// Update search progress
export const updateSearchProgress = mutation({
  args: {
    searchId: v.id("searches"),
    progress: v.object({
      discovered: v.number(),
      enriched: v.number(),
      analyzed: v.number(),
      total: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const now = Date.now();

    const updates = withUpdatedAtIfSupported(
      {
        progress: args.progress,
        lastOrchestrationAt: now,
      },
      search,
      now,
    );

    try {
      await ctx.db.patch(args.searchId, updates);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      // Retry without updatedAt field for backward compatibility
      const { updatedAt: _unused, ...updatesWithoutTimestamp } = updates as typeof updates & { updatedAt?: number };
      await ctx.db.patch(args.searchId, updatesWithoutTimestamp);
    }

    return { success: true };
  },
});

// Cancel a search
export const cancelSearch = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Only allow cancelling if not completed
    if (search.status === "completed") {
      throw new Error("Cannot cancel completed search");
    }

    const now = Date.now();

    const updates = withUpdatedAtIfSupported(
      {
        status: "cancelled" as const,
        completedAt: now,
      },
      search,
      now,
    );

    try {
      await ctx.db.patch(args.searchId, updates);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      // Retry without updatedAt field for backward compatibility
      const { updatedAt: _unused, ...updatesWithoutTimestamp } = updates as typeof updates & { updatedAt?: number };
      await ctx.db.patch(args.searchId, updatesWithoutTimestamp);
    }

    // Broadcast cancellation update
    try {
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: user._id,
          searchId: args.searchId,
          stage: "cancelled",
          progress: 0,
          message: "Search cancelled by user",
          data: {},
        },
      );
    } catch (e) {
      // Non-fatal if broadcast fails
      console.warn("Broadcast cancellation failed", e);
    }

    return { success: true };
  },
});

// Delete a search
export const deleteSearch = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Get all leads associated with this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Delete all associated leads first
    for (const lead of leads) {
      await ctx.db.delete(lead._id);
    }

    // Delete the search
    await ctx.db.delete(args.searchId);

    return { success: true, deletedLeads: leads.length };
  },
});

// Duplicate a search
export const duplicateSearch = mutation({
  args: {
    searchId: v.id("searches"),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the search
    const originalSearch = await ctx.db.get(args.searchId);
    if (!originalSearch || originalSearch.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const newName = args.newName || `${originalSearch.name} (Copy)`;

    const now = Date.now();

    const baseSearchDoc = {
      userId: user._id,
      name: newName,
      parameters: originalSearch.parameters,
      status: "pending" as const,
      progress: {
        discovered: 0,
        enriched: 0,
        analyzed: 0,
        total: 0,
      },
      results: {
        totalFound: 0,
        enrichedCount: 0,
        analyzedCount: 0,
        avgRelevanceScore: 0,
      },
      creditsUsed: 0,
      createdAt: now,
    };

    let duplicateId: string;

    try {
      duplicateId = await ctx.db.insert("searches", {
        ...baseSearchDoc,
        updatedAt: now,
      });
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }

      duplicateId = await ctx.db.insert("searches", baseSearchDoc);
    }

    return { searchId: duplicateId, success: true };
  },
});
