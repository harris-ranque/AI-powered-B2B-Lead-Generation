import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { SSEConnectionManager } from "./sseManager";

// Global SSE manager instance
let sseManager: SSEConnectionManager | null = null;

// Initialize SSE manager (lazy loading)
function getSSEManager(): SSEConnectionManager {
  if (!sseManager) {
    sseManager = new SSEConnectionManager();
  }
  return sseManager;
}

// Broadcast pipeline update to user (SSE-POWERED REAL-TIME)
export const broadcastPipelineUpdate = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    stage: v.string(),
    progress: v.number(),
    message: v.string(),
    data: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const manager = getSSEManager();
    
    // Send real-time SSE message to user
    const broadcastMessage = {
      type: "pipeline_update",
      message: args.message,
      data: {
        searchId: args.searchId,
        stage: args.stage,
        progress: args.progress,
        ...args.data,
      },
      priority: args.error ? "critical" as const : "normal" as const,
      timestamp: Date.now(),
      error: args.error,
    };

    // Send via SSE (will queue if user offline)
    const sent = manager.broadcast(args.userId, broadcastMessage);
    
    // Only store critical messages in database for audit/persistence
    const shouldStore = args.error || 
                       args.stage === "completed" || 
                       args.stage === "failed";
    
    if (shouldStore) {
      // Store only critical updates in database for audit trail
      await ctx.db.insert("statusBroadcasts", {
        userId: args.userId,
        entityType: "search",
        entityId: args.searchId,
        type: "pipeline_update",
        title: `Pipeline ${args.stage}`,
        message: args.message,
        data: {
          stage: args.stage,
          progress: args.progress,
          ...args.data,
        },
        priority: args.error ? "high" : "normal",
        category: "search_update",
        tags: ["pipeline", args.stage],
        status: sent ? "delivered" : "pending",
        delivered: sent,
        acknowledged: false,
        requiresAck: false,
        error: args.error,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, // Expire in 1 hour
      });
    }
    
    // Log for development/debugging
    console.log(`SSE Broadcasting: ${args.stage} - ${args.progress}% (${sent ? 'delivered' : 'queued'})`);
  },
});

// Broadcast general status update (SSE-POWERED)
export const broadcast = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    priority: v.optional(v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
      v.literal("critical")
    )),
    category: v.optional(v.string()),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    requiresAck: v.optional(v.boolean()),
    expiresIn: v.optional(v.number()), // milliseconds
  },
  handler: async (ctx, args) => {
    const manager = getSSEManager();
    
    // Send real-time SSE message to user
    const broadcastMessage = {
      type: args.type,
      message: args.message,
      data: {
        title: args.title,
        category: args.category || "general",
        entityType: args.entityType,
        entityId: args.entityId,
        ...args.data,
      },
      priority: (args.priority || "normal") as "low" | "normal" | "high" | "urgent" | "critical",
      timestamp: Date.now(),
    };

    // Send via SSE (will queue if user offline)
    const sent = manager.broadcast(args.userId, broadcastMessage);
    
    // Store in database only if it requires acknowledgment or is critical
    const shouldStore = args.requiresAck || 
                       args.priority === "critical" || 
                       args.priority === "urgent";
    
    if (shouldStore) {
      await ctx.db.insert("statusBroadcasts", {
        userId: args.userId,
        entityType: args.entityType || "system",
        entityId: args.entityId,
        type: args.type,
        title: args.title,
        message: args.message,
        data: args.data,
        priority: args.priority || "normal",
        category: args.category || "general",
        tags: [],
        status: sent ? "delivered" : "pending",
        delivered: sent,
        acknowledged: false,
        requiresAck: args.requiresAck || false,
        createdAt: Date.now(),
        expiresAt: Date.now() + (args.expiresIn || 3600000), // Default 1 hour
      });
    }
    
    console.log(`SSE Broadcasting: ${args.type} - ${args.title} (${sent ? 'delivered' : 'queued'})`);
  },
});

// Mark broadcast as delivered
export const markDelivered = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      status: "delivered",
      delivered: true,
      deliveredAt: Date.now(),
    });
  },
});

// Mark broadcast as acknowledged
export const acknowledge = internalMutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      acknowledged: true,
      acknowledgedAt: Date.now(),
    });
  },
});

// Clean up expired broadcasts
export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100);
    
    for (const broadcast of expired) {
      await ctx.db.patch(broadcast._id, {
        status: "expired",
      });
    }
    
    return { cleaned: expired.length };
  },
});