import { internalMutation, internalAction, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Real-time Status Broadcasting System
 * 
 * Features:
 * - Real-time search status updates
 * - Progress tracking with detailed metrics
 * - User-specific broadcasting channels
 * - Batch processing progress updates
 * - System-wide status notifications
 * - Event-driven architecture with filtering
 */

// Broadcast types
export const BROADCAST_TYPES = {
  SEARCH_STATUS: "search_status",
  BATCH_PROGRESS: "batch_progress",
  LEAD_DISCOVERED: "lead_discovered",
  LEAD_ENRICHED: "lead_enriched",
  ANALYSIS_COMPLETE: "analysis_complete",
  SYSTEM_ALERT: "system_alert",
  CREDIT_UPDATE: "credit_update",
  RATE_LIMIT_WARNING: "rate_limit_warning",
} as const;

// Broadcast priority levels
export const PRIORITY_LEVELS = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
  CRITICAL: 5,
} as const;

// Create and broadcast a real-time status update
export const broadcastStatus = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    priority: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    expiresAt: v.optional(v.number()),
    requiresAck: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const priority = args.priority || PRIORITY_LEVELS.NORMAL;
    const expiresAt = args.expiresAt || (now + (5 * 60 * 1000)); // Default 5 minutes

    // Create broadcast record
    const broadcastId = await ctx.db.insert("statusBroadcasts", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      priority,
      tags: args.tags || [],
      status: "pending",
      delivered: false,
      acknowledged: false,
      requiresAck: args.requiresAck || false,
      createdAt: now,
      expiresAt,
      deliveredAt: undefined,
      acknowledgedAt: undefined,
    });

    // Trigger immediate delivery for high-priority broadcasts
    if (priority >= PRIORITY_LEVELS.HIGH) {
      await ctx.scheduler.runAfter(0, internal.realtime.broadcaster.deliverBroadcast, {
        broadcastId,
      });
    }

    console.log(`Created broadcast ${broadcastId} for user ${args.userId}: ${args.type} - ${args.title}`);

    return {
      broadcastId,
      priority,
      willDeliverImmediately: priority >= PRIORITY_LEVELS.HIGH,
    };
  },
});

// Deliver broadcast to user (updates the broadcast status)
export const deliverBroadcast = internalAction({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(internal.realtime.broadcaster.getBroadcast, {
      broadcastId: args.broadcastId,
    });

    if (!broadcast) {
      console.error(`Broadcast ${args.broadcastId} not found`);
      return { success: false, error: "Broadcast not found" };
    }

    if (broadcast.delivered) {
      return { success: true, message: "Already delivered" };
    }

    try {
      // Mark as delivered
      await ctx.runMutation(internal.realtime.broadcaster.markBroadcastDelivered, {
        broadcastId: args.broadcastId,
      });

      // In a real implementation, this would push to WebSocket, SSE, or push notification service
      // For now, we'll simulate the delivery by logging and updating the database
      console.log(`Delivered broadcast to user ${broadcast.userId}: ${broadcast.type} - ${broadcast.title}`);

      return { success: true, deliveredAt: Date.now() };

    } catch (error) {
      console.error(`Failed to deliver broadcast ${args.broadcastId}:`, error);
      
      // Mark as failed for retry
      await ctx.runMutation(internal.realtime.broadcaster.markBroadcastFailed, {
        broadcastId: args.broadcastId,
        error: error instanceof Error ? error.message : "Delivery failed",
      });

      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Get broadcast by ID
export const getBroadcast = internalQuery({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.broadcastId);
  },
});

// Mark broadcast as delivered
export const markBroadcastDelivered = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    await ctx.db.patch(args.broadcastId, {
      status: "delivered",
      delivered: true,
      deliveredAt: now,
    });

    return { success: true, deliveredAt: now };
  },
});

// Mark broadcast as failed
export const markBroadcastFailed = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      status: "failed",
      error: args.error,
    });

    return { success: true };
  },
});

// Acknowledge broadcast (user has seen it)
export const acknowledgeBroadcast = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const broadcast = await ctx.db.get(args.broadcastId);
    
    if (!broadcast) {
      throw new Error("Broadcast not found");
    }

    if (broadcast.userId !== args.userId) {
      throw new Error("Not authorized to acknowledge this broadcast");
    }

    const now = Date.now();
    
    await ctx.db.patch(args.broadcastId, {
      acknowledged: true,
      acknowledgedAt: now,
    });

    console.log(`User ${args.userId} acknowledged broadcast ${args.broadcastId}`);

    return { success: true, acknowledgedAt: now };
  },
});

