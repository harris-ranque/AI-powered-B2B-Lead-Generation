import { internalMutation } from "../_generated/server";

// System health check (called by cron job)
export const systemHealthCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    try {
      // Check database connectivity
      const testQuery = await ctx.db.query("users").take(1);
      
      // Check for system issues
      const health = await ctx.runQuery("admin/metrics:getSystemHealth", {});
      
      // Log health status
      await ctx.db.insert("systemLogs", {
        type: "health_check",
        level: health.systemStatus === "healthy" ? "info" : "warning",
        message: `System health check: ${health.systemStatus}`,
        data: health,
        timestamp: now,
      });

      // Create alerts for issues
      if (health.systemStatus === "degraded") {
        await ctx.runMutation("notifications/internal:createSystemNotification", {
          title: "System Health Alert",
          message: `System is experiencing issues. Stuck searches: ${health.stuckSearches}, Error rate: ${health.errorRate * 100}%`,
          type: "system_alert",
          data: health,
        });
      }

      return { status: "completed", health };

    } catch (error) {
      await ctx.db.insert("systemLogs", {
        type: "health_check",
        level: "error",
        message: "Health check failed",
        data: { error: error instanceof Error ? error.message : "Unknown error" },
        timestamp: now,
      });

      return { status: "error", error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Clean up old logs
export const cleanupOldLogs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    const oldLogs = await ctx.db
      .query("systemLogs")
      .filter((q) => q.lt(q.field("timestamp"), thirtyDaysAgo))
      .collect();

    let deleted = 0;
    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
      deleted++;
    }

    return { deleted };
  },
});