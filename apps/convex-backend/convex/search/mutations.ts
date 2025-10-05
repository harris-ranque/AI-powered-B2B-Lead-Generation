import { mutation } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { withSubscriptionCheck } from "../middleware/subscriptionMiddleware";
import {
  isUpdatedAtSchemaError,
  withUpdatedAtIfSupported,
} from "./utils";

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
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      filters: v.optional(
        v.object({
          minEmployees: v.optional(v.number()),
          maxEmployees: v.optional(v.number()),
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
        const adjustedParameters = {
          ...args.parameters,
          maxResults: validation.adjustedMaxLeads || args.parameters.maxResults,
        };

        const user = await requireAuth(ctx);

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

          return { searchId };
        } catch (error) {
          if (!isUpdatedAtSchemaError(error)) {
            throw error;
          }

          const searchId = await ctx.db.insert("searches", baseSearchDoc);
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
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      filters: v.optional(
        v.object({
          minEmployees: v.optional(v.number()),
          maxEmployees: v.optional(v.number()),
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
        const adjustedParameters = {
          ...args.parameters,
          maxResults: validation.adjustedMaxLeads || args.parameters.maxResults,
        };

        const user = await requireAuth(ctx);

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

        await ctx.db.patch(searchId, failurePatch);
        throw new Error("Lead generation is currently paused by administrator");
      }

      // Schedule the Google Maps search action
      await ctx.scheduler.runAfter(0, api.search.actions.searchGoogleMaps, {
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

    await ctx.db.patch(args.searchId, updates);

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

    await ctx.db.patch(args.searchId, updates);

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

    await ctx.db.patch(args.searchId, updates);

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
        } as any,
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
