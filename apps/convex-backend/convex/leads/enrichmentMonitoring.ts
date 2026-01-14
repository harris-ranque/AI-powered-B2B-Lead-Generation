/**
 * Enrichment Monitoring System
 *
 * Detects and recovers stuck enrichment operations.
 * Runs every 5 minutes to find leads stuck in "in_progress" state.
 *
 * Thresholds:
 * - 10 minutes: Lead is considered stuck, reset to pending for retry
 * - 30 minutes: Lead is considered failed, mark as failed with error
 */

import { internalMutation, internalQuery, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// Thresholds for stuck detection
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const FAILED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Query leads that are stuck in in_progress state
 */
export const getStuckEnrichmentLeads = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const now = Date.now();
    const stuckThreshold = now - STUCK_THRESHOLD_MS;

    // Query leads that are in_progress with old start times
    const stuckLeads = await ctx.db
      .query("leads")
      .withIndex("by_enrichment_status_time", (q) =>
        q.eq("enrichmentStatus", "in_progress")
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("enrichmentStartedAt"), undefined),
          q.lt(q.field("enrichmentStartedAt"), stuckThreshold)
        )
      )
      .take(limit);

    return stuckLeads.map((lead) => ({
      ...lead,
      stuckDurationMs: now - (lead.enrichmentStartedAt ?? now),
      shouldFail: now - (lead.enrichmentStartedAt ?? now) > FAILED_THRESHOLD_MS,
    }));
  },
});

/**
 * Recover a single stuck lead
 *
 * - If stuck < 30 min: Reset to pending for retry
 * - If stuck >= 30 min: Mark as failed
 */
export const recoverStuckEnrichmentLead = internalMutation({
  args: {
    leadId: v.id("leads"),
    forceFailure: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      console.error(`[Enrichment Monitor] Lead ${args.leadId} not found`);
      return { success: false, reason: "lead_not_found" };
    }

    // Skip if not in in_progress state
    if (lead.enrichmentStatus !== "in_progress") {
      console.log(
        `[Enrichment Monitor] Lead ${args.leadId} already in ${lead.enrichmentStatus}, skipping`
      );
      return { success: true, reason: "already_processed" };
    }

    const now = Date.now();
    const stuckDuration = now - (lead.enrichmentStartedAt ?? now);
    const shouldFail = args.forceFailure || stuckDuration > FAILED_THRESHOLD_MS;

    // Track recovery attempts (use enrichmentAttempts field)
    const recoveryAttempts = lead.enrichmentAttempts ?? 0;

    if (shouldFail || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      // Mark as failed
      await ctx.db.patch(args.leadId, {
        enrichmentStatus: "failed",
        enrichmentCompletedAt: now,
        enrichmentError: `Enrichment timed out after ${Math.round(stuckDuration / 60000)} minutes`,
      });

      console.log(
        `[Enrichment Monitor] Lead ${args.leadId} marked as failed (stuck ${Math.round(stuckDuration / 60000)}min, attempts: ${recoveryAttempts})`
      );

      return { success: true, action: "failed", stuckDurationMs: stuckDuration };
    } else {
      // Reset to pending for retry - increment enrichmentAttempts to track recovery attempts
      await ctx.db.patch(args.leadId, {
        enrichmentStatus: "pending",
        enrichmentStartedAt: undefined,
        enrichmentAttempts: recoveryAttempts + 1,
      });

      console.log(
        `[Enrichment Monitor] Lead ${args.leadId} reset to pending (stuck ${Math.round(stuckDuration / 60000)}min, attempt ${recoveryAttempts + 1})`
      );

      return { success: true, action: "reset", stuckDurationMs: stuckDuration };
    }
  },
});

/**
 * Main cron handler - monitor and recover stuck enrichments
 */
