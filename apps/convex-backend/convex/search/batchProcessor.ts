import { internalMutation, internalAction, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { STATUS, CREDIT_COSTS } from "../lib/constants";
import { retryApiCall, withRetryTracking } from "../lib/helpers";

/**
 * Batch Processing System for Large Searches
 * 
 * Features:
 * - Intelligent batch sizing based on system load and user plan
 * - Progressive processing with real-time status updates
 * - Automatic retry and error handling for failed batches
 * - Resource-aware scheduling to prevent system overload
 * - Priority queuing for premium users
 */

// Batch configuration by user plan
export const BATCH_CONFIG = {
  free: {
    maxBatchSize: 5,
    maxConcurrentBatches: 2,
    priorityWeight: 1,
    processingDelay: 2000, // 2 seconds between batches
  },
  pro: {
    maxBatchSize: 15,
    maxConcurrentBatches: 4,
    priorityWeight: 2,
    processingDelay: 1000, // 1 second between batches
  },
  enterprise: {
    maxBatchSize: 25,
    maxConcurrentBatches: 6,
    priorityWeight: 3,
    processingDelay: 500, // 0.5 seconds between batches
  },
} as const;

// System load thresholds for dynamic batch sizing
export const SYSTEM_LOAD_THRESHOLDS = {
  low: 0.3,    // < 30% system usage
  medium: 0.7, // 30-70% system usage
  high: 0.9,   // 70-90% system usage
  critical: 1.0, // > 90% system usage
} as const;

// Create batch processing plan for large search
export const createBatchPlan = internalMutation({
  args: {
    searchId: v.id("searches"),
    totalItems: v.number(),
    estimatedProcessingTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const user = await ctx.db.get(search.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get system load for dynamic batch sizing
    const systemLoad = await ctx.runQuery(internal.search.batchProcessor.getSystemLoad);
    const config = BATCH_CONFIG[user.plan];
    
    // Adjust batch size based on system load
    let adjustedBatchSize = config.maxBatchSize;
    if (systemLoad > SYSTEM_LOAD_THRESHOLDS.high) {
      adjustedBatchSize = Math.floor(config.maxBatchSize * 0.5);
    } else if (systemLoad > SYSTEM_LOAD_THRESHOLDS.medium) {
      adjustedBatchSize = Math.floor(config.maxBatchSize * 0.75);
    }

    // Calculate optimal batch configuration
    const batchSize = Math.min(adjustedBatchSize, Math.max(1, Math.floor(args.totalItems / 10)));
    const totalBatches = Math.ceil(args.totalItems / batchSize);
    const estimatedTimePerBatch = (args.estimatedProcessingTime || 30000) / totalBatches;
    
    // Calculate priority score
    const priorityScore = calculatePriorityScore(user.plan, search.createdAt, args.totalItems);

    const batchPlan: any = {
      searchId: args.searchId,
      userId: search.userId,
      totalItems: args.totalItems,
      batchSize,
      totalBatches,
      estimatedTimePerBatch,
      priorityScore,
      systemLoad,
      status: "pending" as const,
      createdBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      processingDelay: config.processingDelay,
      maxConcurrentBatches: config.maxConcurrentBatches,
      createdAt: Date.now(),
    };

    // Insert batch plan
    const batchPlanId = await ctx.db.insert("batchPlans", batchPlan);

    // Create individual batch records
    const batches = [];
    for (let i = 0; i < totalBatches; i++) {
      const startIndex = i * batchSize;
      const endIndex = Math.min(startIndex + batchSize - 1, args.totalItems - 1);
      
      const batch: any = {
        batchPlanId,
        searchId: args.searchId,
        userId: search.userId,
        batchNumber: i + 1,
        startIndex,
        endIndex,
        itemCount: endIndex - startIndex + 1,
        status: "pending" as const,
        priorityScore,
        estimatedProcessingTime: estimatedTimePerBatch,
        attempts: 0,
        maxAttempts: 3,
        createdAt: Date.now(),
      };

      const batchId = await ctx.db.insert("searchBatches", batch);
      batches.push({ batchId, ...batch });
    }

    console.log(`Created batch plan for search ${args.searchId}: ${totalBatches} batches of ${batchSize} items each`);

    return {
      batchPlanId,
      totalBatches,
      batchSize,
      priorityScore,
      estimatedTotalTime: estimatedTimePerBatch * totalBatches,
      batches: batches.slice(0, 5), // Return first 5 batches for reference
    };
  },
});

// Process next available batch
export const processNextBatch = internalAction({
  args: {
    batchPlanId: v.optional(v.id("batchPlans")),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxBatches = args.maxBatches || 1;
    
    // Get highest priority pending batches
    const availableBatches = await ctx.runQuery(internal.search.batchProcessor.getPendingBatches, {
      batchPlanId: args.batchPlanId,
      limit: maxBatches * 2, // Get more than needed for priority sorting
    });

    if (availableBatches.length === 0) {
      return { processed: 0, message: "No pending batches" };
    }

    // Sort by priority and take only what we can process
    const batchesToProcess = availableBatches
      .sort((a: any, b: any) => (b.priorityScore || 0) - (a.priorityScore || 0))
      .slice(0, maxBatches);

    let processed = 0;
    const results = [];

    for (const batch of batchesToProcess) {
      try {
        // Check if we can start this batch (respect concurrency limits)
        const canStart = await ctx.runMutation(internal.search.batchProcessor.checkBatchConcurrency, {
          batchPlanId: batch.batchPlanId,
          userId: batch.userId,
        });

        if (!canStart) {
          console.log(`Skipping batch ${batch.batchNumber} due to concurrency limits`);
          continue;
        }

        // Mark batch as in progress
        await ctx.runMutation(internal.search.batchProcessor.updateBatchStatus, {
          batchId: batch._id,
          status: "processing",
          startedAt: Date.now(),
        });

        // Process the batch based on its type
        const result = await processBatchByType(ctx, batch);

        // Mark batch as completed
        await ctx.runMutation(internal.search.batchProcessor.updateBatchStatus, {
          batchId: batch._id,
          status: "completed",
          completedAt: Date.now(),
          result,
        });

        processed++;
        results.push({
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          itemsProcessed: batch.itemCount,
          success: true,
          result,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        
        // Update batch with error and attempt count
        await ctx.runMutation(internal.search.batchProcessor.handleBatchError, {
          batchId: batch._id,
          error: errorMessage,
        });

        results.push({
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          itemsProcessed: 0,
          success: false,
          error: errorMessage,
        });

        console.error(`Batch ${batch.batchNumber} failed:`, errorMessage);
      }
    }

    return {
      processed,
      results,
      remainingBatches: availableBatches.length - processed,
    };
  },
});

// Process batch based on search type
async function processBatchByType(ctx: any, batch: any) {
  const search = await ctx.runQuery(internal.search.internal.getSearchById, {
    searchId: batch.searchId,
  });

  if (!search) {
    throw new Error("Search not found");
  }

  // Determine what type of processing this batch needs
  switch (search.status) {
    case STATUS.SEARCH.PENDING:
    case STATUS.SEARCH.IN_PROGRESS:
      // Google Maps discovery batch
      return await processDiscoveryBatch(ctx, batch, search);
      
    case "enrichment_phase":
      // Email enrichment batch
      return await processEnrichmentBatch(ctx, batch, search);
      
    case "analysis_phase":
      // AI analysis batch
      return await processAnalysisBatch(ctx, batch, search);
      
    default:
      throw new Error(`Unknown search status for batch processing: ${search.status}`);
  }
}

// Process Google Maps discovery batch
async function processDiscoveryBatch(ctx: any, batch: any, search: any) {
  console.log(`Processing discovery batch ${batch.batchNumber} for search ${search._id}`);

  // Use withRetryTracking for automatic retry management
  return await withRetryTracking(
    ctx,
    "google_maps_search",
    `${search._id}_batch_${batch.batchNumber}`,
    async () => {
      // Call Google Maps API for this batch
      const result = await ctx.runAction(internal.search.actions.searchGoogleMapsBatch, {
        searchId: batch.searchId,
        batchConfig: {
          startIndex: batch.startIndex,
          endIndex: batch.endIndex,
          batchNumber: batch.batchNumber,
        },
        parameters: search.parameters,
      });

      return result;
    }
  );
}

// Process email enrichment batch
async function processEnrichmentBatch(ctx: any, batch: any, search: any) {
  console.log(`Processing enrichment batch ${batch.batchNumber} for search ${search._id}`);

  return await withRetryTracking(
    ctx,
    "findymail_enrichment",
    `${search._id}_batch_${batch.batchNumber}`,
    async () => {
      // Process leads in this batch through FindyMail
      const result = await ctx.runAction(internal.leads.enrichment.enrichLeadsBatch, {
        searchId: batch.searchId,
        batchConfig: {
          startIndex: batch.startIndex,
          endIndex: batch.endIndex,
          batchNumber: batch.batchNumber,
        },
      });

      return result;
    }
  );
}

// Process AI analysis batch
async function processAnalysisBatch(ctx: any, batch: any, search: any) {
  console.log(`Processing analysis batch ${batch.batchNumber} for search ${search._id}`);

  return await withRetryTracking(
    ctx,
    "langgraph_analysis",
    `${search._id}_batch_${batch.batchNumber}`,
    async () => {
      // Process leads through LangGraph analysis
      const result = await ctx.runAction(internal.langgraph.actions.analyzeLeadsBatch, {
        searchId: batch.searchId,
        batchConfig: {
          startIndex: batch.startIndex,
          endIndex: batch.endIndex,
          batchNumber: batch.batchNumber,
        },
      });

      return result;
    }
  );
}

// Get system load for dynamic batch sizing
export const getSystemLoad = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const last5Minutes = now - (5 * 60 * 1000);

    // Get recent activity indicators
    const [recentSearches, activeBatches, recentErrors] = await Promise.all([
      // Recent searches created
      ctx.db
        .query("searches")
        .withIndex("by_created", (q) => q.gte("createdAt", last5Minutes))
        .collect(),
      
      // Currently processing batches
      ctx.db
        .query("searchBatches")
        .withIndex("by_status", (q) => q.eq("status", "processing"))
        .collect(),
      
      // Recent retry records (indicates system stress)
      ctx.db
        .query("retryRecords")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .filter((q) => q.gte(q.field("createdAt"), last5Minutes))
        .collect(),
    ]);

    // Calculate system load based on activity
    const searchLoad = Math.min(recentSearches.length / 20, 1.0); // 20+ searches = 100% load
    const batchLoad = Math.min(activeBatches.length / 50, 1.0); // 50+ batches = 100% load
    const errorLoad = Math.min(recentErrors.length / 10, 1.0); // 10+ errors = 100% load

    // Weighted system load calculation
    const systemLoad = (searchLoad * 0.4) + (batchLoad * 0.4) + (errorLoad * 0.2);

    return Math.min(systemLoad, 1.0);
  },
});

// Get pending batches for processing
export const getPendingBatches = internalQuery({
  args: {
    batchPlanId: v.optional(v.id("batchPlans")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    let batches;
    
    if (args.batchPlanId) {
      batches = await ctx.db
        .query("searchBatches")
        .withIndex("by_batch_plan", (q: any) => q.eq("batchPlanId", args.batchPlanId!))
        .filter((q: any) => q.eq(q.field("status"), "pending"))
        .order("desc")
        .take(limit);
    } else {
      batches = await ctx.db
        .query("searchBatches")
        .withIndex("by_status", (q: any) => q.eq("status", "pending"))
        .order("desc")
        .take(limit);
    }

    return batches;
  },
});

// Check batch concurrency limits
export const checkBatchConcurrency = internalMutation({
  args: {
    batchPlanId: v.id("batchPlans"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return false;
    }

    const config = BATCH_CONFIG[user.plan];
    
    // Count currently processing batches for this plan
    const activeBatches = await ctx.db
      .query("searchBatches")
      .withIndex("by_batch_plan", (q: any) => q.eq("batchPlanId", args.batchPlanId))
      .filter((q: any) => q.eq(q.field("status"), "processing"))
      .collect();

    return activeBatches.length < config.maxConcurrentBatches;
  },
});

// Update batch status
export const updateBatchStatus = internalMutation({
  args: {
    batchId: v.id("searchBatches"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("retrying")
    ),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      status: args.status,
    };

    if (args.startedAt !== undefined) updateData.startedAt = args.startedAt;
    if (args.completedAt !== undefined) updateData.completedAt = args.completedAt;
    if (args.result !== undefined) updateData.result = args.result;
    if (args.error !== undefined) updateData.error = args.error;

    await ctx.db.patch(args.batchId, updateData);

    // Update batch plan progress
    await updateBatchPlanProgress(ctx, args.batchId);

    return { success: true };
  },
});

// Handle batch error and retry logic
export const handleBatchError = internalMutation({
  args: {
    batchId: v.id("searchBatches"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) {
      throw new Error("Batch not found");
    }

    const attempts = batch.attempts + 1;
    const shouldRetry = attempts < batch.maxAttempts;

    if (shouldRetry) {
      // Schedule retry with exponential backoff
      const retryDelay = Math.min(1000 * Math.pow(2, attempts - 1), 60000); // Max 1 minute
      
      await ctx.db.patch(args.batchId, {
        status: "retrying",
        attempts,
        error: args.error,
        scheduledAt: Date.now() + retryDelay,
      });

      console.log(`Batch ${batch.batchNumber} will retry in ${retryDelay}ms (attempt ${attempts}/${batch.maxAttempts})`);
    } else {
      // Mark as permanently failed
      await ctx.db.patch(args.batchId, {
        status: "failed",
        attempts,
        error: args.error,
        completedAt: Date.now(),
      });

      console.error(`Batch ${batch.batchNumber} permanently failed after ${attempts} attempts: ${args.error}`);
    }

    // Update batch plan progress
    await updateBatchPlanProgress(ctx, args.batchId);

    return { shouldRetry, attempts };
  },
});

// Update batch plan progress
async function updateBatchPlanProgress(ctx: any, batchId: string) {
  const batch = await ctx.db.get(batchId);
  if (!batch) return;

  const allBatches = await ctx.db
    .query("searchBatches")
    .withIndex("by_batch_plan", (q: any) => q.eq("batchPlanId", batch.batchPlanId))
    .collect();

  const completedBatches = allBatches.filter((b: any) => b.status === "completed").length;
  const failedBatches = allBatches.filter((b: any) => b.status === "failed").length;
  const totalBatches = allBatches.length;

  const batchPlan = await ctx.db.get(batch.batchPlanId);
  if (!batchPlan) return;

  const updateData: any = {
    completedBatches,
    failedBatches,
  };

  if (completedBatches + failedBatches === totalBatches) {
    // All batches completed
    updateData.status = "completed";
    updateData.completedAt = Date.now();
  } else if (batchPlan.status === "pending") {
    // First batch started
    updateData.status = "processing";
    updateData.startedAt = Date.now();
  }

  await ctx.db.patch(batch.batchPlanId, updateData);
}

// Calculate priority score for batches
function calculatePriorityScore(plan: string, createdAt: number, totalItems: number): number {
  const planWeights = { free: 1, pro: 2, enterprise: 3 };
  const planWeight = planWeights[plan as keyof typeof planWeights] || 1;
  
  // Age factor (older searches get slightly higher priority)
  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);
  const ageFactor = Math.min(ageHours * 0.1, 2.0); // Max 2x boost for age
  
  // Size factor (larger searches get slightly higher priority for efficiency)
  const sizeFactor = Math.min(totalItems / 100, 1.5); // Max 1.5x boost for size
  
  return planWeight + ageFactor + sizeFactor;
}

