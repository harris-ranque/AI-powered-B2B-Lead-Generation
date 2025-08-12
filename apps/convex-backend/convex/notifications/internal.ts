import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Send pending notifications (called by cron job)
export const sendPendingNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get notifications that need to be sent
    const pendingNotifications = await ctx.db
      .query("notifications")
      .filter((q) => q.and(
        q.eq(q.field("sent"), false),
        q.eq(q.field("read"), false)
      ))
      .order("asc")
      .take(50);

    let sent = 0;

    for (const notification of pendingNotifications) {
      try {
        // Get user for email preferences
        const user = await ctx.db.get(notification.userId);
        
        if (!user || !user.preferences?.emailNotifications) {
          // Mark as sent but don't actually send
          await ctx.db.patch(notification._id, {
            sent: true,
          });
          continue;
        }

        // For now, just mark as sent - in a real implementation
        // you would send actual emails here
        await ctx.db.patch(notification._id, {
          sent: true,
          emailSent: {
            to: user.email,
            subject: notification.title,
            sentAt: Date.now(),
            provider: "internal",
          },
        });

        sent++;
        console.log(`Sent notification: ${notification.title} to ${user.email}`);

      } catch (error) {
        console.error(`Failed to send notification ${notification._id}:`, error);
      }
    }

    return { sent };
  },
});

// Send weekly summaries (called by cron job)
export const sendWeeklySummaries = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    // Get all active users
    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    let sent = 0;

    for (const user of users) {
      try {
        if (!user.preferences?.emailNotifications) {
          continue;
        }

        // Get user's activity for the week
        const searches = await ctx.db
          .query("searches")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .filter((q) => q.gt(q.field("createdAt"), oneWeekAgo))
          .collect();

        const leads = await ctx.db
          .query("leads")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .filter((q) => q.gt(q.field("createdAt"), oneWeekAgo))
          .collect();

        const emailSequences = await ctx.db
          .query("emailSequences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .filter((q) => q.gt(q.field("createdAt"), oneWeekAgo))
          .collect();

        // Only send if there was activity
        if (searches.length > 0 || leads.length > 0 || emailSequences.length > 0) {
          // Create summary notification
          await ctx.db.insert("notifications", {
            userId: user._id,
            type: "system_alert",
            title: "Your Weekly Genni Summary",
            message: `This week you completed ${searches.length} searches, found ${leads.length} leads, and generated ${emailSequences.length} email sequences.`,
            data: {
              searches: searches.length,
              leads: leads.length,
              emailSequences: emailSequences.length,
              period: "weekly",
            },
            read: false,
            sent: true,
            createdAt: Date.now(),
          });

          sent++;
        }

      } catch (error) {
        console.error(`Failed to send weekly summary to ${user.email}:`, error);
      }
    }

    return { sent };
  },
});

// Create system notification
export const createSystemNotification = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    title: v.string(),
    message: v.string(),
    type: v.union(
      v.literal("search_completed"),
      v.literal("credits_low"),
      v.literal("plan_upgraded"),
      v.literal("system_alert"),
      v.literal("email_sent")
    ),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.userId) {
      // Send to specific user
      return await ctx.db.insert("notifications", {
        userId: args.userId,
        type: args.type,
        title: args.title,
        message: args.message,
        data: args.data,
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    } else {
      // Send to all users
      const users = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();

      const notifications = [];
      for (const user of users) {
        const notificationId = await ctx.db.insert("notifications", {
          userId: user._id,
          type: args.type,
          title: args.title,
          message: args.message,
          data: args.data,
          read: false,
          sent: false,
          createdAt: Date.now(),
        });
        notifications.push(notificationId);
      }

      return notifications;
    }
  },
});

// Get notification statistics
export const getNotificationStats = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const days = args.days || 30;
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);

    const notifications = await ctx.db
      .query("notifications")
      .filter((q) => q.gt(q.field("createdAt"), since))
      .collect();

    return {
      total: notifications.length,
      sent: notifications.filter(n => n.sent).length,
      read: notifications.filter(n => n.read).length,
      pending: notifications.filter(n => !n.sent).length,
      byType: {
        system_alert: notifications.filter(n => n.type === "system_alert").length,
        credits_low: notifications.filter(n => n.type === "credits_low").length,
        search_completed: notifications.filter(n => n.type === "search_completed").length,
        plan_upgraded: notifications.filter(n => n.type === "plan_upgraded").length,
        email_sent: notifications.filter(n => n.type === "email_sent").length,
      },
    };
  },
});