// Broadcast search status update
export const broadcastSearchStatus = internalMutation({
  args: {
    searchId: v.id("searches"),
    status: v.string(),
    message: v.optional(v.string()),
    progress: v.optional(v.object({
      discovered: v.number(),
      enriched: v.number(),
      analyzed: v.number(),
      total: v.number(),
    })),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const progressPercent = args.progress 
      ? Math.round(((args.progress.discovered + args.progress.enriched + args.progress.analyzed) / (args.progress.total * 3)) * 100)
      : 0;

    const message = args.message || `Search status updated: ${args.status}`;
    const title = `Search "${search.name}" Update`;

    return await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
      userId: search.userId,
      type: BROADCAST_TYPES.SEARCH_STATUS,
      title,
      message,
      data: {
        searchId: args.searchId,
        searchName: search.name,
        status: args.status,
        progress: args.progress,
        progressPercent,
        timestamp: Date.now(),
      },
      priority: args.priority || PRIORITY_LEVELS.NORMAL,
      tags: ["search", "status"],
    });
  },
});

// Broadcast batch processing progress
export const broadcastBatchProgress = internalMutation({
  args: {
    batchPlanId: v.id("batchPlans"),
    completedBatches: v.number(),
    totalBatches: v.number(),
    phase: v.optional(v.string()),
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

    const progressPercent = Math.round((args.completedBatches / args.totalBatches) * 100);
    const phase = args.phase || "processing";
    
    const title = `Batch Processing Update`;
    const message = `${phase}: ${args.completedBatches}/${args.totalBatches} batches completed (${progressPercent}%)`;

    return await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
      userId: batchPlan.userId,
      type: BROADCAST_TYPES.BATCH_PROGRESS,
      title,
      message,
      data: {
        batchPlanId: args.batchPlanId,
        searchId: batchPlan.searchId,
        searchName: search.name,
        phase,
        completedBatches: args.completedBatches,
        totalBatches: args.totalBatches,
        progressPercent,
        timestamp: Date.now(),
      },
      priority: PRIORITY_LEVELS.NORMAL,
      tags: ["batch", "progress"],
    });
  },
});

// Broadcast lead discovery update
export const broadcastLeadDiscovered = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadCount: v.number(),
    newLeads: v.number(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const title = `New Leads Found`;
    const message = `Found ${args.newLeads} new leads (${args.leadCount} total)`;

    return await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
      userId: search.userId,
      type: BROADCAST_TYPES.LEAD_DISCOVERED,
      title,
      message,
      data: {
        searchId: args.searchId,
        searchName: search.name,
        leadCount: args.leadCount,
        newLeads: args.newLeads,
        timestamp: Date.now(),
      },
      priority: PRIORITY_LEVELS.LOW,
      tags: ["leads", "discovery"],
      expiresAt: Date.now() + (2 * 60 * 1000), // 2 minutes
    });
  },
});

// Broadcast lead enrichment update
export const broadcastLeadEnriched = internalMutation({
  args: {
    searchId: v.id("searches"),
    enrichedCount: v.number(),
    totalLeads: v.number(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const progressPercent = Math.round((args.enrichedCount / args.totalLeads) * 100);
    const title = `Lead Enrichment Progress`;
    const message = `${args.enrichedCount}/${args.totalLeads} leads enriched (${progressPercent}%)`;

    return await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
      userId: search.userId,
      type: BROADCAST_TYPES.LEAD_ENRICHED,
      title,
      message,
      data: {
        searchId: args.searchId,
        searchName: search.name,
        enrichedCount: args.enrichedCount,
        totalLeads: args.totalLeads,
        progressPercent,
        timestamp: Date.now(),
      },
      priority: PRIORITY_LEVELS.LOW,
      tags: ["leads", "enrichment"],
      expiresAt: Date.now() + (3 * 60 * 1000), // 3 minutes
    });
  },
});

