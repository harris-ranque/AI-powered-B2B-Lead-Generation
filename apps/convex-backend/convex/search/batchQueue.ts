import { internalMutation, internalAction, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Batch Queue Manager
 * 
 * Orchestrates batch processing across the entire system:
 * - Monitors and manages batch queues
 * - Handles priority scheduling
 * - Manages system resources and load balancing
 * - Provides batch retry and failure recovery
 */

// Process priority batch queues (called by high-frequency cron job)
export const processPriorityBatches = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.search.batchQueue.processBatchQueues, {
      maxBatchesToProcess: 5,
      priorityOnly: true,
    });
  },
});

// Process batch queues (called by cron job)
export const processBatchQueues = internalAction({
  args: {
    maxBatchesToProcess: v.optional(v.number()),
    priorityOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const maxBatches = args.maxBatchesToProcess || 10;
    const priorityOnly = args.priorityOnly || false;

    console.log(`Processing batch queues: max ${maxBatches} batches, priority only: ${priorityOnly}`);

    try {
      // Get system status
      const systemLoad = await ctx.runQuery(internal.search.batchProcessor.getSystemLoad);
      
      // Adjust processing based on system load
      let adjustedMaxBatches = maxBatches;
      if (systemLoad > 0.8) {
        adjustedMaxBatches = Math.floor(maxBatches * 0.5);
        console.log(`High system load (${systemLoad}), reducing batch processing to ${adjustedMaxBatches}`);
      } else if (systemLoad > 0.6) {
        adjustedMaxBatches = Math.floor(maxBatches * 0.75);
      }

      if (adjustedMaxBatches === 0) {
        return { processed: 0, message: "System load too high, skipping batch processing" };
      }

      // Get pending batch plans, prioritizing by user plan and age
      const pendingPlans = await ctx.runQuery(internal.search.batchQueue.getPendingBatchPlans, {
        limit: 20,
        priorityOnly,
      });

      if (pendingPlans.length === 0) {
        return { processed: 0, message: "No pending batch plans" };
      }

      let totalProcessed = 0;
      const results = [];

      // Process each batch plan
      for (const plan of pendingPlans) {
        if (totalProcessed >= adjustedMaxBatches) {
          break;
        }

        try {
          // Check if this plan can be processed (resource limits, etc.)
          const canProcess = await ctx.runMutation(internal.search.batchQueue.checkPlanCanProcess, {
            batchPlanId: plan._id,
          });

          if (!canProcess) {
            console.log(`Skipping batch plan ${plan._id} due to resource constraints`);
            continue;
          }

          // Process batches from this plan
          const remainingBatches = adjustedMaxBatches - totalProcessed;
          const result = await ctx.runAction(internal.search.batchProcessor.processNextBatch, {
            batchPlanId: plan._id,
            maxBatches: Math.min(remainingBatches, plan.maxConcurrentBatches),
          });

          totalProcessed += result.processed;
          results.push({
            planId: plan._id,
            searchId: plan.searchId,
            userId: plan.userId,
            processed: result.processed,
            remaining: result.remainingBatches,
          });

          console.log(`Processed ${result.processed} batches from plan ${plan._id}`);

        } catch (error) {
          console.error(`Error processing batch plan ${plan._id}:`, error);
          
          // Mark plan as failed if too many errors
          await ctx.runMutation(internal.search.batchQueue.handlePlanError, {
            batchPlanId: plan._id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Process retry batches
      const retryResult = await processRetryBatches(ctx, adjustedMaxBatches - totalProcessed);
      totalProcessed += retryResult.processed;

      return {
        processed: totalProcessed,
        systemLoad,
        planResults: results,
        retryResults: retryResult,
        processedPlans: results.length,
      };

    } catch (error) {
      console.error("Error in batch queue processing:", error);
      throw error;
    }
  },
});

// Process batches that are scheduled for retry
async function processRetryBatches(ctx: any, maxBatches: number): Promise<any> {
  if (maxBatches <= 0) {
    return { processed: 0, message: "No capacity for retry batches" };
  }

  const now = Date.now();
  
  // Get batches scheduled for retry
  const retryBatches = await ctx.runQuery(internal.search.batchQueue.getRetryBatches, {
    maxTime: now,
    limit: maxBatches,
  });

  if (retryBatches.length === 0) {
    return { processed: 0, message: "No retry batches ready" };
  }

  let processed = 0;
  const results = [];

  for (const batch of retryBatches) {
    try {
      // Reset batch to pending status for retry
      await ctx.runMutation(internal.search.batchProcessor.updateBatchStatus, {
        batchId: batch._id,
        status: "pending",
      });

      // Process the batch
      const result = await ctx.runAction(internal.search.batchProcessor.processNextBatch, {
        maxBatches: 1,
      });

      if (result.processed > 0) {
        processed++;
        results.push({
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          success: true,
        });
      }

    } catch (error) {
      console.error(`Retry failed for batch ${batch.batchNumber}:`, error);
      results.push({
        batchId: batch._id,
        batchNumber: batch.batchNumber,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    processed,
    attempted: retryBatches.length,
    results,
  };
}

// Get pending batch plans ordered by priority
export const getPendingBatchPlans = internalQuery({
  args: {
    limit: v.optional(v.number()),
    priorityOnly: v.optional(v.boolean()),
  },
  handler: async (ctx: any, args: any) => {
    const limit = args.limit || 10;
    
    let plans = await ctx.db
      .query("batchPlans")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(limit * 2); // Get more than needed for priority sorting

    // Filter by priority if requested
    if (args.priorityOnly) {
      plans = plans.filter(plan => plan.priorityScore >= 2.0); // Only pro+ users
    }

    // Sort by priority score (higher is better)
    plans.sort((a, b) => b.priorityScore - a.priorityScore);

    return plans.slice(0, limit);
  },
});

// Get batches ready for retry
export const getRetryBatches = internalQuery({
  args: {
    maxTime: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 5;

    const batches = await ctx.db
      .query("searchBatches")
      .withIndex("by_status", (q) => q.eq("status", "retrying"))
      .filter((q) => 
        q.and(
          q.neq(q.field("scheduledAt"), undefined),
          q.lte(q.field("scheduledAt"), args.maxTime)
        )
      )
      .order("asc") // Process oldest first
      .take(limit);

    return batches;
  },
});

// Check if a batch plan can be processed
export const checkPlanCanProcess = internalMutation({
  args: {
    batchPlanId: v.id("batchPlans"),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.batchPlanId);
    if (!plan) {
      return false;
    }

    // Check if search still exists and is in valid state
    const search = await ctx.db.get(plan.searchId);
    if (!search) {
      // Mark plan as failed if search is gone
      await ctx.db.patch(args.batchPlanId, {
        status: "failed",
        completedAt: Date.now(),
      });
      return false;
    }

    // Check if user is still active
    const user = await ctx.db.get(plan.userId);
    if (!user || !user.isActive) {
      return false;
    }

    // Check current processing batches for this plan
    const activeBatches = await ctx.db
      .query("searchBatches")
      .withIndex("by_batch_plan", (q) => q.eq("batchPlanId", args.batchPlanId))
      .filter((q) => q.eq(q.field("status"), "processing"))
      .collect();

    // Respect concurrency limits
    if (activeBatches.length >= plan.maxConcurrentBatches) {
      return false;
    }

    return true;
  },
});

// Handle batch plan error
export const handlePlanError = internalMutation({
  args: {
    batchPlanId: v.id("batchPlans"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const plan = await ctx.db.get(args.batchPlanId);
    if (!plan) {
      return;
    }

    // Count recent errors for this plan
    const recentErrors = await ctx.db
      .query("systemLogs")
      .withIndex("by_type", (q) => q.eq("type", "batch_plan_error"))
      .filter((q) => 
        q.and(
          q.eq(q.field("data.batchPlanId"), args.batchPlanId),
          q.gte(q.field("timestamp"), Date.now() - (60 * 60 * 1000)) // Last hour
        )
      )
      .collect();

    const errorCount = recentErrors.length;
    const shouldMarkFailed = errorCount >= 3; // 3 errors in an hour = failed

    if (shouldMarkFailed) {
      await ctx.db.patch(args.batchPlanId, {
        status: "failed",
        completedAt: Date.now(),
      });

      console.error(`Batch plan ${args.batchPlanId} marked as failed after ${errorCount} errors`);
    }

    // Log the error
    await ctx.db.insert("systemLogs", {
      type: "batch_plan_error",
      action: shouldMarkFailed ? "plan_marked_failed" : "plan_error_logged",
      userId: plan.userId,
      data: {
        batchPlanId: args.batchPlanId,
        searchId: plan.searchId,
        error: args.error,
        errorCount: errorCount + 1,
        markedFailed: shouldMarkFailed,
      },
      timestamp: Date.now(),
    });

    return { shouldMarkFailed, errorCount: errorCount + 1 };
  },
});

// Cleanup completed batch plans and their batches
export const cleanupCompletedBatches = internalMutation({
  args: {
    olderThanDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const olderThanDays = args.olderThanDays || 7;
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    // Get completed batch plans older than cutoff
    const oldPlans = await ctx.db
      .query("batchPlans")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .filter((q) => 
        q.and(
          q.neq(q.field("completedAt"), undefined),
          q.lt(q.field("completedAt"), cutoffTime)
        )
      )
      .collect();

    let deletedPlans = 0;
    let deletedBatches = 0;

    for (const plan of oldPlans) {
      try {
        // Delete all batches for this plan
        const batches = await ctx.db
          .query("searchBatches")
          .withIndex("by_batch_plan", (q) => q.eq("batchPlanId", plan._id))
          .collect();

        for (const batch of batches) {
          await ctx.db.delete(batch._id);
          deletedBatches++;
        }

        // Delete the plan
        await ctx.db.delete(plan._id);
        deletedPlans++;

      } catch (error) {
        console.error(`Error cleaning up batch plan ${plan._id}:`, error);
      }
    }

    console.log(`Cleaned up ${deletedPlans} batch plans and ${deletedBatches} batches older than ${olderThanDays} days`);

    return {
      deletedPlans,
      deletedBatches,
      cutoffTime,
    };
  },
});

// Get batch queue status and metrics
export const getBatchQueueStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get counts by status
    const [plans, batches, systemLoad] = await Promise.all([
      ctx.db.query("batchPlans").collect(),
      ctx.db.query("searchBatches").collect(),
      ctx.runQuery(internal.search.batchProcessor.getSystemLoad),
    ]);

    // Analyze plans
    const planStats = {
      total: plans.length,
      pending: plans.filter(p => p.status === "pending").length,
      processing: plans.filter(p => p.status === "processing").length,
      completed: plans.filter(p => p.status === "completed").length,
      failed: plans.filter(p => p.status === "failed").length,
    };

    // Analyze batches
    const batchStats = {
      total: batches.length,
      pending: batches.filter(b => b.status === "pending").length,
      processing: batches.filter(b => b.status === "processing").length,
      completed: batches.filter(b => b.status === "completed").length,
      failed: batches.filter(b => b.status === "failed").length,
      retrying: batches.filter(b => b.status === "retrying").length,
    };

    // Get ready-to-retry batches
    const retryBatches = batches.filter(b => 
      b.status === "retrying" && 
      b.scheduledAt && 
      b.scheduledAt <= now
    );

    // Priority queue analysis
    const highPriorityPlans = plans.filter(p => 
      p.status === "pending" && p.priorityScore >= 2.0
    ).length;

    // Performance metrics
    const completedBatches = batches.filter(b => 
      b.status === "completed" && b.startedAt && b.completedAt
    );

    const avgProcessingTime = completedBatches.length > 0
      ? completedBatches.reduce((sum, b) => sum + (b.completedAt! - b.startedAt!), 0) / completedBatches.length
      : 0;

    const successRate = batches.length > 0 
      ? batchStats.completed / batches.length 
      : 0;

    return {
      systemLoad,
      planStats,
      batchStats,
      queueHealth: {
        readyToRetry: retryBatches.length,
        highPriorityPending: highPriorityPlans,
        avgProcessingTimeMs: Math.round(avgProcessingTime),
        successRate: Math.round(successRate * 100) / 100,
      },
      timestamp: now,
    };
  },
});