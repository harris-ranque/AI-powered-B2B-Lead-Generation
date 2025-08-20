import { internalMutation, internalAction, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { STATUS } from "../lib/constants";

/**
 * Batch Processing Integration
 * 
 * Integration layer between search orchestrator and batch processor
 * Determines when to use batch processing vs direct processing
 */

// Enhanced search creation with automatic batch processing
export const createSearchWithBatchProcessing: any = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.internal.getSearchById, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error("Search not found");
    }

    const user = await ctx.runQuery(internal.users.internal.getUserById, {
      userId: search.userId,
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Determine if this search should use batch processing
    const shouldUseBatchProcessing = determineBatchProcessingNeed(search, user);

    if (shouldUseBatchProcessing) {
      console.log(`Creating batch processing plan for search ${args.searchId} (${search.parameters.maxResults} results)`);
      
      // Create batch processing plan
      const batchPlan: any = await ctx.runMutation(internal.search.batchProcessor.createBatchPlan, {
        searchId: args.searchId,
        totalItems: search.parameters.maxResults,
        estimatedProcessingTime: estimateProcessingTime(search, user),
      });

      // Update search status to indicate batch processing
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: "batch_processing" as "pending" | "in_progress" | "completed" | "failed" | "cancelled",
      });

      return {
        useBatchProcessing: true,
        batchPlanId: batchPlan.batchPlanId,
        totalBatches: batchPlan.totalBatches,
        estimatedTime: batchPlan.estimatedTotalTime,
      };

    } else {
      console.log(`Using direct processing for search ${args.searchId} (${search.parameters.maxResults} results)`);
      
      // Use direct processing through existing orchestrator
      await ctx.runAction(internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId: args.searchId,
      });

      return {
        useBatchProcessing: false,
        message: "Using direct processing",
      };
    }
  },
});

// Determine if search should use batch processing
function determineBatchProcessingNeed(search: any, user: any): boolean {
  const { maxResults } = search.parameters;

  // Thresholds by user plan
  const batchThresholds = {
    free: 20,      // Batch processing for 20+ results
    pro: 50,       // Batch processing for 50+ results  
    enterprise: 100, // Batch processing for 100+ results
  };

  const threshold = batchThresholds[user.plan as keyof typeof batchThresholds] || 20;

  // Always use batch processing for large searches
  if (maxResults >= threshold) {
    return true;
  }

  // For medium searches, consider system load
  if (maxResults >= threshold / 2) {
    // This would require system load check - simplified for now
    return true;
  }

  return false;
}

// Estimate processing time for batch planning
function estimateProcessingTime(search: any, user: any): number {
  const baseTimePerResult = 2000; // 2 seconds per result base time
  
  // Adjust based on user plan (premium users get faster processing)
  const planMultipliers = {
    free: 1.5,      // Slower processing
    pro: 1.0,       // Standard processing
    enterprise: 0.7, // Faster processing
  };

  const planMultiplier = planMultipliers[user.plan as keyof typeof planMultipliers] || 1.0;
  
  return search.parameters.maxResults * baseTimePerResult * planMultiplier;
}