// Broadcast credit update
export const broadcastCreditUpdate = internalMutation({
  args: {
    userId: v.id("users"),
    previousBalance: v.number(),
    newBalance: v.number(),
    amount: v.number(),
    operation: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const isDebit = args.amount < 0;
    const title = isDebit ? "Credits Used" : "Credits Added";
    const message = `${args.description}. Balance: ${args.newBalance} credits`;

    // Determine priority based on remaining balance
    let priority = PRIORITY_LEVELS.LOW;
    if (args.newBalance <= 10) {
      priority = PRIORITY_LEVELS.HIGH; // Low credits warning
    } else if (args.newBalance <= 25) {
      priority = PRIORITY_LEVELS.NORMAL; // Medium credits warning
    }

    return await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
      userId: args.userId,
      type: BROADCAST_TYPES.CREDIT_UPDATE,
      title,
      message,
      data: {
        previousBalance: args.previousBalance,
        newBalance: args.newBalance,
        amount: args.amount,
        operation: args.operation,
        description: args.description,
        isLowCredits: args.newBalance <= 25,
        timestamp: Date.now(),
      },
      priority,
      tags: ["credits", isDebit ? "debit" : "credit"],
      requiresAck: args.newBalance <= 10, // Require acknowledgment for low credits
    });
  },
});

// Broadcast rate limit warning
export const broadcastRateLimitWarning = internalMutation({
  args: {
    userId: v.id("users"),
    operation: v.string(),
    currentUsage: v.number(),
    limit: v.number(),
    resetTime: v.number(),
  },
  handler: async (ctx, args) => {
    const utilizationPercent = Math.round((args.currentUsage / args.limit) * 100);
    const title = "Rate Limit Warning";
    const message = `${args.operation}: ${utilizationPercent}% of limit used (${args.currentUsage}/${args.limit})`;

    // Determine priority based on utilization
    let priority = PRIORITY_LEVELS.NORMAL;
    if (utilizationPercent >= 90) {
      priority = PRIORITY_LEVELS.HIGH;
    } else if (utilizationPercent >= 95) {
      priority = PRIORITY_LEVELS.URGENT;
    }

    return await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
      userId: args.userId,
      type: BROADCAST_TYPES.RATE_LIMIT_WARNING,
      title,
      message,
      data: {
        operation: args.operation,
        currentUsage: args.currentUsage,
        limit: args.limit,
        utilizationPercent,
        resetTime: args.resetTime,
        timestamp: Date.now(),
      },
      priority,
      tags: ["rate-limit", "warning"],
      requiresAck: utilizationPercent >= 90,
    });
  },
});

// Get user's pending broadcasts
export const getUserBroadcasts = internalQuery({
  args: {
    userId: v.id("users"),
    includeDelivered: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const includeDelivered = args.includeDelivered || false;

    let query = ctx.db
      .query("statusBroadcasts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId));

    let broadcasts = await query.collect();

    // Filter by delivery status
    if (!includeDelivered) {
      broadcasts = broadcasts.filter(b => !b.delivered || b.requiresAck && !b.acknowledged);
    }

    // Filter by tags if provided
    if (args.tags && args.tags.length > 0) {
      broadcasts = broadcasts.filter(b => 
        args.tags!.some(tag => b.tags.includes(tag))
      );
    }

    // Filter out expired broadcasts
    const now = Date.now();
    broadcasts = broadcasts.filter(b => b.expiresAt > now);

    // Sort by priority (highest first) then by creation time (newest first)
    broadcasts.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return b.createdAt - a.createdAt;
    });

    return broadcasts.slice(0, limit);
  },
});

