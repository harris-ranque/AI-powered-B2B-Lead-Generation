import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Intelligent Rate Limiting System
 * 
 * Features:
 * - Multi-tier rate limits based on user plan
 * - Adaptive limits based on usage patterns
 * - Burst allowance for legitimate traffic spikes
 * - Sliding window rate limiting
 * - Automatic cooldown periods
 */

// Rate limit configurations by user plan and operation type
export const RATE_LIMITS = {
  free: {
    searches: { requests: 10, windowMs: 60 * 60 * 1000, burst: 3 }, // 10/hour, burst 3
    enrichment: { requests: 50, windowMs: 60 * 60 * 1000, burst: 10 }, // 50/hour, burst 10
    ai_analysis: { requests: 25, windowMs: 60 * 60 * 1000, burst: 5 }, // 25/hour, burst 5
    api_calls: { requests: 100, windowMs: 60 * 60 * 1000, burst: 20 }, // 100/hour, burst 20
  },
  pro: {
    searches: { requests: 100, windowMs: 60 * 60 * 1000, burst: 15 }, // 100/hour, burst 15
    enrichment: { requests: 500, windowMs: 60 * 60 * 1000, burst: 50 }, // 500/hour, burst 50
    ai_analysis: { requests: 250, windowMs: 60 * 60 * 1000, burst: 25 }, // 250/hour, burst 25
    api_calls: { requests: 1000, windowMs: 60 * 60 * 1000, burst: 100 }, // 1000/hour, burst 100
  },
  enterprise: {
    searches: { requests: 1000, windowMs: 60 * 60 * 1000, burst: 50 }, // 1000/hour, burst 50
    enrichment: { requests: 5000, windowMs: 60 * 60 * 1000, burst: 200 }, // 5000/hour, burst 200
    ai_analysis: { requests: 2500, windowMs: 60 * 60 * 1000, burst: 100 }, // 2500/hour, burst 100
    api_calls: { requests: 10000, windowMs: 60 * 60 * 1000, burst: 500 }, // 10000/hour, burst 500
  },
} as const;

// Admin override limits (much higher)
export const ADMIN_RATE_LIMITS = {
  searches: { requests: 10000, windowMs: 60 * 60 * 1000, burst: 500 },
  enrichment: { requests: 50000, windowMs: 60 * 60 * 1000, burst: 2000 },
  ai_analysis: { requests: 25000, windowMs: 60 * 60 * 1000, burst: 1000 },
  api_calls: { requests: 100000, windowMs: 60 * 60 * 1000, burst: 5000 },
} as const;

