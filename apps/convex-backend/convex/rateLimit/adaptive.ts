import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Adaptive Rate Limiting System
 * 
 * Automatically adjusts rate limits based on user behavior patterns:
 * - Rewards good behavior with increased limits
 * - Penalizes abuse with decreased limits
 * - Learns from usage patterns over time
 */

// Process adaptive rate limits for all users
export const processAdaptiveLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("Processing adaptive rate limits for all users");

    const now = Date.now();
    const last24Hours = now - (24 * 60 * 60 * 1000);

    // Get all active users (exclude those updated in last 6 hours to avoid too frequent changes)
    const lastProcessed = now - (6 * 60 * 60 * 1000);
    
    const usersToProcess = await ctx.db
      .query("users")
      .filter((q) => 
        q.and(
          q.eq(q.field("isActive"), true),
          q.neq(q.field("role"), "admin") // Skip admins
        )
      )
      .collect();

    // Filter out recently processed users
    const existingLimits = await ctx.db
      .query("adaptiveRateLimits")
      .filter((q) => q.gte(q.field("lastUpdated"), lastProcessed))
      .collect();

    const recentlyProcessedUserIds = new Set(existingLimits.map(limit => limit.userId));
    
    const usersNeedingProcessing = usersToProcess.filter(
      user => !recentlyProcessedUserIds.has(user._id)
    );

    let processed = 0;
    let adjusted = 0;
    const results = [];

    for (const user of usersNeedingProcessing) {
      try {
        const result = await ctx.runMutation(internal.rateLimit.internal.adjustAdaptiveLimits, {
          userId: user._id,
        });

        if (result.adjusted) {
          adjusted++;
        }

        results.push({
          userId: user._id,
          ...result,
        });

        processed++;

      } catch (error) {
        console.error(`Failed to process adaptive limits for user ${user._id}:`, error);
        results.push({
          userId: user._id,
          adjusted: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    console.log(`Processed ${processed} users, adjusted ${adjusted} rate limits`);

    return {
      totalUsers: usersToProcess.length,
      processed,
      adjusted,
      skippedRecentlyProcessed: recentlyProcessedUserIds.size,
      results: results.slice(0, 10), // Return first 10 for logging
    };
  },
});

// Get adaptive rate limit recommendations
export const getAdaptiveRecommendations = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const lookbackDays = args.lookbackDays || 7;
    const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const windowStart = now - lookbackMs;

    let usersToAnalyze;
    
    if (args.userId) {
      const user = await ctx.db.get(args.userId);
      usersToAnalyze = user ? [user] : [];
    } else {
      // Analyze top 50 most active users
      usersToAnalyze = await ctx.db
        .query("users")
        .filter((q) => 
          q.and(
            q.eq(q.field("isActive"), true),
            q.neq(q.field("role"), "admin")
          )
        )
        .take(50);
    }

    const recommendations = [];

    for (const user of usersToAnalyze) {
      // Get usage activity in the lookback window
      const activity = await ctx.db
        .query("rateLimitRecords")
        .withIndex("by_user_operation", (q) => q.eq("userId", user._id))
        .filter((q) => q.gte(q.field("timestamp"), windowStart))
        .collect();

      const violations = await ctx.db
        .query("rateLimitViolations")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .filter((q) => q.gte(q.field("timestamp"), windowStart))
        .collect();

      // Get current adaptive limits
      const currentLimits = await ctx.db
        .query("adaptiveRateLimits")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();

      // Analyze patterns
      const totalRequests = activity.reduce((sum, record) => sum + record.requestCount, 0);
      const violationCount = violations.length;
      const violationRate = totalRequests > 0 ? violationCount / totalRequests : 0;

      // Usage by operation
      const operationStats: Record<string, { requests: number; violations: number; avgDaily: number }> = {};
      
      for (const record of activity) {
        if (!operationStats[record.operation]) {
          operationStats[record.operation] = { requests: 0, violations: 0, avgDaily: 0 };
        }
        operationStats[record.operation]!.requests += record.requestCount;
      }

      for (const violation of violations) {
        if (!operationStats[violation.operation]) {
          operationStats[violation.operation] = { requests: 0, violations: 0, avgDaily: 0 };
        }
        operationStats[violation.operation]!.violations++;
      }

      // Calculate average daily usage
      for (const op in operationStats) {
        operationStats[op]!.avgDaily = operationStats[op]!.requests / lookbackDays;
      }

      // Generate recommendations
      let recommendation = "maintain";
      let recommendedAdjustment = 1.0;
      let reasoning = [];

      if (totalRequests === 0) {
        recommendation = "maintain";
        reasoning.push("No recent activity");
      } else if (violationRate === 0 && totalRequests > 20) {
        recommendation = "increase";
        recommendedAdjustment = 1.2;
        reasoning.push("Consistent usage with no violations");
      } else if (violationRate > 0.15) {
        recommendation = "decrease";
        recommendedAdjustment = 0.8;
        reasoning.push(`High violation rate: ${(violationRate * 100).toFixed(1)}%`);
      } else if (violationRate > 0.05 && violationRate <= 0.15) {
        recommendation = "slight_decrease";
        recommendedAdjustment = 0.95;
        reasoning.push(`Moderate violation rate: ${(violationRate * 100).toFixed(1)}%`);
      }

      // Check for unusual patterns
      const burstActivity = activity.filter(record => record.usedBurst);
      if (burstActivity.length > 0) {
        const burstRate = burstActivity.length / activity.length;
        if (burstRate > 0.3) {
          reasoning.push(`High burst usage: ${(burstRate * 100).toFixed(1)}% of requests`);
          if (recommendedAdjustment > 0.9) {
            recommendedAdjustment = 0.9;
            recommendation = "decrease";
          }
        }
      }

      recommendations.push({
        userId: user._id,
        userPlan: user.plan,
        analysisWindow: { start: windowStart, end: now },
        currentLimits: currentLimits?.limits,
        currentAdjustment: currentLimits?.adjustmentFactor || 1.0,
        recommendation,
        recommendedAdjustment,
        reasoning,
        metrics: {
          totalRequests,
          violationCount,
          violationRate,
          burstUsageRate: burstActivity.length / Math.max(activity.length, 1),
          avgDailyRequests: totalRequests / lookbackDays,
        },
        operationStats,
        lastLimitUpdate: currentLimits?.lastUpdated,
      });
    }

    return {
      analysisWindow: { start: windowStart, end: now },
      lookbackDays,
      userCount: recommendations.length,
      recommendations: recommendations.sort((a, b) => 
        (b.metrics.totalRequests + b.metrics.violationCount) - 
        (a.metrics.totalRequests + a.metrics.violationCount)
      ),
    };
  },
});

