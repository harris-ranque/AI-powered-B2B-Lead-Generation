import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Test the broadcasting system integration
export const testBroadcastSystem = mutation({
  args: { 
    userId: v.id("users"), 
    message: v.string() 
  },
  handler: async (ctx, args) => {
    console.log(`Testing broadcast system for user ${args.userId}: ${args.message}`);
    
    // Test real-time broadcasting  
    await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
      userId: args.userId,
      type: "test_message",
      title: "Test Message",
      message: args.message,
      data: { testData: "broadcasting test" },
      priority: "normal",
      category: "test",
    });

    return { success: true, message: "Test broadcast sent" };
  },
});

// Test SSE connection tracking
export const testSSEConnections = query({
  args: {},
  handler: async (ctx, args) => {
    // This would normally access the SSE manager, but for now just return test data
    return { 
      message: "SSE test endpoint reached",
      timestamp: Date.now(),
      status: "functional"
    };
  },
});

// Test broadcast with different priorities
export const testBroadcastPriorities = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const testMessages = [
      { priority: 1, message: "Low priority test" },
      { priority: 3, message: "Normal priority test" },
      { priority: 5, message: "High priority test" },
    ];

    const priorityMap = { 1: "low", 3: "normal", 5: "high" } as const;
    
    for (const test of testMessages) {
      await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
        userId: args.userId,
        type: "priority_test",
        title: "Priority Test",
        message: test.message,
        data: { priority: test.priority },
        priority: priorityMap[test.priority as keyof typeof priorityMap],
        category: "test",
      });
    }

    return { success: true, testsRun: testMessages.length };
  },
});