// Check if user is within rate limits
export const checkRateLimit = internalMutation({
  args: {
    userId: v.id("users"),
    operation: v.union(
      v.literal("searches"),
      v.literal("enrichment"), 
      v.literal("ai_analysis"),
      v.literal("api_calls")
    ),
    requestCount: v.optional(v.number()), // Default 1
  },
  handler: async (ctx, args) => {
    const requestCount = args.requestCount || 1;
    const now = Date.now();

    // Get user to determine plan and admin status
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get rate limit configuration
    const limits = user.role === "admin" 
      ? ADMIN_RATE_LIMITS[args.operation]
      : RATE_LIMITS[user.plan][args.operation];

    const windowStart = now - limits.windowMs;

    // Get recent requests in the current window
    const recentRequests = await ctx.db
      .query("rateLimitRecords")
      .withIndex("by_user_operation", (q) => 
        q.eq("userId", args.userId).eq("operation", args.operation)
      )
      .filter((q) => q.gte(q.field("timestamp"), windowStart))
      .collect();

    const currentUsage = recentRequests.reduce((sum, record) => sum + record.requestCount, 0);
    
    // Check if adding this request would exceed limits
    const wouldExceed = (currentUsage + requestCount) > limits.requests;
    
    // Check burst allowance (allow some requests above limit for short periods)
    const burstWindow = 5 * 60 * 1000; // 5 minutes
    const burstWindowStart = now - burstWindow;
    
    const recentBurstRequests = recentRequests.filter(
      record => record.timestamp >= burstWindowStart
    );
    const burstUsage = recentBurstRequests.reduce((sum, record) => sum + record.requestCount, 0);
    const wouldExceedBurst = (burstUsage + requestCount) > limits.burst;

    // Allow if within normal limits or within burst allowance
    const allowed = !wouldExceed || !wouldExceedBurst;

    if (allowed) {
      // Record the request
      await ctx.db.insert("rateLimitRecords", {
        userId: args.userId,
        operation: args.operation,
        requestCount,
        timestamp: now,
        windowStart,
        withinLimits: !wouldExceed,
        usedBurst: wouldExceed && !wouldExceedBurst,
      });
    } else {
      // Record the blocked request for analytics
      await ctx.db.insert("rateLimitViolations", {
        userId: args.userId,
        operation: args.operation,
        requestCount,
        currentUsage,
        limit: limits.requests,
        burstUsage,
        burstLimit: limits.burst,
        timestamp: now,
        userPlan: user.plan,
        isAdmin: user.role === "admin",
      });
    }

    // Calculate when user can make requests again
    const resetTime = allowed ? now : (windowStart + limits.windowMs);
    const remainingRequests = Math.max(0, limits.requests - currentUsage);

    return {
      allowed,
      currentUsage,
      limit: limits.requests,
      remainingRequests,
      resetTime,
      retryAfter: allowed ? 0 : Math.ceil((resetTime - now) / 1000), // seconds
      burstUsage,
      burstLimit: limits.burst,
      usedBurst: wouldExceed && !wouldExceedBurst,
    };
  },
});

// Get user's current rate limit status
export const getRateLimitStatus = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const status: Record<string, any> = {};

    // Check status for each operation type
    const operations = ["searches", "enrichment", "ai_analysis", "api_calls"] as const;
    
    for (const operation of operations) {
      const limits = user.role === "admin" 
        ? ADMIN_RATE_LIMITS[operation]
        : RATE_LIMITS[user.plan][operation];

      const windowStart = now - limits.windowMs;

      const recentRequests = await ctx.db
        .query("rateLimitRecords")
        .withIndex("by_user_operation", (q) => 
          q.eq("userId", args.userId).eq("operation", operation)
        )
        .filter((q) => q.gte(q.field("timestamp"), windowStart))
        .collect();

      const currentUsage = recentRequests.reduce((sum, record) => sum + record.requestCount, 0);
      const remainingRequests = Math.max(0, limits.requests - currentUsage);

      // Calculate burst usage
      const burstWindow = 5 * 60 * 1000; // 5 minutes
      const burstWindowStart = now - burstWindow;
      const burstRequests = recentRequests.filter(r => r.timestamp >= burstWindowStart);
      const burstUsage = burstRequests.reduce((sum, record) => sum + record.requestCount, 0);

      status[operation] = {
        limit: limits.requests,
        currentUsage,
        remainingRequests,
        resetTime: windowStart + limits.windowMs,
        burstLimit: limits.burst,
        burstUsage,
        utilizationPercent: Math.round((currentUsage / limits.requests) * 100),
      };
    }

    return {
      userId: args.userId,
      userPlan: user.plan,
      isAdmin: user.role === "admin",
      status,
      timestamp: now,
    };
  },
});

