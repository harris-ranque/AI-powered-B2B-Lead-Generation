/**
 * Dead Letter Queue Processor
 *
 * Cron-based processor for retrying failed pipeline operations.
 * Runs every 2 minutes to process pending operations from the DLQ.
 *
 * Handles three operation types:
 * - enrichment_completion: Re-attempt completion handler logic
 * - analysis_trigger: Re-schedule the analysis phase
 * - batch_finalization: Re-attempt batch completion
 */

import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

/**
 * Main cron handler - processes all pending DLQ operations
 *
 * This runs every 2 minutes and:
 * 1. Gets all operations ready for retry
 * 2. Processes each by type
 * 3. Records success or failure
 */
export const processDeadLetterQueue = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get pending operations ready for retry
    const pendingOps = await ctx.runQuery(
      internal.leads.deadLetterQueue.getPendingRetries,
      { limit: 20 } // Process in batches to avoid timeout
    );

    if (pendingOps.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    console.log(`[DLQ Processor] Processing ${pendingOps.length} pending operations`);

    let succeeded = 0;
    let failed = 0;

    for (const op of pendingOps) {
      try {
        // Mark as retrying
        await ctx.runMutation(
          internal.leads.deadLetterQueue.markRetrying,
          { operationId: op._id }
        );

        // Process based on operation type
        let success = false;

        switch (op.operationType) {
          case "enrichment_completion":
            success = await handleEnrichmentCompletion(ctx, op);
            break;
          case "analysis_trigger":
            success = await handleAnalysisTrigger(ctx, op);
            break;
          case "batch_finalization":
            success = await handleBatchFinalization(ctx, op);
            break;
          case "slot_release":
            success = await handleSlotRelease(ctx, op);
            break;
          default:
            console.error(`[DLQ Processor] Unknown operation type: ${op.operationType}`);
            success = false;
        }

        if (success) {
          await ctx.runMutation(
            internal.leads.deadLetterQueue.markResolved,
            { operationId: op._id }
          );
          succeeded++;
        } else {
          await ctx.runMutation(
            internal.leads.deadLetterQueue.recordRetryFailure,
            {
              operationId: op._id,
              error: "Operation returned false",
            }
          );
          failed++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(
          `[DLQ Processor] Error processing operation ${op._id}: ${errorMessage}`
        );

        await ctx.runMutation(
          internal.leads.deadLetterQueue.recordRetryFailure,
          {
            operationId: op._id,
            error: errorMessage,
          }
        );
        failed++;
      }
    }

    console.log(
      `[DLQ Processor] Completed: ${succeeded} succeeded, ${failed} failed`
    );

    return { processed: pendingOps.length, succeeded, failed };
  },
});

/**
 * Handle enrichment_completion operation retry
 *
 * This re-attempts the completion handler logic when it failed due to OCC or other issues.
 * Checks if search still needs completion and triggers analysis phase if ready.
 */
async function handleEnrichmentCompletion(
  ctx: any,
  op: {
    _id: Id<"failedOperations">;
    searchId: Id<"searches">;
    leadId?: Id<"leads">;
    context?: any;
  }
): Promise<boolean> {
  const { searchId, leadId, context } = op;

  console.log(
    `[DLQ Processor] Handling enrichment_completion for search ${searchId}, lead ${leadId ?? "none"}`
  );

  // Check if search still needs completion
  const searchStatus = await ctx.runQuery(
    internal.leads.internal.getSearchEnrichmentStatus,
    { searchId }
  );

  if (!searchStatus) {
    console.log(`[DLQ Processor] Search ${searchId} not found, marking resolved`);
    return true; // Mark as resolved - search no longer exists
  }

  // If search is already completed or in analysis, no action needed
  if (
    searchStatus.status === "completed" ||
    searchStatus.status === "analyzing"
  ) {
    console.log(
      `[DLQ Processor] Search ${searchId} already in ${searchStatus.status}, marking resolved`
    );
    return true;
  }

  // Check if all leads are enriched
  if (searchStatus.allLeadsEnriched) {
    console.log(
      `[DLQ Processor] All leads enriched for search ${searchId}, triggering analysis`
    );

    // Clear any existing checkpoint
    await ctx.runMutation(
      internal.leads.enrichment.checkpoint.clearCheckpoint,
      { searchId }
    );

    // Try to trigger analysis phase
    const shouldTriggerAnalysis = await ctx.runMutation(
      internal.leads.internal.tryTriggerAnalysisPhase,
      { searchId }
    );

    if (shouldTriggerAnalysis) {
      // Schedule the analysis phase
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["leads/actions"].analyzeLeads,
        { searchId }
      );
      console.log(`[DLQ Processor] Analysis phase scheduled for search ${searchId}`);
    }

    return true;
  }

  // Not all leads enriched yet - this might be a timing issue
  console.log(
    `[DLQ Processor] Search ${searchId} still has pending enrichments (${searchStatus.enrichedCount}/${searchStatus.totalLeads})`
  );

  // If the search has been stuck for a while, check for orphaned leads
  if (context?.batchId) {
    const batch = await ctx.runQuery(internal.leads.workpool.getBatchStatus, {
      batchId: context.batchId,
    });

    if (batch && batch.status === "completed") {
      // Batch is complete but search isn't - force trigger analysis
      console.log(
        `[DLQ Processor] Batch ${context.batchId} completed but search isn't, forcing analysis`
      );

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
      }
      return true;
    }
  }

  return false; // Retry later
}

/**
 * Handle analysis_trigger operation retry
 *
 * Re-schedules the analyzeLeads action when it failed to start.
 */
