import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Mark notification as read
export const markAsRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const notification = await ctx.db.get(args.notificationId);
    
    if (!notification || notification.userId !== user._id) {
      throw createError("Notification not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    await ctx.db.patch(args.notificationId, {
      read: true,
      readAt: Date.now(),
    });

    return { success: true };
  },
});

// Mark all notifications as read
export const markAllAsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_read", (q) => q.eq("read", false))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();

    const readAt = Date.now();
    
    for (const notification of unreadNotifications) {
      await ctx.db.patch(notification._id, {
        read: true,
        readAt,
      });
    }

    return { success: true, updated: unreadNotifications.length };
  },
});

// Delete notification
export const deleteNotification = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const notification = await ctx.db.get(args.notificationId);
    
    if (!notification || notification.userId !== user._id) {
      throw createError("Notification not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    await ctx.db.delete(args.notificationId);

    return { success: true };
  },
});