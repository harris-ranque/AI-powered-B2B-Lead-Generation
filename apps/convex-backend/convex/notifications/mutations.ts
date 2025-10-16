import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

export const markAsRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== user._id) {
      throw new Error("Notification not found or access denied");
    }

    if (notification.read) {
      return { success: true, alreadyRead: true };
    }

    await ctx.db.patch(args.notificationId, {
      read: true,
      readAt: Date.now(),
    });

    return { success: true };
  },
});

export const markAllAsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", user._id).eq("read", false))
      .collect();

    for (const notification of unreadNotifications) {
      await ctx.db.patch(notification._id, {
        read: true,
        readAt: Date.now(),
      });
    }

    return { success: true, updated: unreadNotifications.length };
  },
});

export const deleteNotification = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== user._id) {
      throw new Error("Notification not found or access denied");
    }

    await ctx.db.delete(args.notificationId);

    return { success: true };
  },
});