// Process pending broadcasts for delivery
export const processPendingBroadcasts = internalAction({
  args: {
    maxBroadcasts: v.optional(v.number()),
    priorityOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const maxBroadcasts = args.maxBroadcasts || 50;
    const priorityOnly = args.priorityOnly || false;

    // Get pending broadcasts
    const pendingBroadcasts = await ctx.runQuery(internal.realtime.broadcaster.getPendingBroadcasts, {
      limit: maxBroadcasts * 2, // Get more than needed for filtering
      priorityOnly,
    });

    if (pendingBroadcasts.length === 0) {
      return { processed: 0, message: "No pending broadcasts" };
    }

    let processed = 0;
    const results = [];

    for (const broadcast of pendingBroadcasts.slice(0, maxBroadcasts)) {
      try {
        const result = await ctx.runAction(internal.realtime.broadcaster.deliverBroadcast, {
          broadcastId: broadcast._id,
        });

        if (result.success) {
          processed++;
        }

        results.push({
          broadcastId: broadcast._id,
          userId: broadcast.userId,
          type: broadcast.type,
          success: result.success,
          error: result.error,
        });

      } catch (error) {
        console.error(`Error processing broadcast ${broadcast._id}:`, error);
        results.push({
          broadcastId: broadcast._id,
          userId: broadcast.userId,
          type: broadcast.type,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      processed,
      attempted: results.length,
      results,
    };
  },
});

// Get pending broadcasts for delivery
export const getPendingBroadcasts = internalQuery({
  args: {
    limit: v.optional(v.number()),
    priorityOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    const now = Date.now();

    let broadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => 
        q.and(
          q.eq(q.field("delivered"), false),
          q.gt(q.field("expiresAt"), now) // Not expired
        )
      )
      .collect();

    // Filter by priority if requested
    if (args.priorityOnly) {
      broadcasts = broadcasts.filter(b => b.priority >= PRIORITY_LEVELS.HIGH);
    }

    // Sort by priority (highest first) then by creation time (oldest first)
    broadcasts.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    });

    return broadcasts.slice(0, limit);
  },
});

// Cleanup expired broadcasts
export const cleanupExpiredBroadcasts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    const expiredBroadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .collect();

    let deleted = 0;

    for (const broadcast of expiredBroadcasts) {
      // Only delete if delivered or if it's been expired for more than 1 hour
      const expiredFor = now - broadcast.expiresAt;
      if (broadcast.delivered || expiredFor > (60 * 60 * 1000)) {
        await ctx.db.delete(broadcast._id);
        deleted++;
      }
    }

    console.log(`Cleaned up ${deleted} expired broadcasts`);
    return { deleted };
  },
});

// Get broadcasting analytics
export const getBroadcastAnalytics = internalQuery({
  args: {
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

    // Build query
    let query = ctx.db.query("statusBroadcasts");
    
    if (args.userId) {
      query = query.withIndex("by_user", (q) => q.eq("userId", args.userId));
    }

    // Get broadcasts in time range
    const broadcasts = await query
      .filter((q) => 
        q.and(
          q.gte(q.field("createdAt"), timeRange.start),
          q.lte(q.field("createdAt"), timeRange.end)
        )
      )
      .collect();

    // Calculate analytics
    const analytics = {
      timeRange,
      totalBroadcasts: broadcasts.length,
      byStatus: {
        pending: broadcasts.filter(b => b.status === "pending").length,
        delivered: broadcasts.filter(b => b.status === "delivered").length,
        failed: broadcasts.filter(b => b.status === "failed").length,
      },
      byType: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
      performance: {
        deliveryRate: 0,
        acknowledgmentRate: 0,
        avgDeliveryTime: 0,
      },
    };

    // Group by type
    for (const broadcast of broadcasts) {
      analytics.byType[broadcast.type] = (analytics.byType[broadcast.type] || 0) + 1;
      analytics.byPriority[broadcast.priority.toString()] = (analytics.byPriority[broadcast.priority.toString()] || 0) + 1;
    }

    // Calculate performance metrics
    const deliveredBroadcasts = broadcasts.filter(b => b.delivered);
    if (broadcasts.length > 0) {
      analytics.performance.deliveryRate = deliveredBroadcasts.length / broadcasts.length;
      
      const acknowledgedBroadcasts = broadcasts.filter(b => b.acknowledged);
      const requiresAckBroadcasts = broadcasts.filter(b => b.requiresAck);
      if (requiresAckBroadcasts.length > 0) {
        analytics.performance.acknowledgmentRate = acknowledgedBroadcasts.length / requiresAckBroadcasts.length;
      }

      // Calculate average delivery time
      const deliveryTimes = deliveredBroadcasts
        .filter(b => b.deliveredAt)
        .map(b => b.deliveredAt! - b.createdAt);
      
      if (deliveryTimes.length > 0) {
        analytics.performance.avgDeliveryTime = deliveryTimes.reduce((sum, time) => sum + time, 0) / deliveryTimes.length;
      }
    }

    return analytics;
  },
});