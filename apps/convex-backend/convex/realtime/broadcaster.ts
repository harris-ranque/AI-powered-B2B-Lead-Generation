import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Broadcast pipeline update to user (OPTIMIZED - REDUCED DB WRITES)
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
    // OPTIMIZATION: Store important updates to balance performance vs UX
    const shouldStore = args.error || 
                       args.stage === "completed" || 
                       args.stage === "failed" ||
                       args.stage === "started" ||
                       args.progress % 10 === 0; // Store every 10% progress (better UX)
    
    if (shouldStore) {
      // Create broadcast record only for important updates
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
        status: "pending",
        delivered: false,
        acknowledged: false,
        requiresAck: false,
        error: args.error,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, // Expire in 1 hour
      });
    }
    
    // Always log to console for development/debugging
    console.log(`Broadcasting pipeline update: ${args.stage} - ${args.progress}%`);
  },
});

// Broadcast general status update
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
      status: "pending",
      delivered: false,
      acknowledged: false,
      requiresAck: args.requiresAck || false,
      createdAt: Date.now(),
      expiresAt: Date.now() + (args.expiresIn || 3600000), // Default 1 hour
    });
    
    console.log(`Broadcasting: ${args.type} - ${args.title}`);
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