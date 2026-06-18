/**
 * Workpool Configuration for Lead Enrichment
 *
 * This module sets up a Workpool-based enrichment system that:
 * - Manages queue and parallelism across all users (maxParallelism: 25)
 * - Provides built-in retry with exponential backoff
 * - Tracks completion via onComplete callbacks
 * - Works with the per-API-key semaphore for FindyMail rate limiting
 *
 * Architecture:
 * - Workpool handles: Queue management, retries, parallelism, completion tracking
 * - Semaphore handles: Per-API-key rate limiting (5 concurrent per unique key)
 *
 * This hybrid approach supports:
 * - 500+ lead searches sustainably
 * - Multiple users with their own API keys
 * - Proper backpressure and retry handling
 */

import { Workpool, vOnCompleteArgs, type WorkId } from "@convex-dev/workpool";
import { components } from "../_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import {
  schedulePendingLinkedEnrichmentRecovery,
  scheduleSearchCompletionIfReady,
} from "../lib/searchCompletion";

async function triggerAnalysisOrCompleteSearch(
  ctx: MutationCtx,
  searchId: Id<"searches">,
  batchId: string,
  triggeredBy: string,
): Promise<void> {
  const shouldTriggerAnalysis = await ctx.runMutation(
    internal.leads.internal.tryTriggerAnalysisPhase,
    { searchId },
  );

  if (shouldTriggerAnalysis) {
    console.log(`[Workpool] Analysis phase triggered for search ${searchId}`);

    try {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["leads/actions"].analyzeLeads,
        { searchId },
      );
      console.log(
        `[Workpool] ✅ Analysis scheduled successfully for search ${searchId}`,
      );
    } catch (scheduleError) {
      const scheduleErrorMsg =
        scheduleError instanceof Error
          ? scheduleError.message
          : String(scheduleError);
      console.error(
        `[Workpool] ❌ Failed to schedule analysis for search ${searchId}: ${scheduleErrorMsg}`,
      );

      await ctx.runMutation(
        internal.leads.deadLetterQueue.recordFailedOperation,
        {
          operationType: "analysis_trigger",
          searchId,
          error: `Analysis scheduling failed: ${scheduleErrorMsg}`,
          context: { batchId, triggeredBy },
          maxRetries: 5,
        },
      );
    }
    return;
  }

  const completion = await scheduleSearchCompletionIfReady(ctx, searchId);
  if (completion.scheduled) {
    console.log(
      `[Workpool] ✅ Search completion scheduled for ${searchId} (${completion.reason})`,
    );
    return;
  }

  if (completion.reason === "linked_enrichment_incomplete") {
    const recovery = await schedulePendingLinkedEnrichmentRecovery(
      ctx,
      searchId,
    );
    if (recovery.scheduled) {
      console.log(
        `[Workpool] Scheduled linked re-enrichment for search ${searchId} (${recovery.pendingCount} pending duplicate businesses)`,
      );
      return;
    }
    console.log(
      `[Workpool] Analysis not triggered for search ${searchId} (${completion.reason}; recovery: ${recovery.reason})`,
    );
    return;
  }

  console.log(
    `[Workpool] Analysis not triggered for search ${searchId} (${completion.reason})`,
  );
}

function isEnrichmentReturnSuccessful(returnValue: unknown): boolean {
  if (!returnValue || typeof returnValue !== "object") {
    return false;
  }

  const value = returnValue as {
    success?: boolean;
    reason?: string;
    retrying?: boolean;
    skipped?: boolean;
  };

  if (value.retrying) {
    return false;
  }

  if (
    value.reason === "queued" ||
    value.reason === "requeued" ||
    value.reason === "queued_for_cron"
  ) {
    return false;
  }

  if (value.reason === "queue_failed" || value.retrying) {
    return false;
  }

  if (value.reason === "pipeline_blocked") {
    return false;
  }

  if (typeof value.success === "boolean") {
    return value.success;
  }

  return !value.skipped;
}

