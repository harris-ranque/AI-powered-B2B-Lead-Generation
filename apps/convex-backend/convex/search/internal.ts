import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Doc } from "../_generated/dataModel";
import { withUpdatedAtIfSupported, isUpdatedAtSchemaError } from "./utils";
import { countExportableSummaryForSearch } from "../lib/exportEligibility";
import { getSearchAnalysisCompletionReadiness, scheduleSearchCompletionIfReady } from "../lib/searchCompletion";
import { getAnalysisCompletionState } from "../lib/analysisProgress";
import { computeAnalysisCreditBreakdown } from "../lib/helpers";

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

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const acceptedContacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    const enrichedCount = new Set(acceptedContacts.map((c) => c.leadId)).size;

    const completion = await getAnalysisCompletionState(ctx, args.searchId);
    const analyzedCount = completion.personalized;

    const contactsWithScores = acceptedContacts.filter(
      (contact) =>
        contact.analysisStatus === "completed" &&
        contact.aiAnalysis?.relevanceScore !== undefined,
    );
    const avgRelevanceScore =
      contactsWithScores.length > 0
        ? contactsWithScores.reduce(
            (sum, contact) => sum + (contact.aiAnalysis?.relevanceScore ?? 0),
            0,
          ) / contactsWithScores.length
        : 0;

    const totalFound =
      search.progress?.discovered ??
      search.results?.totalFound ??
      leads.length;

    return {
      totalFound,
      enrichedCount,
      analyzedCount,
      avgRelevanceScore,
    };
  },
});

function contactHasWrittenEmail(
  emailContent?: { subject?: string; body?: string },
): boolean {
  return Boolean(
    emailContent?.subject?.trim() || emailContent?.body?.trim(),
  );
}

export const getAnalysisCreditBreakdown = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const acceptedContacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    const personalizedContacts = acceptedContacts.filter(
      (contact) =>
        contact.email.trim().length > 0 &&
        contact.analysisStatus === "completed" &&
        contactHasWrittenEmail(contact.emailContent),
    );

    const withTier: Array<{ deepResearchUsed?: boolean }> = [];
    for (const contact of personalizedContacts) {
      const lead = await ctx.db.get(contact.leadId);
      withTier.push({ deepResearchUsed: lead?.deepResearchUsed });
    }

    return computeAnalysisCreditBreakdown(withTier);
  },
});

// Count exportable leads for a search — used at completion to write results.exportableCount
export const getExportableCount = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return 0;
    }
    const summary = await countExportableSummaryForSearch(
      ctx,
      args.searchId,
      search.userId,
    );
    return summary.exportableContacts;
  },
});

export const getSearchCompletionReadinessInternal = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    return await getSearchAnalysisCompletionReadiness(ctx, args.searchId);
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

/** Re-open a failed search so Write Emails recovery can run (analysis timeout only). */
export const reopenSearchForAnalysisRecovery = internalMutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search || search.status !== "failed") {
      return { reopened: false };
    }

    const now = Date.now();
    let updates: Record<string, unknown> = {
      status: "processing",
      error: undefined,
      completedAt: undefined,
    };
    updates = withUpdatedAtIfSupported(updates, search, now);

    try {
      await ctx.db.patch(args.searchId, updates);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      const { updatedAt: _u, ...withoutUpdatedAt } = updates;
      await ctx.db.patch(args.searchId, withoutUpdatedAt);
    }

    return { reopened: true };
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

/**
 * Log an API error to the apiErrorLogs table for user visibility
 * Used when external API calls fail with user-actionable errors
 */
export const logApiError = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    leadId: v.optional(v.id("leads")),
    errorCode: v.string(),
    provider: v.string(),
    category: v.string(),
    severity: v.string(),
    userMessage: v.string(),
    technicalMessage: v.optional(v.string()),
    originalStatus: v.optional(v.number()),
    operationType: v.optional(v.string()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Default to 7-day retention
    const retentionDays = 7;
    const expiresAt = now + retentionDays * 24 * 60 * 60 * 1000;

    const logId = await ctx.db.insert("apiErrorLogs", {
      userId: args.userId,
      searchId: args.searchId,
      leadId: args.leadId,
      errorCode: args.errorCode,
      provider: args.provider,
      category: args.category,
      severity: args.severity,
      userMessage: args.userMessage,
      technicalMessage: args.technicalMessage,
      originalStatus: args.originalStatus,
      operationType: args.operationType,
      correlationId: args.correlationId,
      resolved: false,
      createdAt: now,
      expiresAt,
    });

    return { logId, success: true };
  },
});

/**
 * Fail a search with a user-actionable API error (discovery / analysis phases).
 */
