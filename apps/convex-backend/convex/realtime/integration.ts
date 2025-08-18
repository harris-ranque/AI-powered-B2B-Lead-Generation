import { GenericMutationCtx, GenericActionCtx } from "convex/server";
import { DataModel } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/**
 * Real-time Broadcasting Integration Helpers
 * 
 * Easy-to-use functions for integrating real-time status updates
 * into existing search, batch, and system operations
 */

// Helper to broadcast search status from any context
export async function broadcastSearchUpdate(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  searchId: string,
  status: string,
  message?: string,
  additionalData?: any
) {
  try {
    // Get search details
    const search = await ctx.db.get(searchId);
    if (!search) {
      console.error(`Cannot broadcast - search ${searchId} not found`);
      return;
    }

    // Prepare progress data
    let progress = undefined;
    if (search.progress) {
      progress = {
        discovered: search.progress.discovered,
        enriched: search.progress.enriched,
        analyzed: search.progress.analyzed,
        total: search.progress.total,
      };
    }

    // Determine priority based on status
    let priority = 2; // Normal
    if (status === "completed" || status === "failed") {
      priority = 3; // High priority for completion
    } else if (status === "cancelled") {
      priority = 4; // Urgent for cancellation
    }

    // Use runMutation if in action context, direct call if in mutation context
    if ("runMutation" in ctx) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastSearchStatus, {
        searchId,
        status,
        message,
        progress,
        priority,
      });
    } else {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastSearchStatus, {
        searchId,
        status,
        message,
        progress,
        priority,
      });
    }

    console.log(`Broadcast sent for search ${searchId}: ${status}`);
  } catch (error) {
    console.error(`Failed to broadcast search update:`, error);
  }
}

// Helper to broadcast batch progress updates
export async function broadcastBatchUpdate(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  batchPlanId: string,
  completedBatches: number,
  totalBatches: number,
  phase?: string
) {
  try {
    if ("runMutation" in ctx) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastBatchProgress, {
        batchPlanId,
        completedBatches,
        totalBatches,
        phase,
      });
    } else {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastBatchProgress, {
        batchPlanId,
        completedBatches,
        totalBatches,
        phase,
      });
    }

    console.log(`Broadcast batch progress: ${completedBatches}/${totalBatches} (${phase})`);
  } catch (error) {
    console.error(`Failed to broadcast batch update:`, error);
  }
}

// Helper to broadcast lead discovery updates
export async function broadcastLeadUpdate(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  searchId: string,
  type: "discovered" | "enriched",
  count: number,
  total?: number
) {
  try {
    if (type === "discovered") {
      if ("runMutation" in ctx) {
        await ctx.runMutation(internal.realtime.broadcaster.broadcastLeadDiscovered, {
          searchId,
          leadCount: count,
          newLeads: 1, // Assuming 1 new lead per call - adjust as needed
        });
      } else {
        await ctx.runMutation(internal.realtime.broadcaster.broadcastLeadDiscovered, {
          searchId,
          leadCount: count,
          newLeads: 1,
        });
      }
    } else if (type === "enriched" && total) {
      if ("runMutation" in ctx) {
        await ctx.runMutation(internal.realtime.broadcaster.broadcastLeadEnriched, {
          searchId,
          enrichedCount: count,
          totalLeads: total,
        });
      } else {
        await ctx.runMutation(internal.realtime.broadcaster.broadcastLeadEnriched, {
          searchId,
          enrichedCount: count,
          totalLeads: total,
        });
      }
    }

    console.log(`Broadcast lead ${type} update: ${count}${total ? `/${total}` : ''}`);
  } catch (error) {
    console.error(`Failed to broadcast lead update:`, error);
  }
}

// Helper to broadcast credit updates
export async function broadcastCreditChange(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  userId: string,
  previousBalance: number,
  newBalance: number,
  amount: number,
  operation: string,
  description: string
) {
  try {
    if ("runMutation" in ctx) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastCreditUpdate, {
        userId,
        previousBalance,
        newBalance,
        amount,
        operation,
        description,
      });
    } else {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastCreditUpdate, {
        userId,
        previousBalance,
        newBalance,
        amount,
        operation,
        description,
      });
    }

    console.log(`Broadcast credit update for user ${userId}: ${amount} (${newBalance} remaining)`);
  } catch (error) {
    console.error(`Failed to broadcast credit update:`, error);
  }
}

