import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Internal mutation to create a notification
export const createNotification = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.union(
      v.literal("search_completed"),
      v.literal("credits_low"),
      v.literal("plan_upgraded"),
      v.literal("plan_updated"),
      v.literal("credit_alert"),
      v.literal("system_alert"),
      v.literal("email_sent"),
    ),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      read: false,
      sent: false, // Will be updated to true when actually sent
      createdAt: Date.now(),
    });

    return notificationId;
  },
});

// Internal query to get user notifications
export const getUserNotifications = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

// Internal mutation to mark notification as read
export const markNotificationRead = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== args.userId) {
      throw new Error("Notification not found or access denied");
    }

    await ctx.db.patch(args.notificationId, { read: true });
    return { success: true };
  },
});

// Internal mutation to cleanup old notifications
export const cleanupOldNotifications = internalMutation({
  args: {
    olderThan: v.number(), // timestamp
  },
  handler: async (ctx, args) => {
    const oldNotifications = await ctx.db
      .query("notifications")
      .filter((q) => q.lt(q.field("createdAt"), args.olderThan))
      .collect();

    for (const notification of oldNotifications) {
      await ctx.db.delete(notification._id);
    }

    return { deleted: oldNotifications.length };
  },
});
