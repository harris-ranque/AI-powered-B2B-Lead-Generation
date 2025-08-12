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

    // Get all users for distribution calculation
    const allUsers = await ctx.db.query("users").collect();
    const freeUsers = allUsers.filter(u => u.plan === "free").length;
    const proUsers = allUsers.filter(u => u.plan === "pro").length;
    const enterpriseUsers = allUsers.filter(u => u.plan === "enterprise").length;

    // Calculate completion times for completed searches
    const completedSearches = searches.filter(s => s.completedAt && s.startedAt);
    const avgSearchCompletionTime = completedSearches.length > 0 
      ? completedSearches.reduce((sum, s) => sum + (s.completedAt! - s.startedAt!), 0) / completedSearches.length
      : 0;

    // Calculate metrics according to schema
    const metricsData = {
      date: yesterday.toISOString().split('T')[0] as string,
      metrics: {
        totalUsers: allUsers.length,
        newUsers: users.length,
        activeUsers: allUsers.filter(u => u.isActive).length,
        freeUsers,
        proUsers,
        enterpriseUsers,
        totalSearches: searches.length,
        totalLeads: leads.length,
        totalEmails: emailSequences.length,
        totalCreditsUsed: creditTransactions
          .filter(t => t.amount < 0)
          .reduce((sum, t) => sum + Math.abs(t.amount), 0),
        totalRevenue: 0, // Would need billing data
        newRevenue: 0,   // Would need billing data
        avgRelevanceScore: leads.length > 0 
          ? leads.filter(l => l.aiAnalysis?.relevanceScore).reduce((sum, l) => sum + (l.aiAnalysis?.relevanceScore || 0), 0) / leads.length
          : 0,
        avgProcessingTime: avgSearchCompletionTime,
        errorRate: searches.length > 0 
          ? searches.filter(s => s.status === "failed").length / searches.length
          : 0,
      },
      createdAt: Date.now(),
    };

    // Store metrics
    await ctx.db.insert("adminMetrics", metricsData);

    return metricsData;
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