async function handleAnalysisTrigger(
  ctx: any,
  op: {
    _id: Id<"failedOperations">;
    searchId: Id<"searches">;
  }
): Promise<boolean> {
  const { searchId } = op;

  console.log(`[DLQ Processor] Handling analysis_trigger for search ${searchId}`);

  // Check current search status
  const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
    searchId,
  });

  if (!search) {
    console.log(`[DLQ Processor] Search ${searchId} not found, marking resolved`);
    return true;
  }

  // If already analyzing or completed, no action needed
  if (search.status === "analyzing" || search.status === "completed") {
    console.log(
      `[DLQ Processor] Search ${searchId} already in ${search.status}, marking resolved`
    );
    return true;
  }

  // Schedule the analysis
  await ctx.scheduler.runAfter(
    0,
    (internal as any)["leads/actions"].analyzeLeads,
    { searchId }
  );

  console.log(`[DLQ Processor] Analysis phase re-scheduled for search ${searchId}`);
  return true;
}

/**
 * Handle batch_finalization operation retry
 *
 * Re-attempts batch finalization when the workpool batch completion failed.
 */
async function handleBatchFinalization(
  ctx: any,
  op: {
    _id: Id<"failedOperations">;
    searchId: Id<"searches">;
    context?: any;
  }
): Promise<boolean> {
  const { searchId, context } = op;
  const batchId = context?.batchId;

  console.log(
    `[DLQ Processor] Handling batch_finalization for search ${searchId}, batch ${batchId ?? "unknown"}`
  );

  if (!batchId) {
    console.error(`[DLQ Processor] No batchId in context for batch_finalization`);
    return false;
  }

  // Check batch status
  const batch = await ctx.runQuery(internal.leads.workpool.getBatchStatus, {
    batchId,
  });

  if (!batch) {
    console.log(`[DLQ Processor] Batch ${batchId} not found, marking resolved`);
    return true;
  }

  // If batch is already finalized, we're done
  if (batch.status === "completed" || batch.status === "failed") {
    console.log(
      `[DLQ Processor] Batch ${batchId} already in ${batch.status}, checking search completion`
    );

    // Make sure search is properly transitioned
    const searchStatus = await ctx.runQuery(
      internal.leads.internal.getSearchEnrichmentStatus,
      { searchId }
    );

    if (searchStatus?.allLeadsEnriched) {
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
      }
    }

    return true;
  }

  // Batch still running - retry later
  console.log(
    `[DLQ Processor] Batch ${batchId} still running (${batch.completedLeads}/${batch.totalLeads})`
  );
  return false;
}

/**
 * Handle slot_release operation retry
 *
 * Re-attempts to release an API key semaphore slot that failed to release.
 * If the slot has already expired (10 min timeout), marks as resolved.
 */
async function handleSlotRelease(
  ctx: any,
  op: {
    _id: Id<"failedOperations">;
    searchId: Id<"searches">;
    leadId?: Id<"leads">;
    context?: any;
  }
): Promise<boolean> {
  const { context } = op;

  console.log(
    `[DLQ Processor] Handling slot_release for search ${op.searchId}, lead ${op.leadId ?? "none"}`
  );

  // Extract slot info from context
  const apiKeyHash = context?.apiKeyHash;
  const claimId = context?.claimId;
  const slotIndex = context?.slotIndex;

  if (!apiKeyHash) {
    console.error(`[DLQ Processor] No apiKeyHash in context for slot_release`);
    // Can't retry without apiKeyHash, but slots auto-expire after 10 min anyway
    return true;
  }

  try {
    // Try to release the slot
    const releaseResult = await ctx.runMutation(
      internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
      { apiKeyHash, claimId, slotIndex }
    );

    if (releaseResult.released) {
      console.log(
        `[DLQ Processor] Successfully released slot ${releaseResult.releasedSlotIndex} for API key ${apiKeyHash.substring(0, 8)}...`
      );
      return true;
    }

    // Slot not found - likely already released or expired
    // Check if the slot is still claimed by this claimId
    if (claimId) {
      const slotStatus = await ctx.runQuery(
        internal.apiKeySemaphore.semaphore.getApiKeySlotStatus,
        { apiKeyHash }
      );

      // Check if any slot is still claimed by this claimId
      const stillClaimed = slotStatus.slots?.some(
        (s: any) => s.claimedBy === claimId?.substring(0, 16)
      );

      if (!stillClaimed) {
        console.log(
          `[DLQ Processor] Slot already released or expired for claimId ${claimId.substring(0, 16)}...`
        );
        return true;
      }
    }

    // Slot still exists but couldn't be released - retry later
    console.log(
      `[DLQ Processor] Slot release failed, will retry later`
    );
    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[DLQ Processor] Error releasing slot: ${errorMessage}`
    );
    return false;
  }
}

/**
 * Get DLQ statistics for monitoring
 */
export const getDLQStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.runQuery(
      internal.leads.deadLetterQueue.getOperationStats,
      {}
    );

    // Get exhausted operations for alerting
    const exhausted = await ctx.runQuery(
      internal.leads.deadLetterQueue.getExhaustedOperations,
      { limit: 10 }
    );

    if (exhausted.length > 0) {
      console.warn(
        `[DLQ Monitor] ${exhausted.length} exhausted operations require manual intervention`
      );

      // Log details for debugging
      for (const op of exhausted) {
        console.warn(
          `[DLQ Monitor] Exhausted: ${op.operationType} for search ${op.searchId}, ` +
          `error: ${op.error?.slice(0, 100)}`
        );
      }
    }

    return {
      ...stats,
      exhaustedDetails: exhausted.map((op) => ({
        id: op._id,
        type: op.operationType,
        searchId: op.searchId,
        error: op.error,
        retryCount: op.retryCount,
      })),
    };
  },
});
