import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Test Real-time Broadcasting System
 * 
 * This file contains test functions to verify the broadcasting system works correctly.
 */

// Test function to create sample broadcasts
export const testBroadcasting = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const results = [];

    try {
      // Test 1: Basic status broadcast
      const result1 = await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
        userId: args.userId,
        type: "test_message",
        title: "Test Broadcast",
        message: "This is a test broadcast to verify the system is working",
        priority: 2,
        tags: ["test"],
      });
      results.push({ test: "basic_broadcast", success: true, result: result1 });

      // Test 2: High priority broadcast (should trigger immediate delivery)
      const result2 = await ctx.runMutation(internal.realtime.broadcaster.broadcastStatus, {
        userId: args.userId,
        type: "test_urgent",
        title: "Urgent Test",
        message: "This is a high-priority test broadcast",
        priority: 4, // URGENT
        tags: ["test", "urgent"],
        requiresAck: true,
      });
      results.push({ test: "urgent_broadcast", success: true, result: result2 });

      // Test 3: Credit update broadcast
      const result3 = await ctx.runMutation(internal.realtime.broadcaster.broadcastCreditUpdate, {
        userId: args.userId,
        previousBalance: 100,
        newBalance: 95,
        amount: -5,
        operation: "test_usage",
        description: "Test credit usage for broadcasting verification",
      });
      results.push({ test: "credit_broadcast", success: true, result: result3 });

      // Test 4: Rate limit warning
      const result4 = await ctx.runMutation(internal.realtime.broadcaster.broadcastRateLimitWarning, {
        userId: args.userId,
        operation: "test_operation",
        currentUsage: 45,
        limit: 50,
        resetTime: Date.now() + (60 * 60 * 1000), // 1 hour from now
      });
      results.push({ test: "rate_limit_broadcast", success: true, result: result4 });

      return {
        success: true,
        message: "All test broadcasts created successfully",
        results,
        timestamp: Date.now(),
      };

    } catch (error) {
      console.error("Test broadcasting failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        results,
      };
    }
  },
});

// Test function to check broadcast delivery
export const testBroadcastDelivery = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      // Get user's broadcasts
      const broadcasts = await ctx.runQuery(internal.realtime.broadcaster.getUserBroadcasts, {
        userId: args.userId,
        includeDelivered: true,
        limit: 10,
      });

      // Get pending broadcasts
      const pending = broadcasts.filter(b => !b.delivered);
      const delivered = broadcasts.filter(b => b.delivered);

      return {
        success: true,
        totalBroadcasts: broadcasts.length,
        pendingCount: pending.length,
        deliveredCount: delivered.length,
        broadcasts: broadcasts.map(b => ({
          id: b._id,
          type: b.type,
          title: b.title,
          priority: b.priority,
          status: b.status,
          delivered: b.delivered,
          acknowledged: b.acknowledged,
          createdAt: b.createdAt,
          tags: b.tags,
        })),
      };

    } catch (error) {
      console.error("Test broadcast delivery check failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Test function to trigger broadcast processing
export const testBroadcastProcessing = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      // Trigger processing of pending broadcasts
      const result = await ctx.runAction(internal.realtime.broadcaster.processPendingBroadcasts, {
        maxBroadcasts: 10,
        priorityOnly: false,
      });

      return {
        success: true,
        message: "Broadcast processing completed",
        processed: result.processed,
        attempted: result.attempted,
        results: result.results,
      };

    } catch (error) {
      console.error("Test broadcast processing failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Test function to get analytics
export const testBroadcastAnalytics = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    try {
      const analytics = await ctx.runQuery(internal.realtime.broadcaster.getBroadcastAnalytics, {
        userId: args.userId,
        timeRange: {
          start: Date.now() - (24 * 60 * 60 * 1000), // Last 24 hours
          end: Date.now(),
        },
      });

      return {
        success: true,
        analytics,
      };

    } catch (error) {
      console.error("Test broadcast analytics failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});