// Adaptive rate limiting - adjust limits based on user behavior
export const adjustAdaptiveLimits = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.role === "admin") {
      return { adjusted: false, reason: "Admin or user not found" };
    }

    const now = Date.now();
    const last24Hours = now - (24 * 60 * 60 * 1000);

    // Analyze usage patterns over last 24 hours
    const recentActivity = await ctx.db
      .query("rateLimitRecords")
      .withIndex("by_user_operation", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gte(q.field("timestamp"), last24Hours))
      .collect();

    const violations = await ctx.db
      .query("rateLimitViolations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gte(q.field("timestamp"), last24Hours))
      .collect();

    // Calculate usage patterns
    const totalRequests = recentActivity.reduce((sum, record) => sum + record.requestCount, 0);
    const violationCount = violations.length;
    const violationRate = totalRequests > 0 ? violationCount / totalRequests : 0;

    let adjustmentFactor = 1.0;
    let reason = "No adjustment needed";

    // Good behavior: consistent usage without violations
    if (totalRequests > 50 && violationRate < 0.05) {
      adjustmentFactor = 1.2; // 20% increase
      reason = "Good usage pattern - increased limits";
    }
    // Abusive behavior: frequent violations
    else if (violationRate > 0.2) {
      adjustmentFactor = 0.7; // 30% decrease
      reason = "High violation rate - decreased limits";
    }
    // Burst usage pattern: occasional high usage
    else if (violationRate > 0.1 && violationRate <= 0.2) {
      adjustmentFactor = 0.9; // 10% decrease
      reason = "Occasional violations - slightly decreased limits";
    }

    // Only apply adjustments for significant changes
    if (Math.abs(adjustmentFactor - 1.0) < 0.1) {
      return { adjusted: false, reason: "Adjustment too small" };
    }

    // Create or update adaptive limit record
    const existingLimit = await ctx.db
      .query("adaptiveRateLimits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const adaptiveLimits = {
      searches: Math.floor(RATE_LIMITS[user.plan].searches.requests * adjustmentFactor),
      enrichment: Math.floor(RATE_LIMITS[user.plan].enrichment.requests * adjustmentFactor),
      ai_analysis: Math.floor(RATE_LIMITS[user.plan].ai_analysis.requests * adjustmentFactor),
      api_calls: Math.floor(RATE_LIMITS[user.plan].api_calls.requests * adjustmentFactor),
    };

    if (existingLimit) {
      await ctx.db.patch(existingLimit._id, {
        limits: adaptiveLimits,
        adjustmentFactor,
        reason,
        lastUpdated: now,
        analysisWindow: { start: last24Hours, end: now },
        metrics: {
          totalRequests,
          violationCount,
          violationRate,
        },
      });
    } else {
      await ctx.db.insert("adaptiveRateLimits", {
        userId: args.userId,
        limits: adaptiveLimits,
        adjustmentFactor,
        reason,
        createdAt: now,
        lastUpdated: now,
        analysisWindow: { start: last24Hours, end: now },
        metrics: {
          totalRequests,
          violationCount,
          violationRate,
        },
      });
    }

    console.log(`Adjusted rate limits for user ${args.userId}: ${adjustmentFactor}x (${reason})`);

    return {
      adjusted: true,
      adjustmentFactor,
      reason,
      newLimits: adaptiveLimits,
      metrics: {
        totalRequests,
        violationCount,
        violationRate,
      },
    };
  },
});

// Cleanup old rate limit records
export const cleanupOldRecords = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago

    // Clean up old rate limit records
    const oldRecords = await ctx.db
      .query("rateLimitRecords")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .collect();

    let deletedRecords = 0;
    for (const record of oldRecords) {
      await ctx.db.delete(record._id);
      deletedRecords++;
    }

    // Clean up old violation records
    const oldViolations = await ctx.db
      .query("rateLimitViolations")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .collect();

    let deletedViolations = 0;
    for (const violation of oldViolations) {
      await ctx.db.delete(violation._id);
      deletedViolations++;
    }

    console.log(`Cleaned up ${deletedRecords} old rate limit records and ${deletedViolations} violations`);

    return {
      deletedRecords,
      deletedViolations,
    };
  },
});

