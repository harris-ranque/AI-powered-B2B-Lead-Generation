import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { withUpdatedAtIfSupported, isUpdatedAtSchemaError } from "./utils";

// Internal query to get search without auth check
export const getSearchInternal = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.searchId);
  },
});

// Internal query to get search results
export const getSearchResults = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return {
        totalFound: 0,
        enrichedCount: 0,
        analyzedCount: 0,
      };
    }

    // Get all leads for this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const enrichedLeads = leads.filter(
      (l) =>
        l.enrichmentStatus === "completed" ||
        l.enrichmentStatus === "completed_fallback",
    );

    const analyzedLeads = leads.filter((l) => l.aiAnalysis !== undefined);

    return {
      totalFound: leads.length,
      enrichedCount: enrichedLeads.length,
      analyzedCount: analyzedLeads.length,
      avgRelevanceScore:
        analyzedLeads.length > 0
          ? analyzedLeads.reduce(
              (sum, l) => sum + (l.aiAnalysis?.relevanceScore || 0),
              0,
            ) / analyzedLeads.length
          : 0,
    };
  },
});

// Internal query to get stuck searches
export const getStuckSearches = internalQuery({
  args: {
    stuckThreshold: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .filter((q) => q.lt(q.field("lastOrchestrationAt"), args.stuckThreshold))
      .take(10); // Process max 10 stuck searches at a time
  },
});

// Internal mutation to update search status without auth
export const updateSearchStatusInternal = internalMutation({
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
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
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

// Log correlation for debugging
export const logCorrelation = internalMutation({
  args: {
    correlationId: v.string(),
    operationType: v.string(),
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    leadId: v.optional(v.id("leads")),
    level: v.union(
      v.literal("debug"),
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
    ),
    message: v.string(),
    data: v.optional(v.any()),
    error: v.optional(
      v.object({
        message: v.string(),
        stack: v.optional(v.string()),
        name: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("correlationLogs", {
      ...args,
      performance: {
        startTime: Date.now(),
      },
      createdAt: Date.now(),
    });
  },
});

// Internal mutation to update search results and progress
export const updateSearchResults = internalMutation({
  args: {
    searchId: v.id("searches"),
    results: v.any(),
    progress: v.any(),
    creditsUsed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const now = Date.now();

    let updates: Record<string, any> = {
      results: args.results,
      progress: args.progress,
    };

    if (typeof args.creditsUsed === "number") {
      updates.creditsUsed = args.creditsUsed;
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
  },
});

// Internal mutation to update search progress without auth
export const updateSearchProgressInternal = internalMutation({
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
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
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
      const { updatedAt, ...updatesWithoutTimestamp } = updates;
      await ctx.db.patch(args.searchId, updatesWithoutTimestamp);
    }
    return { success: true };
  },
});
