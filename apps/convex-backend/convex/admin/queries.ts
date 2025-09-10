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

// Get all users for admin dashboard
export const getAllUsers = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    plan: v.optional(v.union(v.literal("starter"), v.literal("professional"), v.literal("business"), v.literal("enterprise"))),
    role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // Apply filters and get users
    let users;
    if (args.plan !== undefined) {
      const planFilter = args.plan;
      users = await ctx.db
        .query("users")
        .withIndex("by_plan", (q) => q.eq("plan", planFilter))
        .collect();
    } else if (args.role !== undefined) {
      const roleFilter = args.role;
      users = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", roleFilter))
        .collect();
    } else {
      users = await ctx.db.query("users").collect();
    }

    // Apply additional filters
    if (args.isActive !== undefined) {
      users = users.filter(user => user.isActive === args.isActive);
    }

    // Apply pagination
    const paginatedUsers = users.slice(offset, offset + limit);

    return {
      users: paginatedUsers,
      total: users.length,
      hasMore: offset + limit < users.length,
    };
  },
});

// Get analytics data
export const getAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    // Get user growth over time
    const users = await ctx.db.query("users").collect();
    const searches = await ctx.db.query("searches").collect();
    const transactions = await ctx.db.query("creditTransactions").collect();

    return {
      userGrowth: users.length,
      searchVolume: searches.length,
      revenueGrowth: transactions
        .filter(t => t.type === "purchase" && t.createdAt > thirtyDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0),
      engagement: {
        activeUsers: users.filter(u => u.isActive).length,
        averageSearchesPerUser: users.length > 0 ? searches.length / users.length : 0,
      },
    };
  },
});

// Get revenue statistics
export const getRevenueStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const transactions = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.eq(q.field("type"), "purchase"))
      .collect();

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    return {
      totalRevenue: transactions.reduce((sum, t) => sum + t.amount, 0),
      revenueThisMonth: transactions
        .filter(t => t.createdAt > thirtyDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0),
      revenueThisWeek: transactions
        .filter(t => t.createdAt > sevenDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0),
      transactionCount: transactions.length,
    };
  },
});

// Get usage statistics
export const getUsageStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const searches = await ctx.db.query("searches").collect();
    const leads = await ctx.db.query("leads").collect();
    const creditTransactions = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.eq(q.field("type"), "usage"))
      .collect();

    return {
      totalSearches: searches.length,
      totalLeads: leads.length,
      totalCreditsSpent: creditTransactions.reduce((sum, t) => sum + t.amount, 0),
      averageLeadsPerSearch: searches.length > 0 ? leads.length / searches.length : 0,
    };
  },
});

// Get system control status
export const getSystemControlStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    // Get current processing statistics
    const processingSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "processing"))
      .collect();

    const inProgressSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "in_progress"))
      .collect();

    const queuedSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    // Get orchestration settings from system config
    const orchestrationSettings = systemConfig?.orchestrationSettings || {
      leadGenerationEnabled: true, // Default to enabled if no config exists
      maintenanceMode: false,
      maxConcurrentSearches: 10,
      pauseReason: undefined,
      pausedAt: undefined,
      pausedBy: undefined,
    };

    return {
      maintenanceMode: orchestrationSettings.maintenanceMode,
      leadGenerationPaused: !orchestrationSettings.leadGenerationEnabled,
      orchestrationSettings,
      processingQueue: {
        processing: processingSearches.length + inProgressSearches.length,
        queued: queuedSearches.length,
        total: processingSearches.length + inProgressSearches.length + queuedSearches.length,
      },
      systemLoad: {
        status: processingSearches.length > 10 ? "high" : processingSearches.length > 5 ? "medium" : "low",
        activeProcesses: processingSearches.length + inProgressSearches.length,
      },
    };
  },
});

// Get system activity
export const getSystemActivity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 50;
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Get recent system logs
    const systemLogs = await ctx.db
      .query("systemLogs")
      .filter((q) => q.gte(q.field("timestamp"), oneHourAgo))
      .order("desc")
      .take(limit);

    // Get recent searches with their status
    const recentSearches = await ctx.db
      .query("searches")
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .order("desc")
      .take(limit);

    // Get recent failed operations
    const failedOperations = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .collect();

    return {
      systemLogs: systemLogs.map(log => ({
        id: log._id,
        type: log.type,
        action: log.action,
        timestamp: log.timestamp,
        data: log.data,
      })),
      recentSearches: recentSearches.map(search => ({
        id: search._id,
        userId: search.userId,
        status: search.status,
        createdAt: search._creationTime,
        name: search.name,
        parameters: search.parameters,
      })),
      failedOperations: failedOperations.length,
      activitySummary: {
        totalSearches: recentSearches.length,
        failedSearches: failedOperations.length,
        successRate: recentSearches.length > 0 
          ? Math.round(((recentSearches.length - failedOperations.length) / recentSearches.length) * 100)
          : 100,
      },
    };
  },
});