function isPipelineBlockedReturn(returnValue: unknown): boolean {
  if (!returnValue || typeof returnValue !== "object") {
    return false;
  }

  return (returnValue as { reason?: string }).reason === "pipeline_blocked";
}

async function isEnrichmentBlockedForSearch(
  ctx: MutationCtx,
  searchId: Id<"searches">,
): Promise<boolean> {
  const search = await ctx.db.get(searchId);
  return Boolean(
    search?.enrichmentPaused && search.enrichmentCheckpoint?.errorCode,
  );
}

async function finalizeEnrichmentBatchIfReady(
  ctx: MutationCtx,
  searchId: Id<"searches">,
  batchId: string,
  triggeredBy: string,
): Promise<void> {
  if (await isEnrichmentBlockedForSearch(ctx, searchId)) {
    console.log(
      `[Workpool] Skipping analysis/completion — enrichment blocked for search ${searchId}`,
    );
    return;
  }

  await ctx.runMutation(internal.leads.enrichment.checkpoint.clearCheckpoint, {
    searchId,
  });

  await triggerAnalysisOrCompleteSearch(ctx, searchId, batchId, triggeredBy);
}

/**
 * People discovery progress — does not update search.progress.enriched (emails).
 */
async function publishPeopleDiscoveryProgress(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    searchId: Id<"searches">;
    batchId: string;
    totalLeads: number;
    completedLeads: number;
    businessesWithPeople: number;
    totalProspects: number;
    failedLeads: number;
  },
): Promise<void> {
  const progressPercent =
    args.totalLeads > 0
      ? Math.round((args.completedLeads / args.totalLeads) * 100)
      : 0;

  const search = await ctx.db.get(args.searchId);
  const currentProgress = search?.progress;

  await ctx.runMutation(internal.search.internal.updateSearchProgressInternal, {
    searchId: args.searchId,
    progress: {
      discovered: args.totalLeads,
      enriched: currentProgress?.enriched ?? 0,
      analyzed: currentProgress?.analyzed ?? 0,
      total: args.totalLeads,
    },
  });

  await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
    userId: args.userId,
    searchId: args.searchId,
    stage: "people_discovery",
    progress: progressPercent,
    message: `Found ${args.totalProspects} people at ${args.businessesWithPeople} of ${args.totalLeads} businesses (${progressPercent}% scanned)`,
    data: {
      progress: {
        peopleDiscovered: args.totalProspects,
        peopleBusinesses: args.businessesWithPeople,
        total: args.totalLeads,
      },
      peopleDiscovery: {
        totalLeads: args.totalLeads,
        completedLeads: args.completedLeads,
        businessesWithPeople: args.businessesWithPeople,
        totalProspects: args.totalProspects,
        failedLeads: args.failedLeads,
        percentComplete: progressPercent,
        batchId: args.batchId,
      },
    },
  });

  await ctx.runMutation(
    internal.leads.peopleDiscoveryInternal.appendPeopleDiscoveryLog,
    {
      searchId: args.searchId,
      userId: args.userId,
      batchId: args.batchId,
      event: "progress",
      message: `${args.completedLeads}/${args.totalLeads} businesses scanned · ${args.totalProspects} people · ${args.businessesWithPeople} businesses with matches`,
      metadata: {
        completedLeads: args.completedLeads,
        totalLeads: args.totalLeads,
        businessesWithPeople: args.businessesWithPeople,
        totalProspects: args.totalProspects,
        failedLeads: args.failedLeads,
        percentComplete: progressPercent,
      },
    },
  );
}

/**
 * Keep search.progress and pipeline broadcasts aligned during enrichment.
 * `successfulLeads` = businesses with at least one accepted email (UI "emails found").
 * `completedLeads` = businesses finished processing (success, failure, or no contacts).
 */
