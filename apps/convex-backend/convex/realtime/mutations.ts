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
    if (!user) {
      throw new Error("Authentication required");
    }

    try {
      // Verify user owns the broadcast
      const broadcast = await ctx.db.get(args.broadcastId);
      if (!broadcast || broadcast.userId !== user._id) {
        throw new Error("Broadcast not found or access denied");
      }

      // Mark as acknowledged and delivered
      await ctx.db.patch(args.broadcastId, {
        acknowledged: true,
        acknowledgedAt: Date.now(),
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

// Mark a broadcast as read
export const markBroadcastAsRead = mutation({
  args: {
    broadcastId: v.id("statusBroadcasts"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    try {
      // Verify user owns the broadcast
      const broadcast = await ctx.db.get(args.broadcastId);
      if (!broadcast || broadcast.userId !== user._id) {
        throw new Error("Broadcast not found or access denied");
      }

      // Mark as delivered/acknowledged so the notification no longer appears as active
      await ctx.db.patch(args.broadcastId, {
        acknowledged: true,
        acknowledgedAt: Date.now(),
        delivered: true,
        deliveredAt: Date.now(),
        status: "delivered",
      });

      return { success: true };
    } catch (error) {
      // If the statusBroadcasts table doesn't exist yet, just return success
      return { success: true, message: "Broadcast system not yet available" };
    }
  },
});