// Rate limit analytics
export const getRateLimitAnalytics = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    timeRange: v.optional(v.object({
      start: v.number(),
      end: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const timeRange = args.timeRange || {
      start: now - (24 * 60 * 60 * 1000), // Last 24 hours
      end: now,
    };

    // Get records and violations with optional user filtering
    const records = args.userId 
      ? await ctx.db.query("rateLimitRecords")
          .withIndex("by_user_operation", (q) => q.eq("userId", args.userId!))
          .filter((q) => 
            q.and(
              q.gte(q.field("timestamp"), timeRange.start),
              q.lte(q.field("timestamp"), timeRange.end)
            )
          )
          .collect()
      : await ctx.db.query("rateLimitRecords")
          .filter((q) => 
            q.and(
              q.gte(q.field("timestamp"), timeRange.start),
              q.lte(q.field("timestamp"), timeRange.end)
            )
          )
          .collect();

    const violations = args.userId
      ? await ctx.db.query("rateLimitViolations")
          .withIndex("by_user", (q) => q.eq("userId", args.userId!))
          .filter((q) => 
            q.and(
              q.gte(q.field("timestamp"), timeRange.start),
              q.lte(q.field("timestamp"), timeRange.end)
            )
          )
          .collect()
      : await ctx.db.query("rateLimitViolations")
          .filter((q) => 
            q.and(
              q.gte(q.field("timestamp"), timeRange.start),
              q.lte(q.field("timestamp"), timeRange.end)
            )
          )
          .collect();


    // Aggregate statistics
    const stats = {
      totalRequests: records.reduce((sum, r) => sum + r.requestCount, 0),
      totalViolations: violations.length,
      violationRate: 0,
      byOperation: {} as Record<string, any>,
      byHour: {} as Record<string, any>,
      topUsers: {} as Record<string, any>,
    };

    stats.violationRate = stats.totalRequests > 0 
      ? stats.totalViolations / stats.totalRequests 
      : 0;

    // Group by operation
    for (const record of records) {
      if (!stats.byOperation[record.operation]) {
        stats.byOperation[record.operation] = {
          requests: 0,
          violations: 0,
          burstUsage: 0,
        };
      }
      stats.byOperation[record.operation].requests += record.requestCount;
      if (record.usedBurst) {
        stats.byOperation[record.operation].burstUsage += record.requestCount;
      }
    }

    for (const violation of violations) {
      if (!stats.byOperation[violation.operation]) {
        stats.byOperation[violation.operation] = {
          requests: 0,
          violations: 0,
          burstUsage: 0,
        };
      }
      stats.byOperation[violation.operation].violations++;
    }

    // Group by hour
    for (const record of records) {
      const hour = new Date(record.timestamp).toISOString().slice(0, 13);
      if (!stats.byHour[hour]) {
        stats.byHour[hour] = { requests: 0, violations: 0 };
      }
      stats.byHour[hour].requests += record.requestCount;
    }

    for (const violation of violations) {
      const hour = new Date(violation.timestamp).toISOString().slice(0, 13);
      if (!stats.byHour[hour]) {
        stats.byHour[hour] = { requests: 0, violations: 0 };
      }
      stats.byHour[hour].violations++;
    }

    // Top users (if not filtering by specific user)
    if (!args.userId) {
      const userStats: Record<string, { requests: number; violations: number }> = {};
      
      for (const record of records) {
        if (!userStats[record.userId]) {
          userStats[record.userId] = { requests: 0, violations: 0 };
        }
        userStats[record.userId]!.requests += record.requestCount;
      }

      for (const violation of violations) {
        if (!userStats[violation.userId]) {
          userStats[violation.userId] = { requests: 0, violations: 0 };
        }
        userStats[violation.userId]!.violations++;
      }

      // Sort by total activity
      stats.topUsers = Object.entries(userStats)
        .sort(([,a], [,b]) => (b.requests + b.violations) - (a.requests + a.violations))
        .slice(0, 10)
        .reduce((acc, [userId, data]) => {
          acc[userId] = data;
          return acc;
        }, {} as Record<string, any>);
    }

    return {
      timeRange,
      stats,
      recordCount: records.length,
      violationCount: violations.length,
    };
  },
});