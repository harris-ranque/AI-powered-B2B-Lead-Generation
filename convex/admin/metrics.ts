import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Calculate daily metrics (called by cron job)
export const calculateDailyMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    
    const yesterday = new Date(todayTime - 24 * 60 * 60 * 1000);
    const yesterdayTime = yesterday.getTime();

    // Calculate metrics for yesterday
    const searches = await ctx.db
      .query("searches")
      .filter((q) => q.and(
        q.gte(q.field("createdAt"), yesterdayTime),
        q.lt(q.field("createdAt"), todayTime)
      ))
      .collect();

    const users = await ctx.db
      .query("users")
      .filter((q) => q.and(
        q.gte(q.field("createdAt"), yesterdayTime),
        q.lt(q.field("createdAt"), todayTime)
      ))
      .collect();

    const leads = await ctx.db
      .query("leads")
      .filter((q) => q.and(
        q.gte(q.field("createdAt"), yesterdayTime),
        q.lt(q.field("createdAt"), todayTime)
      ))
      .collect();

    const emailSequences = await ctx.db
      .query("emailSequences")
      .filter((q) => q.and(
        q.gte(q.field("createdAt"), yesterdayTime),
        q.lt(q.field("createdAt"), todayTime)
      ))
      .collect();

    const creditTransactions = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.and(
        q.gte(q.field("createdAt"), yesterdayTime),
        q.lt(q.field("createdAt"), todayTime)
      ))
      .collect();

    // Calculate metrics
    const metrics = {
      date: yesterday.toISOString().split('T')[0],
      newUsers: users.length,
      totalSearches: searches.length,
      completedSearches: searches.filter(s => s.status === "completed").length,
      totalLeads: leads.length,
      enrichedLeads: leads.filter(l => l.enrichmentStatus === "completed").length,
      emailsGenerated: emailSequences.length,
      creditsUsed: creditTransactions
        .filter(t => t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
      creditsAdded: creditTransactions
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0),
      avgSearchCompletionTime: searches.length > 0 
        ? searches
            .filter(s => s.completedAt && s.startedAt)
            .reduce((sum, s, _, arr) => sum + (s.completedAt - s.startedAt) / arr.length, 0)
        : 0,
      createdAt: Date.now(),
    };

    // Store metrics
    await ctx.db.insert("adminMetrics", metrics);

    return metrics;
  },
});

// Get metrics for a date range
export const getMetrics = internalQuery({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("adminMetrics")
      .withIndex("by_date", (q) => q.gte("date", args.startDate).lte("date", args.endDate))
      .order("desc")
      .collect();
  },
});

// Get system health metrics
export const getSystemHealth = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Check for stuck searches
    const stuckSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .filter((q) => q.lt(q.field("startedAt"), oneHourAgo))
      .collect();

    // Check error rates
    const recentSearches = await ctx.db
      .query("searches")
      .filter((q) => q.gt(q.field("createdAt"), oneDayAgo))
      .collect();

    const failedSearches = recentSearches.filter(s => s.status === "failed");
    const errorRate = recentSearches.length > 0 
      ? failedSearches.length / recentSearches.length 
      : 0;

    // Check active users
    const activeUsers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return {
      stuckSearches: stuckSearches.length,
      errorRate: Math.round(errorRate * 100) / 100,
      activeUsers: activeUsers.length,
      totalUsers: activeUsers.length, // Could be expanded to include inactive
      systemStatus: stuckSearches.length > 10 || errorRate > 0.1 ? "degraded" : "healthy",
      lastCheck: now,
    };
  },
});