async function publishEnrichmentProgress(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    searchId: Id<"searches">;
    batchId: string;
    totalLeads: number;
    completedLeads: number;
    successfulLeads: number;
    failedLeads: number;
    analyzed: number;
  },
): Promise<void> {
  const progressPercent =
    args.totalLeads > 0
      ? Math.round((args.completedLeads / args.totalLeads) * 100)
      : 0;

  await ctx.runMutation(internal.search.internal.updateSearchProgressInternal, {
    searchId: args.searchId,
    progress: {
      discovered: args.totalLeads,
      enriched: args.successfulLeads,
      analyzed: args.analyzed,
      total: args.totalLeads,
    },
  });

  await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
    userId: args.userId,
    searchId: args.searchId,
    stage: "enrichment",
    progress: progressPercent,
    message: `Found emails for ${args.successfulLeads} of ${args.totalLeads} businesses (${progressPercent}% processed)`,
    data: {
      progress: {
        discovered: args.totalLeads,
        enriched: args.successfulLeads,
        analyzed: args.analyzed,
        total: args.totalLeads,
      },
      enrichmentBreakdown: {
        completed: args.successfulLeads,
        failed: args.failedLeads,
        pending: args.totalLeads - args.completedLeads,
        percentComplete: progressPercent,
      },
      workpoolBatch: {
        batchId: args.batchId,
        completedLeads: args.completedLeads,
        totalLeads: args.totalLeads,
      },
    },
  });
}

/**
 * Workpool instance for lead enrichment
 *
 * Configuration:
 * - maxParallelism: 25 - Supports ~5 concurrent users with their own API keys
 *   (Each user's API key allows 5 concurrent FindyMail requests)
 * - retryActionsByDefault: true - Retry failed enrichments automatically
 * - defaultRetryBehavior: Exponential backoff starting at 2s, max 5 attempts
 * - logLevel: INFO - Useful for monitoring without being too verbose
 */
export const enrichmentPool = new Workpool(components.workpool, {
  maxParallelism: 25,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2, // 2s, 4s, 8s, 16s, 32s
  },
  logLevel: "INFO",
});

/**
 * Context passed to the onComplete handler
 * Contains all info needed to track progress and trigger analysis phase
 */
export interface EnrichmentBatchContext {
  searchId: Id<"searches">;
  userId: Id<"users">;
  totalLeads: number;
  batchId: string; // Unique ID for this batch
  startedAt: number;
}

/**
 * Schema for tracking enrichment batches
 * Stored in the database to persist progress across function calls
 */
export const enrichmentBatchTracker = {
  batchId: v.string(),
  searchId: v.id("searches"),
  userId: v.id("users"),
  totalLeads: v.number(),
  completedLeads: v.number(),
  successfulLeads: v.number(),
  failedLeads: v.number(),
  workIds: v.array(v.string()),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed")
  ),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
};

/**
 * Initialize a new enrichment batch tracker
 * Called when starting enrichment for a search
 */
export const initEnrichmentBatch = internalMutation({
  args: {
    batchId: v.string(),
    searchId: v.id("searches"),
    userId: v.id("users"),
    totalLeads: v.number(),
    workIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if batch already exists
    const existing = await ctx.db
      .query("enrichmentBatches")
      .withIndex("by_batch_id", (q) => q.eq("batchId", args.batchId))
      .first();

    if (existing) {
      console.log(`[Workpool] Batch ${args.batchId} already exists, skipping init`);
      return existing._id;
    }

    const batchId = await ctx.db.insert("enrichmentBatches", {
      batchId: args.batchId,
      searchId: args.searchId,
      userId: args.userId,
      totalLeads: args.totalLeads,
      completedLeads: 0,
      successfulLeads: 0,
      failedLeads: 0,
      workIds: args.workIds,
      status: "running",
      startedAt: Date.now(),
    });

    console.log(
      `[Workpool] Initialized enrichment batch ${args.batchId} for search ${args.searchId} with ${args.totalLeads} leads`
    );

    return batchId;
  },
});

/**
 * Get batch status for monitoring
 */
export const getBatchStatus = internalQuery({
  args: {
    batchId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("enrichmentBatches")
      .withIndex("by_batch_id", (q) => q.eq("batchId", args.batchId))
      .first();
  },
});