// Get system configuration
export const getSystemConfiguration = query({
  args: {},
  handler: async (ctx) => {
    // No auth required - this is used by system processes
    const systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    return systemConfig;
  },
});

// Get admin settings
export const getAdminSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    return {
      maintenanceMode: systemConfig?.orchestrationSettings?.maintenanceMode || false,
      registrationEnabled: true, // Not available in current schema
      maxDailySearches: 100, // Not available in current schema
      systemMessage: "", // Not available in current schema
      creditCosts: systemConfig?.creditCosts || null,
      planLimits: systemConfig?.planLimits || null,
      orchestrationSettings: systemConfig?.orchestrationSettings || null,
    };
  },
});

// Get recent credit transactions
export const getRecentCreditTransactions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 20;

    // Get recent credit transactions
    const transactions = await ctx.db
      .query("creditTransactions")
      .order("desc")
      .take(limit);

    // Get user information for each transaction
    const transactionsWithUsers = await Promise.all(
      transactions.map(async (transaction) => {
        const user = await ctx.db.get(transaction.userId);
        return {
          ...transaction,
          userEmail: user?.email || "Unknown",
          userName: user?.name || "Unknown User",
        };
      })
    );

    return transactionsWithUsers;
  },
});

// Get system status for admin monitoring
export const getSystemStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    try {
      // Get processing queue status
      const processingSearches = await ctx.db
        .query("searches")
        .filter((q) => q.eq(q.field("status"), "processing"))
        .collect();

      const queuedSearches = await ctx.db
        .query("searches")
        .filter((q) => q.eq(q.field("status"), "queued"))
        .collect();

      const failedSearches = await ctx.db
        .query("searches")
        .filter((q) => q.eq(q.field("status"), "failed"))
        .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
        .collect();

      // Check for stuck operations (processing for more than 30 minutes)
      const stuckSearches = processingSearches.filter(search => 
        (now - (search.lastOrchestrationAt || search.createdAt)) > (30 * 60 * 1000)
      );

      // Get system resource status
      const totalUsers = await ctx.db.query("users").collect().then(users => users.length);
      const activeUsers = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect()
        .then(users => users.length);

      // Check LangGraph worker status
      const recentLangGraphRequests = await ctx.db
        .query("langgraphRequests")
        .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
        .collect();

      const failedLangGraphRequests = recentLangGraphRequests.filter(req => req.status === "failed");

      // Determine overall system health
      let systemHealth: "healthy" | "degraded" | "critical";
      const issues = [];

      if (stuckSearches.length > 5 || failedSearches.length > 10) {
        systemHealth = "critical";
        if (stuckSearches.length > 5) issues.push(`${stuckSearches.length} stuck searches`);
        if (failedSearches.length > 10) issues.push(`${failedSearches.length} failed searches`);
      } else if (stuckSearches.length > 0 || failedSearches.length > 5) {
        systemHealth = "degraded";
        if (stuckSearches.length > 0) issues.push(`${stuckSearches.length} stuck searches`);
        if (failedSearches.length > 5) issues.push(`${failedSearches.length} failed searches`);
      } else {
        systemHealth = "healthy";
      }

      // Calculate success rates
      const searchSuccessRate = recentLangGraphRequests.length > 0
        ? Math.round(((recentLangGraphRequests.length - failedLangGraphRequests.length) / recentLangGraphRequests.length) * 100)
        : 100;

      return {
        systemHealth,
        issues,
        processing: {
          queuedSearches: queuedSearches.length,
          processingSearches: processingSearches.length,
          stuckSearches: stuckSearches.length,
          failedSearchesLastHour: failedSearches.length,
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          activePercentage: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
        },
        aiService: {
          requestsLastHour: recentLangGraphRequests.length,
          failedRequests: failedLangGraphRequests.length,
          successRate: searchSuccessRate,
        },
        timestamp: now,
      };
    } catch (error) {
      return {
        systemHealth: "critical" as const,
        issues: ["Unable to fetch system status"],
        processing: {
          queuedSearches: 0,
          processingSearches: 0,
          stuckSearches: 0,
          failedSearchesLastHour: 0,
        },
        users: {
          total: 0,
          active: 0,
          activePercentage: 0,
        },
        aiService: {
          requestsLastHour: 0,
          failedRequests: 0,
          successRate: 0,
        },
        timestamp: now,
      };
    }
  },
});