// Handle batch completion and trigger next phase
export const handleBatchPhaseCompletion = internalMutation({
  args: {
    batchPlanId: v.id("batchPlans"),
    phase: v.union(
      v.literal("discovery"),
      v.literal("enrichment"),
      v.literal("analysis")
    ),
  },
  handler: async (ctx, args) => {
    const batchPlan = await ctx.db.get(args.batchPlanId);
    if (!batchPlan) {
      throw new Error("Batch plan not found");
    }

    const search = await ctx.db.get(batchPlan.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    console.log(`Batch phase ${args.phase} completed for search ${search._id}`);

    // Determine next phase
    let nextStatus: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
    let shouldCreateNewBatchPlan = false;

    switch (args.phase) {
      case "discovery":
        nextStatus = "in_progress"; // enrichment_phase
        shouldCreateNewBatchPlan = true;
        break;
      case "enrichment":
        nextStatus = "in_progress"; // analysis_phase
        shouldCreateNewBatchPlan = true;
        break;
      case "analysis":
        nextStatus = STATUS.SEARCH.COMPLETED as "completed";
        break;
      default:
        throw new Error(`Unknown phase: ${args.phase}`);
    }

    // Update search status
    await ctx.db.patch(search._id, {
      status: nextStatus,
    });

    if (shouldCreateNewBatchPlan) {
      // Create batch plan for next phase
      const leadCount = await ctx.runQuery(internal.leads.internal.getLeadCount, {
        searchId: search._id,
      });

      if (leadCount > 0) {
        await ctx.runMutation(internal.search.batchProcessor.createBatchPlan, {
          searchId: search._id,
          totalItems: leadCount,
          estimatedProcessingTime: estimateProcessingTime(search, { plan: "pro" }), // Use default
        });
      } else {
        // No leads to process, skip to completion
        await ctx.db.patch(search._id, {
          status: STATUS.SEARCH.COMPLETED,
          completedAt: Date.now(),
        });
      }
    } else {
      // Final phase completed
      await ctx.db.patch(search._id, {
        completedAt: Date.now(),
      });

      // Send completion notification
      await ctx.runMutation(internal.notifications.internal.createSystemNotification, {
        userId: search.userId,
        title: "Search Completed",
        message: `Your search "${search.name}" has been completed with batch processing.`,
        type: "search_completed",
        data: {
          searchId: search._id,
          totalBatches: batchPlan.totalBatches,
          completedBatches: batchPlan.completedBatches,
          processingTime: Date.now() - batchPlan.createdAt,
        },
      });
    }

    return {
      nextStatus,
      shouldCreateNewBatchPlan,
      completed: nextStatus === STATUS.SEARCH.COMPLETED,
    };
  },
});

// Monitor batch processing progress and handle failures
export const monitorBatchProgress = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    // Get current batch plan for this search
    const batchPlan = await ctx.db
      .query("batchPlans")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) => 
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "processing")
        )
      )
      .first();

    if (!batchPlan) {
      console.log(`No active batch plan found for search ${args.searchId}`);
      return { hasActiveBatches: false };
    }

    // Check if batch plan is stalled (no progress for too long)
    const now = Date.now();
    const maxIdleTime = 10 * 60 * 1000; // 10 minutes
    const lastBatchActivity = await getLastBatchActivity(ctx, batchPlan._id);

    if (lastBatchActivity && (now - lastBatchActivity) > maxIdleTime) {
      console.warn(`Batch plan ${batchPlan._id} appears stalled, triggering recovery`);
      
      // Trigger batch recovery
      await recoverStalledBatches(ctx, batchPlan._id);
    }

    // Calculate progress
    const progress = {
      totalBatches: batchPlan.totalBatches,
      completedBatches: batchPlan.completedBatches,
      failedBatches: batchPlan.failedBatches,
      progressPercent: Math.round((batchPlan.completedBatches / batchPlan.totalBatches) * 100),
    };

    // Check if batch plan is complete
    if (batchPlan.completedBatches + batchPlan.failedBatches >= batchPlan.totalBatches) {
      const currentPhase = determineBatchPhase(search.status);
      if (currentPhase) {
        await ctx.runMutation(internal.search.batchIntegration.handleBatchPhaseCompletion, {
          batchPlanId: batchPlan._id,
          phase: currentPhase,
        });
      }
    }

    return {
      hasActiveBatches: true,
      batchPlanId: batchPlan._id,
      status: batchPlan.status,
      progress,
      lastActivity: lastBatchActivity,
    };
  },
});

// Get last batch activity timestamp
async function getLastBatchActivity(ctx: any, batchPlanId: string): Promise<number | null> {
  const recentBatches = await ctx.db
    .query("searchBatches")
    .withIndex("by_batch_plan", (q: any) => q.eq("batchPlanId", batchPlanId))
    .filter((q: any) => 
      q.or(
        q.neq(q.field("startedAt"), undefined),
        q.neq(q.field("completedAt"), undefined)
      )
    )
    .order("desc")
    .take(1);

  if (recentBatches.length === 0) {
    return null;
  }

  const batch = recentBatches[0];
  return batch.completedAt || batch.startedAt || batch.createdAt;
}