export const blockSearchWithApiError = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    errorCode: v.string(),
    errorMessage: v.string(),
    provider: v.string(),
    category: v.string(),
    severity: v.string(),
    operationType: v.string(),
    suggestedAction: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    originalStatus: v.optional(v.number()),
    correlationId: v.optional(v.string()),
    pipelineStage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return { success: false, reason: "search_not_found" };
    }

    const alreadyBlocked =
      search.status === "failed" && search.error === args.errorMessage;

    await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
      searchId: args.searchId,
      status: "failed",
      error: args.errorMessage,
    });

    if (alreadyBlocked) {
      return { success: true, notificationsSent: false };
    }

    await ctx.runMutation(internal.search.internal.logApiError, {
      userId: args.userId,
      searchId: args.searchId,
      errorCode: args.errorCode,
      provider: args.provider,
      category: args.category,
      severity: args.severity,
      userMessage: args.errorMessage,
      originalStatus: args.originalStatus,
      operationType: args.operationType,
      correlationId: args.correlationId,
    });

    await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
      userId: args.userId,
      type: "pipeline_blocked",
      title: "Search paused",
      message: args.errorMessage,
      data: {
        searchId: args.searchId,
        errorCode: args.errorCode,
        category: args.category,
        actionRequired: args.suggestedAction,
        actionUrl: args.actionUrl,
        stage: args.pipelineStage ?? "lead_discovery",
        apiError: {
          code: args.errorCode,
          provider: args.provider,
          category: args.category,
          userMessage: args.errorMessage,
          suggestedAction: args.suggestedAction,
          actionUrl: args.actionUrl,
          actionLabel: args.actionLabel,
        },
      },
      priority: "critical",
      category: "search_error",
      entityType: "search",
      entityId: args.searchId,
      requiresAck: true,
      tags: ["search", "blocked", args.category],
    });

    await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
      userId: args.userId,
      searchId: args.searchId,
      stage: "error",
      progress: 0,
      priority: "urgent",
      message: args.errorMessage,
      data: {
        stage: args.pipelineStage ?? "lead_discovery",
        apiError: {
          code: args.errorCode,
          provider: args.provider,
          category: args.category,
          userMessage: args.errorMessage,
          suggestedAction: args.suggestedAction,
          actionUrl: args.actionUrl,
          actionLabel: args.actionLabel,
        },
      },
    });

    return { success: true, notificationsSent: true };
  },
});

// Track duplicate prevention for analytics
// Used by actions that perform deduplication checks before calling mutations
export const trackDuplicateMetric = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    placeId: v.string(),
    duplicateType: v.union(
      v.literal("search_level"),
      v.literal("user_level"),
      v.literal("place_name"),
      v.literal("address"),
      v.literal("email"),
    ),
    originalLeadId: v.string(),
    businessName: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("duplicateMetrics", {
      userId: args.userId,
      searchId: args.searchId,
      placeId: args.placeId,
      duplicateType: args.duplicateType,
      originalLeadId: args.originalLeadId as any,
      businessName: args.businessName,
      preventedAt: Date.now(),
    });

    // Also update the search's duplicate counter
    const search = await ctx.db.get(args.searchId);
    if (search) {
      if (args.duplicateType === "address") {
        const current = search.duplicatesFilteredAddress || 0;
        await ctx.db.patch(args.searchId, {
          duplicatesFilteredAddress: current + 1,
        });
      } else if (args.duplicateType === "email") {
        const current = search.duplicatesFilteredEmail || 0;
        await ctx.db.patch(args.searchId, {
          duplicatesFilteredEmail: current + 1,
        });
      }
    }
  },
});

export const updateSearchExpandedRolePatterns = internalMutation({
  args: {
    searchId: v.id("searches"),
    expandedRolePatterns: v.array(v.string()),
    expandedPatternsByRole: v.optional(v.record(v.string(), v.array(v.string()))),
    expandedTitleMatchers: v.optional(v.array(v.string())),
    roleExpansionSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return;
    }

    const now = Date.now();
    const patch = withUpdatedAtIfSupported(
      {
        parameters: {
          ...search.parameters,
          expandedRolePatterns: args.expandedRolePatterns,
          expandedPatternsByRole: args.expandedPatternsByRole,
          expandedTitleMatchers: args.expandedTitleMatchers,
          roleExpansionSource: args.roleExpansionSource,
        },
      },
      search,
      now,
    );

    try {
      await ctx.db.patch(args.searchId, patch);
    } catch (error) {
      if (!isUpdatedAtSchemaError(error)) {
        throw error;
      }
      const { updatedAt: _unused, ...patchWithoutTimestamp } = patch as typeof patch & {
        updatedAt?: number;
      };
      await ctx.db.patch(args.searchId, patchWithoutTimestamp);
    }
  },
});

/** Finalize search when enrichment finished but there is nothing to analyze. */
export const tryScheduleSearchCompletion = internalMutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    return await scheduleSearchCompletionIfReady(ctx, args.searchId);
  },
});
