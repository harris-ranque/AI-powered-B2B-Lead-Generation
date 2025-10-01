import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

const NOTIFICATION_TYPES = [
  "search_completed",
  "credits_low",
  "plan_upgraded",
  "plan_updated",
  "credit_alert",
  "system_alert",
  "email_sent",
] as const;

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

function createTypeCounts() {
  const counts = {} as Record<NotificationType, number>;
  for (const type of NOTIFICATION_TYPES) {
    counts[type] = 0;
  }
  return counts;
}

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

export const getUserNotifications = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const limit = Math.min(args.limit ?? 50, 100);

    const notificationsQuery = ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc");

    const allNotifications = await notificationsQuery.collect();
    const notifications = allNotifications.slice(0, limit);

    const unreadCount = allNotifications.filter((notification) => !notification.read)
      .length;
    const typeCounts = createTypeCounts();

    for (const notification of allNotifications) {
      if (isNotificationType(notification.type)) {
        typeCounts[notification.type] += 1;
      }
    }

    return {
      notifications,
      unreadCount,
      totalCount: allNotifications.length,
      hasUnread: unreadCount > 0,
      byType: typeCounts,
    };
  },
});

export const getNotificationCounts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const unreadCount = notifications.filter((notification) => !notification.read)
      .length;
    const typeCounts = createTypeCounts();

    for (const notification of notifications) {
      if (isNotificationType(notification.type)) {
        typeCounts[notification.type] += 1;
      }
    }

    return {
      total: notifications.length,
      unread: unreadCount,
      byType: typeCounts,
    };
  },
});
