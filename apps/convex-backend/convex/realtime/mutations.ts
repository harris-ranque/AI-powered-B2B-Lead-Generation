import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getCurrentUser } from "../auth";

/**
 * Public mutations for real-time broadcasting system
 * These functions provide frontend access to broadcasting actions
 */

/**
 * Acknowledge a broadcast
 * Public mutation that wraps the internal acknowledgeBroadcast function
 */
export const acknowledgeBroadcast = mutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    // Get current authenticated user
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser) {
      throw new Error("Authentication required");
    }

    // Call the internal function with the user's ID
    return await ctx.runMutation(internal.realtime.broadcaster.acknowledgeBroadcast, {
      broadcastId: args.broadcastId,
      userId: currentUser._id,
    });
  },
});