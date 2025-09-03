import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "../auth";

// Get admin metrics and statistics
export const getAdminMetrics = query({
  args: {},
  handler: async (ctx) => {
    // Require admin access
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    // Get user statistics
    const totalUsers = await ctx.db.query("users").collect().then(users => users.length);
    const activeUsers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect()
      .then(users => users.length);

    const newUsers7d = await ctx.db
      .query("users")
      .filter((q) => q.gte(q.field("createdAt"), sevenDaysAgo))
      .collect()
      .then(users => users.length);

    const newUsers30d = await ctx.db
      .query("users")
      .filter((q) => q.gte(q.field("createdAt"), thirtyDaysAgo))
      .collect()
      .then(users => users.length);

    // Get search statistics
    const totalSearches = await ctx.db.query("searches").collect().then(searches => searches.length);
    const completedSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect()
      .then(searches => searches.length);

    const searches7d = await ctx.db
      .query("searches")
      .filter((q) => q.gte(q.field("createdAt"), sevenDaysAgo))
      .collect()
      .then(searches => searches.length);

    const searches30d = await ctx.db
      .query("searches")
      .filter((q) => q.gte(q.field("createdAt"), thirtyDaysAgo))
      .collect()
      .then(searches => searches.length);

    // Get plan distribution
    const planDistribution = await ctx.db
      .query("users")
      .collect()
      .then(users => {
        const distribution = users.reduce((acc, user) => {
          acc[user.plan] = (acc[user.plan] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        return distribution;
      });

    // Get credit usage statistics
    const totalCreditsSpent = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.eq(q.field("type"), "usage"))
      .collect()
      .then(txs => txs.reduce((sum, tx) => sum + tx.amount, 0));

    const creditsSpent7d = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.eq(q.field("type"), "usage"))
      .filter((q) => q.gte(q.field("createdAt"), sevenDaysAgo))
      .collect()
      .then(txs => txs.reduce((sum, tx) => sum + tx.amount, 0));

    const creditsSpent30d = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.eq(q.field("type"), "usage"))
      .filter((q) => q.gte(q.field("createdAt"), thirtyDaysAgo))
      .collect()
      .then(txs => txs.reduce((sum, tx) => sum + tx.amount, 0));

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        new7d: newUsers7d,
        new30d: newUsers30d,
        planDistribution,
      },
      searches: {
        total: totalSearches,
        completed: completedSearches,
        completionRate: totalSearches > 0 ? (completedSearches / totalSearches * 100) : 0,
        new7d: searches7d,
        new30d: searches30d,
      },
      credits: {
        totalSpent: totalCreditsSpent,
        spent7d: creditsSpent7d,
        spent30d: creditsSpent30d,
        avgPerUser: totalUsers > 0 ? Math.round(totalCreditsSpent / totalUsers) : 0,
      },
      growth: {
        userGrowth7d: newUsers7d,
        userGrowth30d: newUsers30d,
        searchGrowth7d: searches7d,
        searchGrowth30d: searches30d,
      },
    };
  },
});

// Get recent system activity
export const getRecentActivity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 50;

    // Get recent searches
    const recentSearches = await ctx.db
      .query("searches")
      .order("desc")
      .take(limit);

    // Get recent user registrations
    const recentUsers = await ctx.db
      .query("users")
      .order("desc")
      .take(limit);

    // Get recent credit transactions
    const recentTransactions = await ctx.db
      .query("creditTransactions")
      .order("desc")
      .take(limit);

    return {
      searches: recentSearches,
      users: recentUsers,
      transactions: recentTransactions,
    };
  },
});

// Get system health metrics
export const getSystemHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Check for recent failures
    const failedSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .collect();

    const failedLangGraphRequests = await ctx.db
      .query("langgraphRequests")
      .filter((q) => q.eq(q.field("status"), "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .collect();

    // Check processing queue health
    const processingSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "processing"))
      .collect();

    const stuckSearches = processingSearches.filter(search => 
      (now - (search.lastOrchestrationAt || search.createdAt)) > (30 * 60 * 1000) // Stuck for more than 30 minutes
    );

    return {
      status: stuckSearches.length > 0 ? "degraded" : "healthy",
      failures: {
        searches: failedSearches.length,
        langGraphRequests: failedLangGraphRequests.length,
      },
      processing: {
        activeSearches: processingSearches.length,
        stuckSearches: stuckSearches.length,
      },
      timestamp: now,
    };
  },
});