// Helper to broadcast rate limit warnings
export async function broadcastRateLimitAlert(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  userId: string,
  operation: string,
  currentUsage: number,
  limit: number,
  resetTime: number
) {
  try {
    if ("runMutation" in ctx) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastRateLimitWarning, {
        userId,
        operation,
        currentUsage,
        limit,
        resetTime,
      });
    } else {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastRateLimitWarning, {
        userId,
        operation,
        currentUsage,
        limit,
        resetTime,
      });
    }

    console.log(`Broadcast rate limit warning for user ${userId}: ${operation} ${currentUsage}/${limit}`);
  } catch (error) {
    console.error(`Failed to broadcast rate limit warning:`, error);
  }
}

// Helper to broadcast system alerts
export async function broadcastSystemAlert(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  userId: string,
  title: string,
  message: string,
  priority: number = 3,
  data?: any
) {
  try {
    if ("runMutation" in ctx) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
        userId,
        type: "system_alert",
        title,
        message,
        data,
        priority,
        tags: ["system", "alert"],
        requiresAck: priority >= 4,
      });
    } else {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
        userId,
        type: "system_alert",
        title,
        message,
        data,
        priority,
        tags: ["system", "alert"],
        requiresAck: priority >= 4,
      });
    }

    console.log(`Broadcast system alert for user ${userId}: ${title}`);
  } catch (error) {
    console.error(`Failed to broadcast system alert:`, error);
  }
}

// Integration decorator for automatic broadcasting
export function withBroadcasting<T extends any[], R>(
  broadcastConfig: {
    type: string;
    title: string;
    getMessage: (...args: T) => string;
    getPriority?: (...args: T) => number;
    getData?: (...args: T) => any;
    getUserId: (...args: T) => string;
  }
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (ctx: any, ...args: T) {
      const result = await originalMethod.call(this, ctx, ...args);

      try {
        // Extract broadcast parameters
        const userId = broadcastConfig.getUserId(...args);
        const message = broadcastConfig.getMessage(...args);
        const priority = broadcastConfig.getPriority ? broadcastConfig.getPriority(...args) : 2;
        const data = broadcastConfig.getData ? broadcastConfig.getData(...args) : undefined;

        // Send broadcast
        await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
          userId,
          type: broadcastConfig.type,
          title: broadcastConfig.title,
          message,
          data,
          priority,
          tags: [broadcastConfig.type],
        });

      } catch (error) {
        console.error(`Failed to send broadcast for ${propertyKey}:`, error);
      }

      return result;
    };

    return descriptor;
  };
}

// Context-aware broadcast helper that automatically determines the right method
export async function broadcast(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  config: {
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: any;
    priority?: number;
    tags?: string[];
    requiresAck?: boolean;
    expiresIn?: number; // milliseconds
  }
) {
  try {
    const expiresAt = config.expiresIn 
      ? Date.now() + config.expiresIn 
      : Date.now() + (5 * 60 * 1000); // Default 5 minutes

    const broadcastArgs = {
      userId: config.userId,
      type: config.type,
      title: config.title,
      message: config.message,
      data: config.data,
      priority: config.priority || 2,
      tags: config.tags || [config.type],
      requiresAck: config.requiresAck || false,
      expiresAt,
    };

    if ("runMutation" in ctx) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, broadcastArgs);
    } else {
      await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, broadcastArgs);
    }

    console.log(`Broadcast sent: ${config.type} - ${config.title}`);
  } catch (error) {
    console.error(`Failed to send broadcast:`, error);
  }
}

// Batch broadcast helper for sending multiple broadcasts efficiently
export async function broadcastBatch(
  ctx: GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>,
  broadcasts: Array<{
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: any;
    priority?: number;
    tags?: string[];
  }>
) {
  try {
    const results = [];

    for (const broadcastConfig of broadcasts) {
      try {
        await broadcast(ctx, broadcastConfig);
        results.push({ success: true, userId: broadcastConfig.userId });
      } catch (error) {
        results.push({ 
          success: false, 
          userId: broadcastConfig.userId, 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }

    console.log(`Batch broadcast completed: ${results.filter(r => r.success).length}/${broadcasts.length} successful`);
    return results;
  } catch (error) {
    console.error(`Failed to send batch broadcast:`, error);
    throw error;
  }
}