/**
 * OnComplete handler for individual lead enrichment
 *
 * This is called by Workpool after each lead enrichment completes (success or failure).
 * It tracks progress and triggers the analysis phase when all leads are done.
 */
export const onEnrichmentComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      searchId: v.id("searches"),
      userId: v.id("users"),
      leadId: v.id("leads"),
      batchId: v.string(),
    })
  ),
  handler: async (ctx, { workId, context, result }) => {
    const { searchId, userId, leadId, batchId } = context;

    try {
      // Check if this was a queued lead (not actually processed yet)
      // When a lead is queued for later processing, it returns success with reason: "queued"
      // In this case, DON'T count it as completed - it will be processed later from the queue
      if (result.kind === "success" && result.returnValue) {
        const returnValue = result.returnValue as any;
        if (
          returnValue.reason === "queued" ||
          returnValue.reason === "requeued" ||
          returnValue.reason === "queued_for_cron"
        ) {
          console.log(
            `[Workpool] Lead ${leadId} queued for later processing (not counting as completed)`
          );
          return; // Don't update batch counters - lead will be processed later
        }
      }

      // Get the batch tracker
      const batch = await ctx.db
        .query("enrichmentBatches")
        .withIndex("by_batch_id", (q) => q.eq("batchId", batchId))
        .first();

      if (!batch) {
        console.error(`[Workpool] Batch ${batchId} not found for workId ${workId}`);
        return;
      }

      if (batch.status === "failed") {
        return;
      }

      // Update batch progress — count enrichment success only when contacts were accepted
      const returnValue =
        result.kind === "success" ? (result.returnValue as unknown) : undefined;

      if (isPipelineBlockedReturn(returnValue)) {
        console.log(
          `[Workpool] Pipeline blocked for search ${searchId}, stopping batch ${batchId}`,
        );
        await ctx.db.patch(batch._id, {
          completedLeads: batch.completedLeads + 1,
          failedLeads: batch.failedLeads + 1,
          status: "failed",
          completedAt: Date.now(),
        });
        return;
      }

      const isSuccess =
        result.kind === "success" && isEnrichmentReturnSuccessful(returnValue);
      const isFailed = result.kind === "failed" || result.kind === "canceled";

      const newCompletedLeads = batch.completedLeads + 1;
      const newSuccessfulLeads = batch.successfulLeads + (isSuccess ? 1 : 0);
      const newFailedLeads = batch.failedLeads + (isFailed ? 1 : 0);

      const isComplete = newCompletedLeads >= batch.totalLeads;

      await ctx.db.patch(batch._id, {
        completedLeads: newCompletedLeads,
        successfulLeads: newSuccessfulLeads,
        failedLeads: newFailedLeads,
        status: isComplete ? "completed" : "running",
        completedAt: isComplete ? Date.now() : undefined,
      });

      // Log progress
      const progressPercent = Math.round((newCompletedLeads / batch.totalLeads) * 100);
      console.log(
        `[Workpool] Lead ${leadId} enrichment ${result.kind} (${newCompletedLeads}/${batch.totalLeads} = ${progressPercent}%)`
      );

      const search = await ctx.db.get(searchId);
      const analyzed = search?.progress?.analyzed ?? 0;

      await publishEnrichmentProgress(ctx, {
        userId,
        searchId,
        batchId,
        totalLeads: batch.totalLeads,
        completedLeads: newCompletedLeads,
        successfulLeads: newSuccessfulLeads,
        failedLeads: newFailedLeads,
        analyzed,
      });

      // If all leads are complete, trigger the analysis phase
      if (isComplete) {
        console.log(
          `[Workpool] 🎉 All ${batch.totalLeads} leads enriched! Triggering analysis phase...`
        );

        await finalizeEnrichmentBatchIfReady(
          ctx,
          searchId,
          batchId,
          "workpool_onComplete",
        );

        // Calculate and log final stats
        const duration = Date.now() - batch.startedAt;
        const leadsPerSecond = batch.totalLeads / (duration / 1000);

        console.log(
          `[Workpool] Enrichment batch ${batchId} completed:`,
          {
            totalLeads: batch.totalLeads,
            successful: newSuccessfulLeads,
            failed: newFailedLeads,
            durationMs: duration,
            leadsPerSecond: leadsPerSecond.toFixed(2),
          }
        );
      }
    } catch (error) {
      // CRITICAL: Record to dead letter queue for retry
      // This prevents pipeline stalls when completion handler fails due to OCC or other issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[Workpool] Completion handler failed for lead ${leadId}: ${errorMessage}`
      );

      await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
        operationType: "enrichment_completion",
        searchId,
        leadId,
        error: errorMessage,
        context: { batchId, workId },
        maxRetries: 5,
      });

      // Also record analysis trigger as a separate DLQ entry to ensure it gets retried
      // This provides a safety net if the batch completion was the last lead
      await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
        operationType: "analysis_trigger",
        searchId,
        error: `Analysis trigger needed after completion handler failure: ${errorMessage}`,
        context: { batchId, triggeredBy: "completion_failure_recovery" },
        maxRetries: 5,
      });

      // Don't rethrow - the workpool task succeeded, only the completion mutation failed
      // The DLQ processor will retry this operation
    }
  },
});