// Get batch processing analytics
export const getBatchAnalytics = internalQuery({
  args: {
    timeRange: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const timeRange = args.timeRange || {
      start: now - (24 * 60 * 60 * 1000), // Last 24 hours
      end: now,
    };

    // Get data with proper query construction
    let batchPromise;
    let planPromise;

    if (args.searchId) {
      batchPromise = ctx.db
        .query("searchBatches")
        .withIndex("by_search", (q: any) => q.eq("searchId", args.searchId!))
        .filter((q: any) => 
          q.and(
            q.gte(q.field("createdAt"), timeRange.start),
            q.lte(q.field("createdAt"), timeRange.end)
          )
        )
        .collect();
        
      planPromise = ctx.db
        .query("batchPlans")
        .withIndex("by_search", (q: any) => q.eq("searchId", args.searchId!))
        .filter((q: any) => 
          q.and(
            q.gte(q.field("createdAt"), timeRange.start),
            q.lte(q.field("createdAt"), timeRange.end)
          )
        )
        .collect();
    } else {
      batchPromise = ctx.db
        .query("searchBatches")
        .filter((q: any) => 
          q.and(
            q.gte(q.field("createdAt"), timeRange.start),
            q.lte(q.field("createdAt"), timeRange.end)
          )
        )
        .collect();
        
      planPromise = ctx.db
        .query("batchPlans")
        .filter((q: any) => 
          q.and(
            q.gte(q.field("createdAt"), timeRange.start),
            q.lte(q.field("createdAt"), timeRange.end)
          )
        )
        .collect();
    }

    const [batches, plans] = await Promise.all([batchPromise, planPromise]);

    // Calculate analytics
    const analytics = {
      totalBatches: batches.length,
      totalPlans: plans.length,
      batchStats: {
        pending: batches.filter(b => b.status === "pending").length,
        processing: batches.filter(b => b.status === "processing").length,
        completed: batches.filter(b => b.status === "completed").length,
        failed: batches.filter(b => b.status === "failed").length,
        retrying: batches.filter(b => b.status === "retrying").length,
      },
      planStats: {
        pending: plans.filter(p => p.status === "pending").length,
        processing: plans.filter(p => p.status === "processing").length,
        completed: plans.filter(p => p.status === "completed").length,
      },
      performance: {
        avgBatchSize: batches.length > 0 ? batches.reduce((sum, b) => sum + b.itemCount, 0) / batches.length : 0,
        avgProcessingTime: 0,
        successRate: 0,
        retryRate: 0,
      },
      timeRange,
    };

    // Calculate performance metrics
    const completedBatches = batches.filter(b => b.status === "completed" && b.startedAt && b.completedAt);
    if (completedBatches.length > 0) {
      analytics.performance.avgProcessingTime = completedBatches.reduce(
        (sum, b) => sum + (b.completedAt! - b.startedAt!), 0
      ) / completedBatches.length;

      analytics.performance.successRate = completedBatches.length / batches.length;
    }

    const retriedBatches = batches.filter(b => b.attempts > 1);
    analytics.performance.retryRate = retriedBatches.length / batches.length;

    return analytics;
  },
});