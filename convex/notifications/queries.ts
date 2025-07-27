import { query } from "../_generated/server";
import { v } from "convex/values";
import { auth } from "../auth.config";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Get user's notifications
export const getUserNotifications = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
    type: v.optional(v.union(
      v.literal("search_completed"),
      v.literal("credits_low"),
      v.literal("plan_upgraded"),
      v.literal("system_alert"),
      v.literal("email_sent")
    )),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    let query = ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId));

    if (args.type) {
      query = ctx.db
        .query("notifications")
        .withIndex("by_type", (q) => q.eq("type", args.type))
        .filter((q) => q.eq(q.field("userId"), userId));
    }

    if (args.unreadOnly) {
      query = query.filter((q) => q.eq(q.field("read"), false));
    }

    const notifications = await query
      .order("desc")
      .take(limit + offset);

    const paginatedNotifications = notifications.slice(offset, offset + limit);

    const unreadCount = await ctx.db
      .query("notifications")
      .withIndex("by_read", (q) => q.eq("read", false))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect()
      .then(notifs => notifs.length);

    return {
      notifications: paginatedNotifications,
      total: notifications.length,
      unreadCount,
      hasMore: notifications.length > offset + limit,
    };
  },
});

// Get notification counts by type
export const getNotificationCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const counts = {
      total: notifications.length,
      unread: notifications.filter(n => !n.read).length,
      byType: {
        search_completed: notifications.filter(n => n.type === "search_completed").length,
        credits_low: notifications.filter(n => n.type === "credits_low").length,
        plan_upgraded: notifications.filter(n => n.type === "plan_upgraded").length,
        system_alert: notifications.filter(n => n.type === "system_alert").length,
        email_sent: notifications.filter(n => n.type === "email_sent").length,
      },
    };

    return counts;
  },
});