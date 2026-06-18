/**
 * Enrichment Checkpoint System
 *
 * Provides checkpoint/resume capability for pipeline-blocking errors.
 * When credits are exhausted or subscription is paused, saves progress
 * so enrichment can be resumed later without re-processing completed leads.
 *
 * Features:
 * - Save checkpoint on pipeline-blocking errors
 * - Resume from last checkpoint
 * - Clear checkpoint on successful completion
 * - Query checkpoint status for UI display
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Checkpoint data structure
 */
export interface EnrichmentCheckpoint {
  lastProcessedIndex: number;
  totalLeads: number;
  enrichedCount: number;
  noContactsCount: number;
  failedCount: number;
  errorCode?: string;
  errorMessage?: string;
  checkpointedAt: number;
  resumable: boolean;
}

/**
 * Save a checkpoint when pipeline-blocking error occurs
 */
export const saveCheckpoint = internalMutation({
  args: {
    searchId: v.id("searches"),
    lastProcessedIndex: v.number(),
    totalLeads: v.number(),
    enrichedCount: v.number(),
    noContactsCount: v.number(),
    failedCount: v.number(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      console.error(`[Checkpoint] Search ${args.searchId} not found`);
      return { success: false, reason: "search_not_found" };
    }

    const checkpoint: EnrichmentCheckpoint = {
      lastProcessedIndex: args.lastProcessedIndex,
      totalLeads: args.totalLeads,
      enrichedCount: args.enrichedCount,
      noContactsCount: args.noContactsCount,
      failedCount: args.failedCount,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
      checkpointedAt: Date.now(),
      resumable: true,
    };

    await ctx.db.patch(args.searchId, {
      enrichmentCheckpoint: checkpoint,
      ...(args.errorCode
        ? {
            enrichmentPaused: true,
            pausedAt: Date.now(),
          }
        : {}),
      updatedAt: Date.now(),
    });

    console.log(`[Checkpoint] Saved checkpoint for search ${args.searchId}:`, {
      lastProcessedIndex: args.lastProcessedIndex,
      totalLeads: args.totalLeads,
      enrichedCount: args.enrichedCount,
      noContactsCount: args.noContactsCount,
      failedCount: args.failedCount,
      errorCode: args.errorCode,
      remainingLeads: args.totalLeads - args.lastProcessedIndex - 1,
    });

    return {
      success: true,
      checkpoint,
      remainingLeads: args.totalLeads - args.lastProcessedIndex - 1,
    };
  },
});

/**
 * Get checkpoint for a search
 */
export const getCheckpoint = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return null;
    }

    return search.enrichmentCheckpoint ?? null;
  },
});

/**
 * Clear checkpoint after successful completion
 */
export const clearCheckpoint = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return { success: false, reason: "search_not_found" };
    }

    await ctx.db.patch(args.searchId, {
      enrichmentCheckpoint: undefined,
      updatedAt: Date.now(),
    });

    console.log(`[Checkpoint] Cleared checkpoint for search ${args.searchId}`);

    return { success: true };
  },
});

/**
 * Mark checkpoint as non-resumable (e.g., if error is permanent)
 */
export const markCheckpointNonResumable = internalMutation({
  args: {
    searchId: v.id("searches"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search || !search.enrichmentCheckpoint) {
      return { success: false, reason: "no_checkpoint_found" };
    }

    await ctx.db.patch(args.searchId, {
      enrichmentCheckpoint: {
        ...search.enrichmentCheckpoint,
        resumable: false,
        errorMessage: `${search.enrichmentCheckpoint.errorMessage ?? ''} [Not resumable: ${args.reason}]`,
      },
      updatedAt: Date.now(),
    });

    console.log(`[Checkpoint] Marked checkpoint non-resumable for search ${args.searchId}: ${args.reason}`);

    return { success: true };
  },
});

/**
 * Get leads that need processing (skipping already processed)
 */
export const getUnprocessedLeads = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return { leads: [], checkpoint: null };
    }

    // Get all leads for this search
    const allLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Filter to only pending leads (not yet processed)
    const unprocessedLeads = allLeads.filter(
      (lead) => lead.enrichmentStatus === "pending" || lead.enrichmentStatus === "in_progress"
    );

    return {
      leads: unprocessedLeads,
      checkpoint: search.enrichmentCheckpoint ?? null,
      totalLeads: allLeads.length,
      processedCount: allLeads.length - unprocessedLeads.length,
    };
  },
});

/**
 * Public query to get checkpoint status for UI
 */
export const getCheckpointStatus = query({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return null;
    }

    if (!search.enrichmentCheckpoint) {
      return {
        hasCheckpoint: false,
      };
    }

    const checkpoint = search.enrichmentCheckpoint;
    const remainingLeads = checkpoint.totalLeads - checkpoint.lastProcessedIndex - 1;
    const progressPercent = ((checkpoint.lastProcessedIndex + 1) / checkpoint.totalLeads) * 100;

    return {
      hasCheckpoint: true,
      resumable: checkpoint.resumable,
      progress: {
        processed: checkpoint.lastProcessedIndex + 1,
        total: checkpoint.totalLeads,
        percent: Math.round(progressPercent),
        remaining: remainingLeads,
      },
      stats: {
        enriched: checkpoint.enrichedCount,
        noContacts: checkpoint.noContactsCount,
        failed: checkpoint.failedCount,
      },
      error: checkpoint.errorCode
        ? {
            code: checkpoint.errorCode,
            message: checkpoint.errorMessage,
          }
        : undefined,
      checkpointedAt: checkpoint.checkpointedAt,
    };
  },
});

