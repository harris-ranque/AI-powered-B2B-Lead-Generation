import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError, isAdmin } from "../lib/helpers";

// Get admin metrics for dashboard overview
export const getAdminMetrics = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    // Get user statistics
    const users = await ctx.db.query("users").collect();
    const activeUsers = users.filter(u => u.isActive);
    const newUsersThisMonth = users.filter(u => u.createdAt > thirtyDaysAgo);

    // Get search statistics
    const searches = await ctx.db.query("searches").collect();
    const recentSearches = searches.filter(s => s.createdAt > thirtyDaysAgo);
    const completedSearches = searches.filter(s => s.status === "completed");

    // Get credit transactions
    const creditTransactions = await ctx.db.query("creditTransactions").collect();
    const recentTransactions = creditTransactions.filter(t => t.createdAt > thirtyDaysAgo);

    return {
      totalUsers: users.length,
      activeUsers: activeUsers.length,
      newUsersThisMonth: newUsersThisMonth.length,
      totalSearches: searches.length,
      recentSearches: recentSearches.length,
      completedSearches: completedSearches.length,
      totalTransactions: creditTransactions.length,
      recentTransactions: recentTransactions.length,
    };
  },
});

// Get system health metrics
export const getSystemHealth = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();

    // Check for stuck searches (in progress for >30 minutes)
    const searches = await ctx.db.query("searches").collect();
    const stuckSearches = searches.filter(s => 
      s.status === "in_progress" && 
      s.startedAt && 
      (now - s.startedAt) > (30 * 60 * 1000)
    ).length;

    // Calculate error rates
    const recentSearches = searches.filter(s => s.createdAt > now - (24 * 60 * 60 * 1000));
    const failedSearches = recentSearches.filter(s => s.status === "failed").length;
    const errorRate = recentSearches.length > 0 ? (failedSearches / recentSearches.length) * 100 : 0;

    // System uptime (simplified - based on recent activity)
    const recentActivity = searches.filter(s => s.createdAt > now - (60 * 60 * 1000)).length;
    const apiUptime = recentActivity > 0 ? 99.9 : 95.0; // Simplified metric

    // Queue health (based on batch processing)
    const batchPlans = await ctx.db.query("batchPlans").collect();
    const queueHealth = batchPlans.length < 100 ? 100 : Math.max(0, 100 - (batchPlans.length - 100));

    // Average response time (simplified estimation)
    const avgResponseTime = errorRate > 10 ? 2000 : errorRate > 5 ? 1000 : 500;

    return {
      apiUptime,
      queueHealth,
      errorRate,
      avgResponseTime,
      stuckSearches,
      activeQueues: batchPlans.length,
    };
  },
});

// Get all users for user management
export const getAllUsers = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    const users = await ctx.db
      .query("users")
      .order("desc")
      .collect();

    // Apply pagination
    const paginatedUsers = users.slice(offset, offset + limit);

    // Transform to match expected interface
    return paginatedUsers.map(user => ({
      id: user._id,
      email: user.email,
      name: user.name || 'Unknown',
      plan: user.plan,
      status: user.isActive ? 'active' : 'inactive',
      creditsRemaining: user.credits,
      totalSpent: 0, // TODO: Calculate from credit transactions
      lastLogin: new Date(user.updatedAt).toISOString(),
      signupDate: new Date(user.createdAt).toISOString(),
      searchesThisMonth: 0, // TODO: Calculate from searches
      leadsGenerated: 0, // TODO: Calculate from leads
    }));
  },
});

// Get analytics data
export const getAnalytics = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

    // Get searches
    const searches = await ctx.db.query("searches").collect();
    const searchesToday = searches.filter(s => s.createdAt > oneDayAgo).length;

    // Get leads
    const leads = await ctx.db.query("leads").collect();
    const leadsGenerated = leads.length;

    // Get completed email requests (from LangGraph)
    const emailRequests = await ctx.db
      .query("langgraphRequests")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();
    const emailsGenerated = emailRequests.length;

    // Calculate average response rate (placeholder)
    const averageResponseRate = 12.5; // TODO: Calculate from actual data

    return {
      searchesDaily: searchesToday,
      leadsGenerated,
      emailsGenerated,
      averageResponseRate,
    };
  },
});

// Get revenue statistics
export const getRevenueStats = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // TODO: Implement actual revenue calculation from Stripe data
    // For now, return placeholder data
    return {
      totalRevenue: 15750,
      monthlyRevenue: 3250,
      averageRevenuePerUser: 45,
    };
  },
});

// Get usage statistics
export const getUsageStats = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

    // Get credit usage
    const creditTransactions = await ctx.db.query("creditTransactions").collect();
    const recentTransactions = creditTransactions.filter(t => t.createdAt > oneMonthAgo);
    
    const creditsSpent = recentTransactions
      .filter(t => t.type === "usage")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return {
      creditsSpentThisMonth: creditsSpent,
      averageCreditsPerSearch: 15, // TODO: Calculate from actual data
      totalApiCalls: recentTransactions.length,
    };
  },
});

// Get system status for monitoring
export const getSystemStatus = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    
    // Get system control state
    const systemControlState = await ctx.db
      .query("systemControlState")
      .unique();

    // Check for recent activity
    const recentSearches = await ctx.db
      .query("searches")
      .filter((q) => q.gt(q.field("createdAt"), now - (60 * 60 * 1000))) // Last hour
      .collect();

    // Check error rates from recent searches
    const failedSearches = recentSearches.filter(s => s.status === "failed").length;
    const errorRate = recentSearches.length > 0 ? (failedSearches / recentSearches.length) * 100 : 0;

    // System health based on activity and error rates
    let health: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (errorRate > 20) {
      health = 'critical';
    } else if (errorRate > 10 || systemControlState?.systemPaused) {
      health = 'warning';
    }

    return {
      systemPaused: systemControlState?.systemPaused || false,
      leadGenerationDisabled: systemControlState?.leadGenerationDisabled || false,
      maintenanceMode: systemControlState?.maintenanceMode || false,
      health,
      errorRate,
      recentActivity: recentSearches.length,
      uptime: 99.9, // Simplified metric
      lastUpdate: now,
    };
  },
});

// Get admin settings
export const getAdminSettings = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // TODO: Implement actual settings storage
    return {
      maintenanceMode: false,
      systemNotifications: true,
      debugMode: false,
      rateLimitEnabled: true,
    };
  },
});
