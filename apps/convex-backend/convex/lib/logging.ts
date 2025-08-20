import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { 
  CorrelationContext, 
  LogContext, 
  createLogEntry,
  formatCorrelationForLogging 
} from "./correlation";

/**
 * Enhanced Logging Service with Correlation ID Support
 * 
 * Provides persistent logging with correlation tracking for better
 * debugging and monitoring across the search pipeline.
 */

// Store log entry in database
export const storeLogEntry = internalMutation({
  args: {
    correlationId: v.string(),
    operationType: v.string(),
    parentId: v.optional(v.string()),
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    leadId: v.optional(v.id("leads")),
    batchId: v.optional(v.string()),
    level: v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error")),
    message: v.string(),
    data: v.optional(v.any()),
    error: v.optional(v.object({
      message: v.string(),
      stack: v.optional(v.string()),
      name: v.optional(v.string()),
    })),
    performance: v.optional(v.object({
      startTime: v.number(),
      endTime: v.optional(v.number()),
      duration: v.optional(v.number()),
    })),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logData: any = {
      correlationId: args.correlationId,
      operationType: args.operationType,
      userId: args.userId,
      level: args.level,
      message: args.message,
      createdAt: Date.now(),
    };

    // Add optional fields only if they exist
    if (args.parentId) logData.parentId = args.parentId;
    if (args.searchId) logData.searchId = args.searchId;
    if (args.leadId) logData.leadId = args.leadId;
    if (args.batchId) logData.batchId = args.batchId;
    if (args.data) logData.data = args.data;
    if (args.error) logData.error = args.error;
    if (args.performance) logData.performance = args.performance;
    if (args.metadata) logData.metadata = args.metadata;

    const logId = await ctx.db.insert("correlationLogs", logData);

    return { logId, stored: true };
  },
});

// Enhanced logging function that stores to database
export async function logWithCorrelationPersistent(
  ctx: any,
  level: LogContext['level'],
  correlation: CorrelationContext,
  message: string,
  data?: any,
  error?: Error,
  performance?: LogContext['performance']
) {
  // First log to console (immediate feedback)
  const correlationInfo = [
    `[${correlation.correlationId}]`,
    `[${correlation.operationType}]`,
    correlation.parentId ? `[parent:${correlation.parentId.substring(0, 8)}]` : '',
    correlation.searchId ? `[search:${correlation.searchId}]` : '',
    correlation.leadId ? `[lead:${correlation.leadId}]` : '',
    correlation.batchId ? `[batch:${correlation.batchId}]` : '',
  ].filter(Boolean).join(' ');
  
  const fullMessage = `${correlationInfo} ${message}`;
  
  // Console logging
  switch (level) {
    case 'debug':
      if (data || error) {
        console.debug(fullMessage, { data, error: error?.message, stack: error?.stack });
      } else {
        console.debug(fullMessage);
      }
      break;
    case 'info':
      if (data) {
        console.info(fullMessage, data);
      } else {
        console.info(fullMessage);
      }
      break;
    case 'warn':
      if (data || error) {
        console.warn(fullMessage, { data, error: error?.message });
      } else {
        console.warn(fullMessage);
      }
      break;
    case 'error':
      if (data || error) {
        console.error(fullMessage, { data, error: error?.message, stack: error?.stack });
      } else {
        console.error(fullMessage);
      }
      break;
  }

  // Store to database for persistence (async, non-blocking)
  try {
    if ("runMutation" in ctx) {
      // From action context - use internal API
      await ctx.runMutation(internal.lib.logging.storeLogEntry, {
        correlationId: correlation.correlationId,
        operationType: correlation.operationType,
        parentId: correlation.parentId,
        userId: correlation.userId,
        searchId: correlation.searchId,
        leadId: correlation.leadId,
        batchId: correlation.batchId,
        level,
        message,
        data,
        error: error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : undefined,
        performance,
        metadata: correlation.metadata,
      });
    } else if ("scheduler" in ctx) {
      // From mutation context - schedule asynchronously to avoid function reference issues
      await ctx.scheduler.runAfter(0, internal.lib.logging.storeLogEntry, {
        correlationId: correlation.correlationId,
        operationType: correlation.operationType,
        parentId: correlation.parentId,
        userId: correlation.userId,
        searchId: correlation.searchId,
        leadId: correlation.leadId,
        batchId: correlation.batchId,
        level,
        message,
        data,
        error: error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : undefined,
        performance,
        metadata: correlation.metadata,
      });
    }
    // If neither, skip database storage (fallback to console only)
  } catch (storageError) {
    // Don't let logging errors break the main operation
    console.warn(`Failed to store log entry: ${storageError}`);
  }
}

// Get correlation logs by correlation ID
export const getCorrelationLogs = internalQuery({
  args: {
    correlationId: v.string(),
    includeChildren: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("correlationLogs")
      .withIndex("by_correlation_id", (q) => q.eq("correlationId", args.correlationId))
      .order("asc")
      .collect();

    if (args.includeChildren) {
      // Also get child operation logs
      const childLogs = await ctx.db
        .query("correlationLogs")
        .withIndex("by_parent_id", (q) => q.eq("parentId", args.correlationId))
        .order("asc")
        .collect();

      return [...logs, ...childLogs].sort((a, b) => a.createdAt - b.createdAt);
    }

    return logs;
  },
});

// Get logs for a search operation
export const getSearchLogs = internalQuery({
  args: {
    searchId: v.id("searches"),
    level: v.optional(v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    
    let query = ctx.db
      .query("correlationLogs")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId));

    if (args.level) {
      query = query.filter((q) => q.eq(q.field("level"), args.level));
    }

    const logs = await query
      .order("desc")
      .take(limit);

    return logs.reverse(); // Return in chronological order
  },
});