// Recover stalled batches
async function recoverStalledBatches(ctx: any, batchPlanId: string): Promise<void> {
  // Reset processing batches that have been stuck
  const stalledBatches = await ctx.db
    .query("searchBatches")
    .withIndex("by_batch_plan", (q: any) => q.eq("batchPlanId", batchPlanId))
    .filter((q: any) => q.eq(q.field("status"), "processing"))
    .collect();

  const now = Date.now();
  const maxProcessingTime = 5 * 60 * 1000; // 5 minutes

  for (const batch of stalledBatches) {
    if (batch.startedAt && (now - batch.startedAt) > maxProcessingTime) {
      // Reset to pending for retry
      await ctx.db.patch(batch._id, {
        status: "pending",
        startedAt: undefined,
        attempts: Math.min(batch.attempts + 1, batch.maxAttempts),
      });

      console.log(`Reset stalled batch ${batch.batchNumber} to pending`);
    }
  }
}

// Determine current batch processing phase
function determineBatchPhase(searchStatus: string): "discovery" | "enrichment" | "analysis" | null {
  switch (searchStatus) {
    case STATUS.SEARCH.PENDING:
    case STATUS.SEARCH.IN_PROGRESS:
    case "batch_processing":
      return "discovery";
    case "enrichment_phase":
      return "enrichment";
    case "analysis_phase":
      return "analysis";
    default:
      return null;
  }
}

// Get batch processing statistics for admin dashboard
export const getBatchProcessingStats = internalQuery({
  args: {
    timeRange: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const timeRange = args.timeRange || {
      start: now - (24 * 60 * 60 * 1000), // Last 24 hours
      end: now,
    };

    // Get batch plans and batches in time range
    const [plans, batches] = await Promise.all([
      ctx.db
        .query("batchPlans")
        .filter((q) => 
          q.and(
            q.gte(q.field("createdAt"), timeRange.start),
            q.lte(q.field("createdAt"), timeRange.end)
          )
        )
        .collect(),

      ctx.db
        .query("searchBatches")
        .filter((q) => 
          q.and(
            q.gte(q.field("createdAt"), timeRange.start),
            q.lte(q.field("createdAt"), timeRange.end)
          )
        )
        .collect(),
    ]);

    // Calculate statistics
    const stats = {
      timeRange,
      totalPlans: plans.length,
      totalBatches: batches.length,
      
      plansByStatus: {
        pending: plans.filter(p => p.status === "pending").length,
        processing: plans.filter(p => p.status === "processing").length,
        completed: plans.filter(p => p.status === "completed").length,
        failed: plans.filter(p => p.status === "failed").length,
      },

      batchesByStatus: {
        pending: batches.filter(b => b.status === "pending").length,
        processing: batches.filter(b => b.status === "processing").length,
        completed: batches.filter(b => b.status === "completed").length,
        failed: batches.filter(b => b.status === "failed").length,
        retrying: batches.filter(b => b.status === "retrying").length,
      },

      performance: {
        avgBatchSize: 0,
        avgProcessingTime: 0,
        successRate: 0,
        retryRate: 0,
        throughput: 0, // batches per hour
      },
    };

    // Calculate performance metrics
    if (batches.length > 0) {
      stats.performance.avgBatchSize = batches.reduce((sum, b) => sum + b.itemCount, 0) / batches.length;
      
      const completedBatches = batches.filter(b => b.status === "completed" && b.startedAt && b.completedAt);
      if (completedBatches.length > 0) {
        stats.performance.avgProcessingTime = completedBatches.reduce(
          (sum, b) => sum + (b.completedAt! - b.startedAt!), 0
        ) / completedBatches.length;
      }

      stats.performance.successRate = stats.batchesByStatus.completed / batches.length;
      stats.performance.retryRate = batches.filter(b => b.attempts > 1).length / batches.length;
      
      const timeRangeHours = (timeRange.end - timeRange.start) / (1000 * 60 * 60);
      stats.performance.throughput = stats.batchesByStatus.completed / timeRangeHours;
    }

    return stats;
  },
});