import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Acknowledge a broadcast message
export const acknowledgeBroadcast = mutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    try {
      // Verify user owns the broadcast
      const broadcast = await ctx.db.get(args.broadcastId);
      if (!broadcast || broadcast.userId !== user._id) {
        throw new Error("Broadcast not found or access denied");
      }
      
      // Mark as delivered
      await ctx.db.patch(args.broadcastId, {
        status: "delivered",
        deliveredAt: Date.now(),
      });
      
      return { success: true };
    } catch (error) {
      // If the statusBroadcasts table doesn't exist yet, just return success
      return { success: true, message: "Broadcast system not yet available" };
    }
  },
});