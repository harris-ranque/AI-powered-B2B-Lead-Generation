import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getCurrentUser } from "../auth";

/**
 * Public queries for real-time broadcasting system
 * These functions provide frontend access to broadcasting data
 */

/**
 * Get user's status broadcasts
 * Public query that wraps the internal getUserBroadcasts function
 */
export const getUserBroadcasts = query({
  args: {
    includeDelivered: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Get current authenticated user
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Call the internal function with the user's ID
    return await ctx.runQuery(internal.realtime.broadcaster.getUserBroadcasts, {
      userId: currentUser._id,
      includeDelivered: args.includeDelivered,
      limit: args.limit,
      tags: args.tags,
    });
  },
});

/**
 * Get broadcasting analytics for the current user
 * Public query that wraps the internal getBroadcastAnalytics function
 */
export const getBroadcastAnalytics = query({
  args: {
    timeRange: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    // Get current authenticated user
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Call the internal function with the user's ID
    return await ctx.runQuery(internal.realtime.broadcaster.getBroadcastAnalytics, {
      timeRange: args.timeRange,
      userId: currentUser._id,
    });
  },
});