import { internalMutation } from "../_generated/server";

// System health check (called by cron job)
export const systemHealthCheck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    try {
      // Check database connectivity
      const testQuery = await ctx.db.query("users").take(1);
      
      // Basic health check without external function calls
      const searches = await ctx.db.query("searches").collect();
      const stuckSearches = searches.filter(s => 
        s.status === "in_progress" && 
        s.startedAt && 
        (now - s.startedAt) > (30 * 60 * 1000) // 30 minutes
      ).length;
      
      const errorRate = searches.length > 0 
        ? searches.filter(s => s.status === "failed").length / searches.length
        : 0;

      const health = {
        systemStatus: stuckSearches > 0 || errorRate > 0.1 ? "degraded" : "healthy",
        stuckSearches,
        errorRate,
        totalSearches: searches.length,
        timestamp: now,
      };

      // Get admin user for logging
      const adminUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("role"), "admin"))
        .first();

      if (adminUser) {
        // Log health status
        await ctx.db.insert("systemLogs", {
          type: "health_check",
          action: `System health check: ${health.systemStatus}`,
          userId: adminUser._id,
          data: health,
          timestamp: now,
        });
      }

      return { status: "completed", health };

    } catch (error) {
      const adminUser = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("role"), "admin"))
        .first();

      if (adminUser) {
        await ctx.db.insert("systemLogs", {
          type: "health_check",
          action: "Health check failed",
          userId: adminUser._id,
          data: { error: error instanceof Error ? error.message : "Unknown error" },
          timestamp: now,
        });
      }

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