// Get logs for a user
export const getUserLogs = internalQuery({
  args: {
    userId: v.id("users"),
    level: v.optional(v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error"))),
    operationType: v.optional(v.string()),
    timeRange: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const now = Date.now();
    const timeRange = args.timeRange || {
      start: now - (24 * 60 * 60 * 1000), // Last 24 hours
      end: now,
    };

    let logs = await ctx.db
      .query("correlationLogs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => 
        q.and(
          q.gte(q.field("createdAt"), timeRange.start),
          q.lte(q.field("createdAt"), timeRange.end)
        )
      )
      .collect();

    // Apply additional filters
    if (args.level) {
      logs = logs.filter(log => log.level === args.level);
    }

    if (args.operationType) {
      logs = logs.filter(log => log.operationType === args.operationType);
    }

    // Sort by creation time (newest first) and limit
    logs.sort((a, b) => b.createdAt - a.createdAt);
    
    return logs.slice(0, limit);
  },
});

// Get operation performance metrics
export const getOperationMetrics = internalQuery({
  args: {
    operationType: v.string(),
    timeRange: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const timeRange = args.timeRange || {
      start: now - (24 * 60 * 60 * 1000), // Last 24 hours
      end: now,
    };

    let query = ctx.db
      .query("correlationLogs")
      .withIndex("by_operation_type", (q) => q.eq("operationType", args.operationType))
      .filter((q) => 
        q.and(
          q.gte(q.field("createdAt"), timeRange.start),
          q.lte(q.field("createdAt"), timeRange.end)
        )
      );

    if (args.userId) {
      query = query.filter((q) => q.eq(q.field("userId"), args.userId));
    }

    const logs = await query.collect();

    // Calculate metrics
    const totalOperations = logs.length;
    const successfulOperations = logs.filter(log => log.level !== "error").length;
    const errorOperations = logs.filter(log => log.level === "error").length;
    
    const operationsWithDuration = logs.filter(log => log.performance?.duration);
    const durations = operationsWithDuration.map(log => log.performance!.duration!);
    
    const metrics = {
      operationType: args.operationType,
      timeRange,
      totalOperations,
      successfulOperations,
      errorOperations,
      successRate: totalOperations > 0 ? successfulOperations / totalOperations : 0,
      errorRate: totalOperations > 0 ? errorOperations / totalOperations : 0,
      performance: {
        operationsWithDuration: operationsWithDuration.length,
        avgDuration: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
        minDuration: durations.length > 0 ? Math.min(...durations) : 0,
        maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
        p50Duration: durations.length > 0 ? durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.5)] : 0,
        p95Duration: durations.length > 0 ? durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)] : 0,
      },
      recentErrors: logs
        .filter(log => log.level === "error")
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map(log => ({
          correlationId: log.correlationId,
          message: log.message,
          error: log.error,
          createdAt: log.createdAt,
        })),
    };

    return metrics;
  },
});

// Cleanup old logs (called by cron job)
export const cleanupOldLogs = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
    maxLogsToDelete: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const retentionDays = args.retentionDays || 30; // Default 30 days retention
    const maxLogsToDelete = args.maxLogsToDelete || 1000; // Batch size limit
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    const oldLogs = await ctx.db
      .query("correlationLogs")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoffTime))
      .take(maxLogsToDelete);

    let deletedCount = 0;
    
    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
      deletedCount++;
    }

    console.log(`Cleaned up ${deletedCount} old correlation logs (older than ${retentionDays} days)`);
    
    return { 
      deletedCount, 
      cutoffTime, 
      retentionDays,
      hasMore: oldLogs.length === maxLogsToDelete 
    };
  },
});

// Get correlation trace (full operation tree)
export const getCorrelationTrace = internalQuery({
  args: {
    correlationId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get the root operation
    const rootLogs = await ctx.db
      .query("correlationLogs")
      .withIndex("by_correlation_id", (q) => q.eq("correlationId", args.correlationId))
      .collect();

    if (rootLogs.length === 0) {
      return { rootLogs: [], childOperations: [], trace: [] };
    }

    // Get all child operations recursively
    const allChildIds = new Set<string>();
    const queue = [args.correlationId];
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      
      const children = await ctx.db
        .query("correlationLogs")
        .withIndex("by_parent_id", (q) => q.eq("parentId", currentId))
        .collect();

      for (const child of children) {
        if (!allChildIds.has(child.correlationId)) {
          allChildIds.add(child.correlationId);
          queue.push(child.correlationId);
        }
      }
    }

    // Get logs for all child operations
    const childOperations = [];
    for (const childId of allChildIds) {
      const childLogs = await ctx.db
        .query("correlationLogs")
        .withIndex("by_correlation_id", (q) => q.eq("correlationId", childId))
        .collect();
      
      if (childLogs.length > 0) {
        childOperations.push({ correlationId: childId, logs: childLogs });
      }
    }

    // Combine all logs and sort chronologically
    const allLogs = [
      ...rootLogs,
      ...childOperations.flatMap(op => op.logs)
    ].sort((a, b) => a.createdAt - b.createdAt);

    return {
      rootLogs,
      childOperations,
      trace: allLogs,
      summary: {
        totalOperations: 1 + childOperations.length,
        totalLogs: allLogs.length,
        timeSpan: allLogs.length > 0 ? {
          start: allLogs[0]?.createdAt || 0,
          end: allLogs[allLogs.length - 1]?.createdAt || 0,
          duration: (allLogs[allLogs.length - 1]?.createdAt || 0) - (allLogs[0]?.createdAt || 0),
        } : null,
        operationTypes: Array.from(new Set(allLogs.map(log => log.operationType))),
        errorCount: allLogs.filter(log => log.level === "error").length,
      },
    };
  },
});