export const monitorStuckEnrichments = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get stuck leads
    const stuckLeads = await ctx.runQuery(
      internal.leads.enrichmentMonitoring.getStuckEnrichmentLeads,
      { limit: 50 }
    );

    if (stuckLeads.length === 0) {
      return { checked: 0, recovered: 0, failed: 0 };
    }

    console.log(
      `[Enrichment Monitor] Found ${stuckLeads.length} stuck leads`
    );

    let recovered = 0;
    let failed = 0;
    const affectedSearchIds = new Set<Id<"searches">>();

    for (const lead of stuckLeads) {
      const result = await ctx.runMutation(
        internal.leads.enrichmentMonitoring.recoverStuckEnrichmentLead,
        {
          leadId: lead._id,
          forceFailure: lead.shouldFail,
        }
      );

      if (result.action === "reset") {
        recovered++;
        affectedSearchIds.add(lead.searchId);
      } else if (result.action === "failed") {
        failed++;
        affectedSearchIds.add(lead.searchId);
      }
    }

    // Check each affected search for re-triggering enrichment or completion
    for (const searchId of affectedSearchIds) {
      await ctx.runMutation(
        internal.leads.enrichmentMonitoring.checkSearchEnrichmentState,
        { searchId }
      );
    }

    console.log(
      `[Enrichment Monitor] Completed: ${recovered} reset to pending, ${failed} marked failed`
    );

    return { checked: stuckLeads.length, recovered, failed };
  },
});

/**
 * Check search enrichment state after recovery
 *
 * Determines if we need to:
 * 1. Re-trigger enrichment for pending leads
 * 2. Trigger analysis phase if all done
 */
export const checkSearchEnrichmentState = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const { searchId } = args;

    // Get search status
    const search = await ctx.db.get(searchId);
    if (!search) {
      console.error(`[Enrichment Monitor] Search ${searchId} not found`);
      return;
    }

    // Skip if search is already completed or in final processing
    if (search.status === "completed" || search.status === "failed" || search.status === "cancelled") {
      return;
    }

    // Count leads by status
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", searchId))
      .collect();

    const statusCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    };

    for (const lead of leads) {
      const status = lead.enrichmentStatus ?? "pending";
      if (status in statusCounts) {
        statusCounts[status as keyof typeof statusCounts]++;
      }
    }

    console.log(
      `[Enrichment Monitor] Search ${searchId} lead status: ` +
        `pending=${statusCounts.pending}, in_progress=${statusCounts.in_progress}, ` +
        `completed=${statusCounts.completed}, failed=${statusCounts.failed}`
    );

    // If there are pending leads and no in_progress, re-trigger enrichment
    if (statusCounts.pending > 0 && statusCounts.in_progress === 0) {
      console.log(
        `[Enrichment Monitor] Re-triggering enrichment for search ${searchId} (${statusCounts.pending} pending)`
      );

      // Schedule re-enrichment via the async enrichment action
      await ctx.scheduler.runAfter(
        1000, // Small delay to avoid hammering
        internal.leads.asyncEnrichment.resumeEnrichmentFromCheckpoint,
        { searchId }
      );
    }

    // If all leads are done (completed or failed), trigger analysis
    const allDone = statusCounts.pending === 0 && statusCounts.in_progress === 0;
    if (allDone && leads.length > 0) {
      console.log(
        `[Enrichment Monitor] All leads done for search ${searchId}, checking analysis trigger`
      );

      // Clear checkpoint
      await ctx.runMutation(
        internal.leads.enrichment.checkpoint.clearCheckpoint,
        { searchId }
      );

      // Try to trigger analysis
      const shouldTriggerAnalysis = await ctx.runMutation(
        internal.leads.internal.tryTriggerAnalysisPhase,
        { searchId }
      );

      if (shouldTriggerAnalysis) {
        await ctx.scheduler.runAfter(
          0,
          (internal as any)["leads/actions"].analyzeLeads,
          { searchId }
        );
        console.log(`[Enrichment Monitor] Analysis phase triggered for search ${searchId}`);
      }
    }
  },
});

/**
 * Get enrichment monitoring stats for dashboard
 */
export const getEnrichmentMonitoringStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Count leads in in_progress state by duration
    const inProgressLeads = await ctx.db
      .query("leads")
      .withIndex("by_enrichment_status_time", (q) =>
        q.eq("enrichmentStatus", "in_progress")
      )
      .collect();

    const stats = {
      totalInProgress: inProgressLeads.length,
      stuckLessThan10Min: 0,
      stuck10To30Min: 0,
      stuckOver30Min: 0,
      oldestStuckMs: 0,
    };

    for (const lead of inProgressLeads) {
      const duration = now - (lead.enrichmentStartedAt ?? now);
      stats.oldestStuckMs = Math.max(stats.oldestStuckMs, duration);

      if (duration < STUCK_THRESHOLD_MS) {
        stats.stuckLessThan10Min++;
      } else if (duration < FAILED_THRESHOLD_MS) {
        stats.stuck10To30Min++;
      } else {
        stats.stuckOver30Min++;
      }
    }

    return stats;
  },
});