/**
 * Helper function to generate a unique batch ID
 */
export function generateBatchId(searchId: Id<"searches">): string {
  return `batch_${searchId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Report completion for a lead that was processed from the queue
 *
 * When a lead is processed from the slot queue (not directly from workpool),
 * we need to manually update the batch progress since the workpool's onComplete
 * handler won't be called.
 *
 * This is called after enrichment completes for a queued lead.
 */
export const reportQueuedLeadCompletion = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      // Find the batch for this search
      const batch = await ctx.db
        .query("enrichmentBatches")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
        .filter((q) => q.eq(q.field("status"), "running"))
        .first();

      if (!batch) {
        console.log(
          `[Workpool] No running batch found for search ${args.searchId} (lead ${args.leadId})`
        );

        // CRITICAL FIX: Even if no batch found, check if all enrichment is complete
        // This handles edge cases where batch was already completed but late leads came in
        console.log(`[Workpool] Checking if analysis should be triggered despite no running batch...`);

        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId: args.searchId }
        );

        if (shouldTriggerAnalysis) {
          console.log(`[Workpool] ✅ Analysis triggered for search ${args.searchId} (late lead recovery)`);

          try {
            await ctx.scheduler.runAfter(
              0,
              (internal as any)["leads/actions"].analyzeLeads,
              { searchId: args.searchId }
            );
            console.log(`[Workpool] ✅ Analysis scheduled successfully for search ${args.searchId}`);
          } catch (scheduleError) {
            const scheduleErrorMsg = scheduleError instanceof Error ? scheduleError.message : String(scheduleError);
            console.error(
              `[Workpool] ❌ Failed to schedule analysis for search ${args.searchId}: ${scheduleErrorMsg}`
            );

            await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
              operationType: "analysis_trigger",
              searchId: args.searchId,
              error: `Analysis scheduling failed (late lead recovery): ${scheduleErrorMsg}`,
              context: { triggeredBy: "no_batch_fallback", leadId: args.leadId },
              maxRetries: 5,
            });
          }

          return { updated: false, reason: "no_running_batch_analysis_triggered" };
        }

        await triggerAnalysisOrCompleteSearch(
          ctx,
          args.searchId,
          "no_batch",
          "queued_no_batch_fallback",
        );

        return { updated: false, reason: "no_running_batch" };
      }

      // Update batch progress
      const newCompletedLeads = batch.completedLeads + 1;
      const newSuccessfulLeads = batch.successfulLeads + (args.success ? 1 : 0);
      const newFailedLeads = batch.failedLeads + (args.success ? 0 : 1);

      const isComplete = newCompletedLeads >= batch.totalLeads;

      await ctx.db.patch(batch._id, {
        completedLeads: newCompletedLeads,
        successfulLeads: newSuccessfulLeads,
        failedLeads: newFailedLeads,
        status: isComplete ? "completed" : "running",
        completedAt: isComplete ? Date.now() : undefined,
      });

      // Log progress
      const progressPercent = Math.round((newCompletedLeads / batch.totalLeads) * 100);
      console.log(
        `[Workpool] Queued lead ${args.leadId} enrichment ${args.success ? "success" : "failed"} ` +
        `(${newCompletedLeads}/${batch.totalLeads} = ${progressPercent}%)`
      );

      // Also get userId for broadcasting
      const search = await ctx.db.get(args.searchId);
      if (!search) {
        return { updated: true, isComplete };
      }

      const analyzed = search.progress?.analyzed ?? 0;

      await publishEnrichmentProgress(ctx, {
        userId: search.userId,
        searchId: args.searchId,
        batchId: batch.batchId,
        totalLeads: batch.totalLeads,
        completedLeads: newCompletedLeads,
        successfulLeads: newSuccessfulLeads,
        failedLeads: newFailedLeads,
        analyzed,
      });

      // If all leads are complete, trigger the analysis phase
      if (isComplete) {
        console.log(
          `[Workpool] 🎉 All ${batch.totalLeads} leads enriched (from queue)! Triggering analysis phase...`
        );

        await finalizeEnrichmentBatchIfReady(
          ctx,
          args.searchId,
          batch.batchId,
          "queued_lead_completion",
        );
      }

      return { updated: true, isComplete, progressPercent };
    } catch (error) {
      // CRITICAL: Record to dead letter queue for retry
      // This prevents pipeline stalls when completion handler fails due to OCC or other issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[Workpool] Queued lead completion handler failed for lead ${args.leadId}: ${errorMessage}`
      );

      await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
        operationType: "enrichment_completion",
        searchId: args.searchId,
        leadId: args.leadId,
        error: errorMessage,
        context: { success: args.success, triggeredBy: "slot_queue", isQueuedLead: true },
        maxRetries: 5,
      });

      // Also record analysis trigger as a separate DLQ entry to ensure it gets retried
      // This provides a safety net if the batch completion was the last lead
      await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
        operationType: "analysis_trigger",
        searchId: args.searchId,
        error: `Analysis trigger needed after queued lead completion failure: ${errorMessage}`,
        context: { triggeredBy: "queued_completion_failure_recovery" },
        maxRetries: 5,
      });

      // Return error state but don't throw - DLQ processor will retry
      return { updated: false, reason: "handler_failed", error: errorMessage };
    }
  },
});

