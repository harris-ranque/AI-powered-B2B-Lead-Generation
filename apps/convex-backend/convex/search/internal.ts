import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Doc } from "../_generated/dataModel";
import { withUpdatedAtIfSupported, isUpdatedAtSchemaError } from "./utils";

// Search status state machine validation
type SearchStatus = "pending" | "in_progress" | "processing" | "completed" | "failed" | "cancelled";

const VALID_STATUS_TRANSITIONS: Record<SearchStatus, SearchStatus[]> = {
  pending: ["in_progress", "cancelled", "failed"],
  in_progress: ["processing", "completed", "failed", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  completed: [], // Terminal state - no transitions allowed
  failed: [], // Terminal state - no transitions allowed
  cancelled: [], // Terminal state - no transitions allowed
};

function validateStatusTransition(currentStatus: SearchStatus, newStatus: SearchStatus): { valid: boolean; reason?: string } {
  // Allow same status (idempotent updates)
  if (currentStatus === newStatus) {
    return { valid: true };
  }

  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];

  if (!allowedTransitions.includes(newStatus)) {
    return {
      valid: false,
      reason: `Invalid state transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowedTransitions.length > 0 ? allowedTransitions.join(", ") : "none (terminal state)"}`,
    };
  }

  return { valid: true };
}

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

export const getSearchesByStatusesInternal = internalQuery({
  args: {
    statuses: v.array(
      v.union(
        v.literal("pending"),
        v.literal("in_progress"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const seen = new Set<string>();
    const results: Doc<"searches">[] = [];

    for (const status of args.statuses) {
      const matches = await ctx.db
        .query("searches")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();

      for (const search of matches) {
        if (!seen.has(search._id)) {
          seen.add(search._id);
          results.push(search);
        }
      }
    }

    return results;
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

    // Validate state transition
    const currentStatus = search.status as SearchStatus;
    const newStatus = args.status as SearchStatus;
    const validation = validateStatusTransition(currentStatus, newStatus);

    if (!validation.valid) {
      console.warn(
        `⚠️ Invalid search status transition blocked: ${validation.reason}`,
        {
          searchId: args.searchId,
          currentStatus,
          attemptedStatus: newStatus,
        }
      );
      throw new Error(validation.reason);
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
    partialResults: v.optional(v.boolean()),
    requestedCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const now = Date.now();

    let updateData: Record<string, any> = {
      progress: args.progress,
      lastOrchestrationAt: now,
    };

    // Add partial results metadata if provided
    if (args.partialResults !== undefined) {
      updateData.partialResults = args.partialResults;
    }
    if (args.requestedCount !== undefined) {
      updateData.requestedCount = args.requestedCount;
    }

    const updates = withUpdatedAtIfSupported(updateData, search, now);

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

export const updateDiscoveryMetadataInternal = internalMutation({
  args: {
    searchId: v.id("searches"),
    initialSearchRadius: v.optional(v.number()),
    finalSearchRadius: v.optional(v.number()),
    expansionIterations: v.optional(v.number()),
    duplicatesFilteredPlaceId: v.optional(v.number()),
    duplicatesFilteredPlaceName: v.optional(v.number()),
    duplicatesFilteredEmail: v.optional(v.number()),
    duplicatesFilteredAddress: v.optional(v.number()),
    discoveryMetadata: v.optional(
      v.object({
        requested: v.number(),
        delivered: v.number(),
        shortfall: v.number(),
        expanded: v.boolean(),
        originalAreaLeads: v.number(),
        expansionAreaLeads: v.number(),
        expansionMessage: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const { searchId, ...rest } = args;
    const updateData: Record<string, any> = {};

    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { success: true };
    }

    updateData.updatedAt = Date.now();

    await ctx.db.patch(searchId, updateData);
    return { success: true };
  },
});

// Mark search as failed (used by stuck search recovery cron - bypasses state machine validation)
export const markSearchFailedInternal = internalMutation({
  args: {
    searchId: v.id("searches"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    // Skip validation for timeout recovery - allow marking as failed from any non-terminal state
    const currentStatus = search.status as SearchStatus;
    if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled") {
      console.warn(
        `⚠️ Attempted to mark terminal search as failed`,
        {
          searchId: args.searchId,
          currentStatus,
          reason: "already_terminal",
        }
      );
      return { success: false, reason: "Search already in terminal state" };
    }

    const now = Date.now();

    const updates = withUpdatedAtIfSupported(
      {
        status: "failed" as const,
        error: args.error,
        completedAt: now,
      },
      search,
      now
    );

    try {
      await ctx.db.patch(args.searchId, updates);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      const { updatedAt, ...updatesWithoutTimestamp } = updates;
      await ctx.db.patch(args.searchId, updatesWithoutTimestamp);
    }

    return { success: true };
  },
});
