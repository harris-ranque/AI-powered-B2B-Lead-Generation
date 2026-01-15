/**
 * Dead Letter Queue Operations
 *
 * Tracks failed pipeline operations (completion handlers, phase transitions)
 * for automatic retry with exponential backoff.
 *
 * Operations in DLQ are retried every 2 minutes by the processor cron job.
 * After maxRetries (default 5), operations are marked as "exhausted".
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// Exponential backoff configuration
const BASE_DELAY_MS = 30000; // 30 seconds
const MAX_DELAY_MS = 480000; // 8 minutes

/**
 * Record a failed operation for later retry
 */
export const recordFailedOperation = internalMutation({
  args: {
    operationType: v.union(
      v.literal("enrichment_completion"),
      v.literal("analysis_trigger"),
      v.literal("batch_finalization"),
      v.literal("slot_release")
    ),
    searchId: v.id("searches"),
    leadId: v.optional(v.id("leads")),
    error: v.string(),
    errorCode: v.optional(v.string()),
    context: v.optional(v.any()),
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const maxRetries = args.maxRetries ?? 5;

    // Check if we already have a pending/retrying operation for this search+lead
    const existing = await ctx.db
      .query("failedOperations")
      .withIndex("by_search", (q) =>
        q.eq("searchId", args.searchId).eq("status", "pending")
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("operationType"), args.operationType),
          args.leadId
            ? q.eq(q.field("leadId"), args.leadId)
            : q.eq(q.field("leadId"), undefined)
        )
      )
      .first();

    if (existing) {
      console.log(
        `[DLQ] Operation already in queue: ${args.operationType} for search ${args.searchId}`
      );
      return existing._id;
    }

    const operationId = await ctx.db.insert("failedOperations", {
      operationType: args.operationType,
      searchId: args.searchId,
      leadId: args.leadId,
      error: args.error,
      errorCode: args.errorCode,
      context: args.context,
      retryCount: 0,
      maxRetries,
      lastAttemptAt: now,
      nextRetryAt: now + BASE_DELAY_MS, // First retry in 30s
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    console.log(
      `[DLQ] Recorded failed operation: ${args.operationType} for search ${args.searchId}, ` +
        `leadId=${args.leadId ?? "none"}, error: ${args.error.slice(0, 100)}`
    );

    return operationId;
  },
});

/**
 * Get pending operations ready for retry
 */
export const getPendingRetries = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = args.limit ?? 50;

    // Get all pending operations where nextRetryAt has passed
    const pendingOps = await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    // Filter to only those ready for retry
    const readyForRetry = pendingOps.filter(
      (op) => op.nextRetryAt && op.nextRetryAt <= now
    );

    // Sort by nextRetryAt (oldest first) and take limit
    readyForRetry.sort((a, b) => (a.nextRetryAt ?? 0) - (b.nextRetryAt ?? 0));

    return readyForRetry.slice(0, limit);
  },
});

/**
 * Mark operation as being retried
 */
export const markRetrying = internalMutation({
  args: {
    operationId: v.id("failedOperations"),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation) {
      console.error(`[DLQ] Operation ${args.operationId} not found`);
      return;
    }

    await ctx.db.patch(args.operationId, {
      status: "retrying",
      updatedAt: Date.now(),
    });

    console.log(
      `[DLQ] Marked operation ${args.operationId} as retrying (attempt ${operation.retryCount + 1}/${operation.maxRetries})`
    );
  },
});

/**
 * Mark operation as resolved
 */
export const markResolved = internalMutation({
  args: {
    operationId: v.id("failedOperations"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const operation = await ctx.db.get(args.operationId);

    if (!operation) {
      console.error(`[DLQ] Operation ${args.operationId} not found`);
      return;
    }

    await ctx.db.patch(args.operationId, {
      status: "resolved",
      resolvedAt: now,
      updatedAt: now,
    });

    console.log(
      `[DLQ] Resolved operation ${args.operationId} (${operation.operationType}) ` +
        `after ${operation.retryCount + 1} attempts`
    );
  },
});

/**
 * Record retry failure and schedule next attempt
 */
export const recordRetryFailure = internalMutation({
  args: {
    operationId: v.id("failedOperations"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation) {
      console.error(`[DLQ] Operation ${args.operationId} not found`);
      return;
    }

    const newRetryCount = operation.retryCount + 1;
    const now = Date.now();

    if (newRetryCount >= operation.maxRetries) {
      // Exhausted all retries
      await ctx.db.patch(args.operationId, {
        status: "exhausted",
        retryCount: newRetryCount,
        lastAttemptAt: now,
        error: args.error,
        updatedAt: now,
      });

      console.error(
        `[DLQ] Operation ${args.operationId} EXHAUSTED after ${newRetryCount} attempts. ` +
          `Type: ${operation.operationType}, Search: ${operation.searchId}, ` +
          `Final error: ${args.error.slice(0, 100)}`
      );
      return;
    }

    // Calculate exponential backoff: 30s, 60s, 120s, 240s, 480s
    const nextDelay = Math.min(
      BASE_DELAY_MS * Math.pow(2, newRetryCount),
      MAX_DELAY_MS
    );

    await ctx.db.patch(args.operationId, {
      status: "pending",
      retryCount: newRetryCount,
      lastAttemptAt: now,
      nextRetryAt: now + nextDelay,
      error: args.error,
      updatedAt: now,
    });

    console.log(
      `[DLQ] Retry ${newRetryCount}/${operation.maxRetries} failed for ${args.operationId}. ` +
        `Next retry in ${nextDelay / 1000}s. Error: ${args.error.slice(0, 100)}`
    );
  },
});

/**
 * Get exhausted operations (for alerting/manual intervention)
 */
export const getExhaustedOperations = internalQuery({
  args: {
    searchId: v.optional(v.id("searches")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    if (args.searchId) {
      const searchId = args.searchId;
      return await ctx.db
        .query("failedOperations")
        .withIndex("by_search", (q) =>
          q.eq("searchId", searchId).eq("status", "exhausted")
        )
        .take(limit);
    }

    return await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "exhausted"))
      .take(limit);
  },
});

/**
 * Get operation counts by status (for monitoring)
 */
export const getOperationStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const retrying = await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "retrying"))
      .collect();

    const exhausted = await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "exhausted"))
      .collect();

    const resolved = await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "resolved"))
      .collect();

    return {
      pending: pending.length,
      retrying: retrying.length,
      exhausted: exhausted.length,
      resolved: resolved.length,
      total: pending.length + retrying.length + exhausted.length + resolved.length,
    };
  },
});

/**
 * Clean up old resolved operations (keep last 7 days)
 */
export const cleanupResolvedOperations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const oldResolved = await ctx.db
      .query("failedOperations")
      .withIndex("by_status", (q) => q.eq("status", "resolved"))
      .filter((q) => q.lt(q.field("resolvedAt"), sevenDaysAgo))
      .collect();

    let deleted = 0;
    for (const op of oldResolved) {
      await ctx.db.delete(op._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[DLQ] Cleaned up ${deleted} old resolved operations`);
    }

    return { deleted };
  },
});