// Manual adjustment of adaptive limits (admin function)
export const manualAdjustAdaptiveLimits = internalMutation({
  args: {
    userId: v.id("users"),
    adjustmentFactor: v.number(),
    reason: v.string(),
    expiresAt: v.optional(v.number()), // Optional expiration
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Validate adjustment factor
    if (args.adjustmentFactor < 0.1 || args.adjustmentFactor > 5.0) {
      throw new Error("Adjustment factor must be between 0.1 and 5.0");
    }

    const now = Date.now();

    // Calculate new limits based on base plan limits
    const baseLimits = {
      free: {
        searches: 10,
        enrichment: 50,
        ai_analysis: 25,
        api_calls: 100,
      },
      pro: {
        searches: 100,
        enrichment: 500,
        ai_analysis: 250,
        api_calls: 1000,
      },
      enterprise: {
        searches: 1000,
        enrichment: 5000,
        ai_analysis: 2500,
        api_calls: 10000,
      },
    };

    const baseLimit = baseLimits[user.plan];
    const adaptiveLimits = {
      searches: Math.floor(baseLimit.searches * args.adjustmentFactor),
      enrichment: Math.floor(baseLimit.enrichment * args.adjustmentFactor),
      ai_analysis: Math.floor(baseLimit.ai_analysis * args.adjustmentFactor),
      api_calls: Math.floor(baseLimit.api_calls * args.adjustmentFactor),
    };

    // Find existing adaptive limit record
    const existingLimit = await ctx.db
      .query("adaptiveRateLimits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const limitData = {
      userId: args.userId,
      limits: adaptiveLimits,
      adjustmentFactor: args.adjustmentFactor,
      reason: `Manual adjustment: ${args.reason}`,
      lastUpdated: now,
      analysisWindow: { start: now, end: now },
      metrics: {
        totalRequests: 0,
        violationCount: 0,
        violationRate: 0,
      },
      ...(args.expiresAt && { expiresAt: args.expiresAt }),
      isManual: true,
    };

    if (existingLimit) {
      await ctx.db.patch(existingLimit._id, limitData);
    } else {
      await ctx.db.insert("adaptiveRateLimits", {
        ...limitData,
        createdAt: now,
      });
    }

    // Log the manual adjustment
    await ctx.db.insert("systemLogs", {
      type: "adaptive_rate_limit",
      action: "manual_adjustment",
      userId: args.userId,
      data: {
        adjustmentFactor: args.adjustmentFactor,
        reason: args.reason,
        newLimits: adaptiveLimits,
        expiresAt: args.expiresAt,
      },
      timestamp: now,
    });

    console.log(`Manual adaptive limit adjustment for user ${args.userId}: ${args.adjustmentFactor}x (${args.reason})`);

    return {
      success: true,
      newLimits: adaptiveLimits,
      adjustmentFactor: args.adjustmentFactor,
      expiresAt: args.expiresAt,
    };
  },
});

// Reset adaptive limits to plan defaults
export const resetAdaptiveLimits = internalMutation({
  args: {
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const existingLimit = await ctx.db
      .query("adaptiveRateLimits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existingLimit) {
      await ctx.db.delete(existingLimit._id);
    }

    // Log the reset
    await ctx.db.insert("systemLogs", {
      type: "adaptive_rate_limit",
      action: "reset_to_defaults",
      userId: args.userId,
      data: {
        reason: args.reason,
        previousLimits: existingLimit?.limits,
        previousAdjustment: existingLimit?.adjustmentFactor,
      },
      timestamp: Date.now(),
    });

    console.log(`Reset adaptive limits for user ${args.userId}: ${args.reason}`);

    return {
      success: true,
      resetToDefaults: true,
    };
  },
});