/**
 * OnComplete handler for people discovery (Phase 2A).
 * When all leads finish, triggers FindyMail email discovery (enrichLeads).
 */
export const onPeopleDiscoveryComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      searchId: v.id("searches"),
      userId: v.id("users"),
      leadId: v.id("leads"),
      batchId: v.string(),
    }),
  ),
  handler: async (ctx, { workId, context, result }) => {
    const { searchId, userId, leadId, batchId } = context;

    try {
      const batch = await ctx.db
        .query("enrichmentBatches")
        .withIndex("by_batch_id", (q) => q.eq("batchId", batchId))
        .first();

      if (!batch) {
        console.error(
          `[Workpool] People discovery batch ${batchId} not found for workId ${workId}`,
        );
        return;
      }

      const returnValue =
        result.kind === "success" ? (result.returnValue as unknown) : undefined;
      const prospectCount =
        returnValue &&
        typeof returnValue === "object" &&
        "prospectCount" in returnValue &&
        typeof (returnValue as { prospectCount?: number }).prospectCount ===
          "number"
          ? (returnValue as { prospectCount: number }).prospectCount
          : 0;
      const isSuccess =
        result.kind === "success" &&
        typeof returnValue === "object" &&
        (returnValue as { success?: boolean }).success === true &&
        prospectCount > 0;
      const isFailed = result.kind === "failed" || result.kind === "canceled";

      const lead = await ctx.db.get(leadId);

      if (isFailed) {
        await ctx.runMutation(
          internal.leads.peopleDiscoveryInternal.appendPeopleDiscoveryLog,
          {
            searchId,
            userId,
            leadId,
            batchId,
            event: "lead_failed",
            message: `People discovery workpool ${result.kind}`,
            businessName: lead?.businessName,
            metadata: {
              workId: String(workId),
              kind: result.kind,
            },
          },
        );
      }

      const newCompletedLeads = batch.completedLeads + 1;
      const newSuccessfulLeads = batch.successfulLeads + (isSuccess ? 1 : 0);
      const newFailedLeads = batch.failedLeads + (isFailed ? 1 : 0);
      const isComplete = newCompletedLeads >= batch.totalLeads;

      await ctx.db.patch(batch._id, {
        completedLeads: newCompletedLeads,
        successfulLeads: newSuccessfulLeads,
        failedLeads: newFailedLeads,
        status: isComplete ? "completed" : "running",
        completedAt: isComplete ? Date.now() : undefined,
      });

      const progressPercent = Math.round(
        (newCompletedLeads / batch.totalLeads) * 100,
      );
      console.log(
        `[Workpool] People discovery lead ${leadId} ${result.kind} (${newCompletedLeads}/${batch.totalLeads} = ${progressPercent}%)`,
      );

      const prospects = await ctx.db
        .query("leadProspects")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .collect();
      const totalProspects = prospects.length;
      const businessesWithPeople = new Set(
        prospects.map((prospect) => String(prospect.leadId)),
      ).size;

      await publishPeopleDiscoveryProgress(ctx, {
        userId,
        searchId,
        batchId,
        totalLeads: batch.totalLeads,
        completedLeads: newCompletedLeads,
        businessesWithPeople,
        totalProspects,
        failedLeads: newFailedLeads,
      });

      if (isComplete) {
        console.log(
          `[Workpool] People discovery complete for search ${searchId}, scheduling email discovery`,
        );

        const prospectStats = await ctx.runQuery(
          internal.leads.peopleDiscoveryInternal.countProspectsBySearch,
          { searchId },
        );

        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId,
            searchId,
            stage: "people_discovery",
            progress: 100,
            message: `Found ${prospectStats.total} decision makers across ${batch.totalLeads} businesses`,
            data: {
              peopleDiscovery: {
                totalProspects: prospectStats.total,
                byStatus: prospectStats.byStatus,
              },
            },
          },
        );

        await ctx.runMutation(
          internal.leads.peopleDiscoveryInternal.appendPeopleDiscoveryLog,
          {
            searchId,
            userId,
            batchId,
            event: "batch_completed",
            message: `People discovery complete — ${prospectStats.total} people across ${batch.totalLeads} businesses`,
            metadata: {
              totalProspects: prospectStats.total,
              byStatus: prospectStats.byStatus,
              successfulLeads: newSuccessfulLeads,
              failedLeads: newFailedLeads,
            },
          },
        );

        await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
          searchId,
        });
      }
    } catch (error) {
      console.error(
        `[Workpool] onPeopleDiscoveryComplete error for lead ${leadId}:`,
        error,
      );
    }
  },
});

/**
 * Cancel all pending enrichment work for a search
 * Useful when user wants to stop a search mid-enrichment
 */
export const cancelEnrichmentBatch = internalMutation({
  args: {
    batchId: v.string(),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("enrichmentBatches")
      .withIndex("by_batch_id", (q) => q.eq("batchId", args.batchId))
      .first();

    if (!batch) {
      console.error(`[Workpool] Batch ${args.batchId} not found for cancellation`);
      return { success: false, reason: "batch_not_found" };
    }

    // Cancel all pending work in the pool
    // Note: This uses the Workpool's cancelAll which cancels ALL pending work
    // For per-batch cancellation, we'd need to track and cancel individual workIds
    console.log(`[Workpool] Cancelling batch ${args.batchId} with ${batch.workIds.length} work items`);

    // Mark batch as failed
    await ctx.db.patch(batch._id, {
      status: "failed",
      completedAt: Date.now(),
    });

    return { success: true, cancelledCount: batch.workIds.length };
  },
});
