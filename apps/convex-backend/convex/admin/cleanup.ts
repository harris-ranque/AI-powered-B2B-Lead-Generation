import { internalMutation } from "../_generated/server";

// Clean up old data (called by cron job)
export const cleanupOldData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let totalDeleted = 0;

    // Clean up old system logs (older than 30 days)
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const oldLogs = await ctx.db
      .query("systemLogs")
      .filter((q) => q.lt(q.field("timestamp"), thirtyDaysAgo))
      .collect();

    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
      totalDeleted++;
    }

    // Clean up old admin metrics (older than 1 year)
    const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
    const oldMetrics = await ctx.db
      .query("adminMetrics")
      .filter((q) => q.lt(q.field("createdAt"), oneYearAgo))
      .collect();

    for (const metric of oldMetrics) {
      await ctx.db.delete(metric._id);
      totalDeleted++;
    }

    // Clean up old notifications (read and older than 90 days)
    const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
    const oldNotifications = await ctx.db
      .query("notifications")
      .filter((q) => q.and(
        q.eq(q.field("read"), true),
        q.lt(q.field("createdAt"), ninetyDaysAgo)
      ))
      .collect();

    for (const notification of oldNotifications) {
      await ctx.db.delete(notification._id);
      totalDeleted++;
    }

    // Clean up old credit transactions (older than 2 years for tax purposes)
    const twoYearsAgo = now - (2 * 365 * 24 * 60 * 60 * 1000);
    const oldTransactions = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.lt(q.field("createdAt"), twoYearsAgo))
      .collect();

    for (const transaction of oldTransactions) {
      await ctx.db.delete(transaction._id);
      totalDeleted++;
    }

    // Log cleanup results
    const adminUserId = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();

    if (adminUserId) {
      await ctx.db.insert("systemLogs", {
        type: "cleanup",
        action: `Cleanup completed: ${totalDeleted} records deleted`,
        userId: adminUserId._id,
        data: {
          logsDeleted: oldLogs.length,
          metricsDeleted: oldMetrics.length,
          notificationsDeleted: oldNotifications.length,
          transactionsDeleted: oldTransactions.length,
        },
        timestamp: now,
      });
    }

    return {
      totalDeleted,
      logsDeleted: oldLogs.length,
      metricsDeleted: oldMetrics.length,
      notificationsDeleted: oldNotifications.length,
      transactionsDeleted: oldTransactions.length,
    };
  },
});