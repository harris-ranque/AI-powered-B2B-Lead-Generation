import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Retry tracking for failed operations
export const createRetryRecord = internalMutation({
  args: {
    operationType: v.union(
      v.literal("google_maps_search"),
      v.literal("findymail_enrichment"), 
      v.literal("langgraph_analysis"),
      v.literal("langgraph_email_generation"),
      v.literal("webhook_call"),
      v.literal("search_orchestration")
    ),
    relatedId: v.string(), // searchId, leadId, requestId, etc.
    error: v.string(),
    retryConfig: v.object({
      maxAttempts: v.number(),
      currentAttempt: v.number(),
      nextRetryAt: v.number(),
      strategy: v.union(
        v.literal("exponential"),
        v.literal("linear"),
        v.literal("fixed")
      ),
      backoffMs: v.number(),
    }),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const retryId = await ctx.db.insert("retryRecords", {
      operationType: args.operationType,
      relatedId: args.relatedId,
      error: args.error,
      retryConfig: args.retryConfig,
      metadata: args.metadata,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return retryId;
  },
});

// Get pending retries ready for execution
export const getPendingRetries = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    const now = Date.now();

    return await ctx.db
      .query("retryRecords")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.lt(q.field("retryConfig.nextRetryAt"), now))
      .order("asc")
      .take(limit);
  },
});

// Process pending retries
export const processPendingRetries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pendingRetries = await ctx.runQuery(internal.retries.internal.getPendingRetries, {
      limit: 5, // Process 5 at a time to avoid overwhelming
    });

    let processed = 0;

    for (const retry of pendingRetries) {
      try {
        const { operationType, relatedId, retryConfig } = retry;

        // Update current attempt
        await ctx.db.patch(retry._id, {
          "retryConfig.currentAttempt": retryConfig.currentAttempt + 1,
          status: "executing",
          updatedAt: Date.now(),
        });

        // Trigger the appropriate retry action based on operation type
        switch (operationType) {
          case "google_maps_search":
            await ctx.scheduler.runAfter(0, internal.search.orchestrator.rescueStuckSearch, {
              searchId: relatedId as any,
            });
            break;

          case "findymail_enrichment":
            await ctx.scheduler.runAfter(0, internal.leads.enrichment.enrichLead, {
              leadId: relatedId as any,
            });
            break;

          case "langgraph_analysis":
            await ctx.scheduler.runAfter(0, internal.langgraph.actions.analyzeLead, {
              leadId: relatedId as any,
            });
            break;

          case "search_orchestration":
            await ctx.scheduler.runAfter(0, internal.search.orchestrator.orchestrateSearchPipeline, {
              searchId: relatedId as any,
            });
            break;

          default:
            console.log(`Unknown retry operation type: ${operationType}`);
            await ctx.db.patch(retry._id, {
              status: "failed",
              error: `Unknown operation type: ${operationType}`,
              completedAt: Date.now(),
            });
            continue;
        }

        // Mark as completed for now - actual success/failure will be determined by the operation
        await ctx.db.patch(retry._id, {
          status: "completed",
          completedAt: Date.now(),
          updatedAt: Date.now(),
        });

        processed++;
        console.log(`Processed retry for ${operationType}: ${relatedId}`);

      } catch (error) {
        console.error(`Error processing retry ${retry._id}:`, error);

        // Check if we should schedule another retry
        if (retry.retryConfig.currentAttempt + 1 >= retry.retryConfig.maxAttempts) {
          // Max attempts reached, mark as failed
          await ctx.db.patch(retry._id, {
            status: "failed",
            error: `Max attempts reached: ${error instanceof Error ? error.message : "Unknown error"}`,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
        } else {
          // Schedule next retry
          const nextRetryDelay = calculateNextRetryDelay(
            retry.retryConfig.currentAttempt + 1,
            retry.retryConfig.strategy,
            retry.retryConfig.backoffMs
          );

          await ctx.db.patch(retry._id, {
            status: "pending",
            "retryConfig.nextRetryAt": Date.now() + nextRetryDelay,
            error: error instanceof Error ? error.message : "Retry scheduling error",
            updatedAt: Date.now(),
          });

          console.log(`Scheduled next retry for ${retry._id} in ${nextRetryDelay}ms`);
        }
      }
    }

    return { processed };
  },
});

// Update retry record status (called by successful operations)
export const updateRetryStatus = internalMutation({
  args: {
    operationType: v.string(),
    relatedId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find active retry records for this operation
    const retryRecords = await ctx.db
      .query("retryRecords")
      .withIndex("by_related_id", (q) => q.eq("relatedId", args.relatedId))
      .filter((q) => 
        q.and(
          q.eq(q.field("operationType"), args.operationType),
          q.neq(q.field("status"), "completed")
        )
      )
      .collect();

    for (const record of retryRecords) {
      await ctx.db.patch(record._id, {
        status: args.status,
        error: args.error,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { updated: retryRecords.length };
  },
});

// Helper function to calculate next retry delay
function calculateNextRetryDelay(
  attempt: number,
  strategy: "exponential" | "linear" | "fixed",
  baseDelay: number
): number {
  switch (strategy) {
    case "exponential":
      return baseDelay * Math.pow(2, attempt - 1);
    case "linear":
      return baseDelay * attempt;
    case "fixed":
      return baseDelay;
    default:
      return baseDelay;
  }
}

// Cleanup old retry records (called by cron)
export const cleanupOldRetries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const oldRetries = await ctx.db
      .query("retryRecords")
      .filter((q) => q.lt(q.field("createdAt"), oneWeekAgo))
      .collect();

    for (const retry of oldRetries) {
      await ctx.db.delete(retry._id);
    }

    console.log(`Cleaned up ${oldRetries.length} old retry records`);
    return { deleted: oldRetries.length };
  },
});