/**
 * Calculate checkpoint stats from current lead states
 */
export const calculateCheckpointStats = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    let enrichedCount = 0;
    let noContactsCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    let inProgressCount = 0;
    let lastProcessedIndex = -1;

    leads.forEach((lead, index) => {
      switch (lead.enrichmentStatus) {
        case "completed":
          enrichedCount++;
          lastProcessedIndex = Math.max(lastProcessedIndex, index);
          break;
        case "completed_fallback":
        case "no_contacts_found":
          noContactsCount++;
          lastProcessedIndex = Math.max(lastProcessedIndex, index);
          break;
        case "failed":
          failedCount++;
          lastProcessedIndex = Math.max(lastProcessedIndex, index);
          break;
        case "pending":
          pendingCount++;
          break;
        case "in_progress":
          inProgressCount++;
          break;
      }
    });

    return {
      totalLeads: leads.length,
      lastProcessedIndex,
      enrichedCount,
      noContactsCount,
      failedCount,
      pendingCount,
      inProgressCount,
      processedCount: enrichedCount + noContactsCount + failedCount,
    };
  },
});

/**
 * Stats result type for checkpoint calculation
 */
interface CheckpointStats {
  totalLeads: number;
  lastProcessedIndex: number;
  enrichedCount: number;
  noContactsCount: number;
  failedCount: number;
  pendingCount: number;
  inProgressCount: number;
  processedCount: number;
}

/**
 * Create checkpoint from current state (helper for error handlers)
 */
export const createCheckpointFromCurrentState = internalMutation({
  args: {
    searchId: v.id("searches"),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    reason?: string;
    checkpoint?: EnrichmentCheckpoint;
    remainingLeads?: number;
  }> => {
    // Calculate current stats
    const stats: CheckpointStats = await ctx.runQuery(
      internal.leads.enrichment.checkpoint.calculateCheckpointStats,
      { searchId: args.searchId }
    );

    // Save checkpoint with current state
    return await ctx.runMutation(
      internal.leads.enrichment.checkpoint.saveCheckpoint,
      {
        searchId: args.searchId,
        lastProcessedIndex: stats.lastProcessedIndex,
        totalLeads: stats.totalLeads,
        enrichedCount: stats.enrichedCount,
        noContactsCount: stats.noContactsCount,
        failedCount: stats.failedCount,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
      }
    );
  },
});

/**
 * Pause enrichment, save checkpoint, log error, and notify the user (once per search).
 * Called when FindyMail or other providers return pipeline-blocking errors.
 */
export const handlePipelineBlockingError = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    leadId: v.optional(v.id("leads")),
    errorCode: v.string(),
    errorMessage: v.string(),
    provider: v.string(),
    category: v.string(),
    severity: v.string(),
    suggestedAction: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    originalStatus: v.optional(v.number()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return { success: false, reason: "search_not_found" };
    }

    const alreadyBlocked =
      search.enrichmentPaused &&
      search.enrichmentCheckpoint?.errorCode === args.errorCode;

    await ctx.runMutation(
      internal.leads.enrichment.checkpoint.createCheckpointFromCurrentState,
      {
        searchId: args.searchId,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
      },
    );

    await ctx.db.patch(args.searchId, {
      enrichmentPaused: true,
      pausedAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (alreadyBlocked) {
      return { success: true, notificationsSent: false };
    }

    await ctx.runMutation(internal.search.internal.logApiError, {
      userId: args.userId,
      searchId: args.searchId,
      leadId: args.leadId,
      errorCode: args.errorCode,
      provider: args.provider,
      category: args.category,
      severity: args.severity,
      userMessage: args.errorMessage,
      originalStatus: args.originalStatus,
      operationType: "email_enrichment",
      correlationId: args.correlationId,
    });

    await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
      userId: args.userId,
      type: "pipeline_blocked",
      title: "Email Enrichment Paused",
      message:
        args.errorMessage ||
        "Enrichment has been paused due to an issue that requires your attention.",
      data: {
        searchId: args.searchId,
        errorCode: args.errorCode,
        category: args.category,
        actionRequired: args.suggestedAction,
        actionUrl: args.actionUrl,
        stage: "enrichment",
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
      category: "enrichment_error",
      entityType: "search",
      entityId: args.searchId,
      requiresAck: true,
      tags: ["enrichment", "blocked", args.category],
    });

    await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
      userId: args.userId,
      searchId: args.searchId,
      stage: "error",
      progress: 0,
      priority: "urgent",
      message: args.errorMessage,
      data: {
        stage: "enrichment",
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

    console.log(
      `[Checkpoint] Pipeline blocked for search ${args.searchId}: ${args.errorCode}`,
    );

    return { success: true, notificationsSent: true };
  },
});
