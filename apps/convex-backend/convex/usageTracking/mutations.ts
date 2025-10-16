import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api } from "../_generated/api";

// Get current billing period dates
function getCurrentBillingPeriod(periodStart: number, periodEnd: number) {
  const now = Date.now();

  if (now >= periodStart && now <= periodEnd) {
    return { start: periodStart, end: periodEnd };
  }

  // Calculate next period if current period has ended
  const periodLength = periodEnd - periodStart;
  const periodsSinceStart = Math.floor((now - periodStart) / periodLength);

  return {
    start: periodStart + periodsSinceStart * periodLength,
    end: periodStart + (periodsSinceStart + 1) * periodLength,
  };
}

// Initialize usage tracking for a user
export const initializeUsageTracking = mutation({
  args: {
    userId: v.id("users"),
    billingPeriodStart: v.number(),
    billingPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if current period tracking already exists
    const existing = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (existing) {
      return { success: true, existingRecord: true };
    }

    await ctx.db.insert("usageTracking", {
      userId: args.userId,
      billingPeriodStart: args.billingPeriodStart,
      billingPeriodEnd: args.billingPeriodEnd,
      searchesUsed: 0,
      leadsEnriched: 0,
      emailsGenerated: 0,
      exportsCompleted: 0,
      apiCallsMade: 0,
      creditsUsed: 0,
      isCurrentPeriod: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true, existingRecord: false };
  },
});

// Track search usage
export const trackSearchUsage = mutation({
  args: {
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    leadsDiscovered: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get user's billing period
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const billingPeriod = billing
      ? getCurrentBillingPeriod(
          billing.currentPeriodStart,
          billing.currentPeriodEnd,
        )
      : { start: Date.now(), end: Date.now() + 30 * 24 * 60 * 60 * 1000 }; // 30 days default

    // Get or create current usage tracking
    let usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (!usage) {
      // Initialize if doesn't exist
      await ctx.runMutation(
        api.usageTracking.mutations.initializeUsageTracking,
        {
          userId: args.userId,
          billingPeriodStart: billingPeriod.start,
          billingPeriodEnd: billingPeriod.end,
        },
      );

      usage = await ctx.db
        .query("usageTracking")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
        .unique();
    }

    if (!usage) {
      throw new Error("Failed to initialize usage tracking");
    }

    // Update usage
    await ctx.db.patch(usage._id, {
      searchesUsed: usage.searchesUsed + 1,
      leadsEnriched: usage.leadsEnriched + (args.leadsDiscovered || 0),
      updatedAt: Date.now(),
    });

    return { success: true, newUsage: { searches: usage.searchesUsed + 1 } };
  },
});

// Track email generation usage
export const trackEmailUsage = mutation({
  args: {
    userId: v.id("users"),
    emailCount: v.number(),
  },
  handler: async (ctx, args) => {
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (!usage) {
      throw new Error("Usage tracking not initialized");
    }

    await ctx.db.patch(usage._id, {
      emailsGenerated: usage.emailsGenerated + args.emailCount,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Track export usage
export const trackExportUsage = mutation({
  args: {
    userId: v.id("users"),
    exportType: v.string(),
    recordCount: v.number(),
  },
  handler: async (ctx, args) => {
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (!usage) {
      throw new Error("Usage tracking not initialized");
    }

    await ctx.db.patch(usage._id, {
      exportsCompleted: usage.exportsCompleted + 1,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Track API call usage
export const trackApiCallUsage = mutation({
  args: {
    userId: v.id("users"),
    service: v.string(),
    callCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (!usage) {
      throw new Error("Usage tracking not initialized");
    }

    await ctx.db.patch(usage._id, {
      apiCallsMade: usage.apiCallsMade + (args.callCount || 1),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Check usage limits before operation
export const checkUsageLimits = mutation({
  args: {
    userId: v.id("users"),
    operation: v.union(
      v.literal("search"),
      v.literal("email_generation"),
      v.literal("export"),
      v.literal("api_call"),
    ),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get billing info with limits
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (!billing) {
      // For users without billing (starter tier), use basic limits
      const starterLimits = {
        monthlySearches: 10,
        monthlyEnrichments: 500,
        monthlyExports: 10,
        emailGeneration: false,
      };

      const usage = await ctx.db
        .query("usageTracking")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
        .unique();

      if (!usage) {
        return {
          allowed: true,
          reason: "No usage tracking found",
          limits: starterLimits,
          usage: { searchesUsed: 0, emailsGenerated: 0, exportsCompleted: 0 },
        };
      }

      // Check limits based on operation
      switch (args.operation) {
        case "search":
          if (usage.searchesUsed >= starterLimits.monthlySearches) {
            return {
              allowed: false,
              reason: `Monthly search limit of ${starterLimits.monthlySearches} reached`,
              limits: starterLimits,
              usage,
            };
          }
          break;
        case "email_generation":
          if (!starterLimits.emailGeneration) {
            return {
              allowed: false,
              reason: "Email generation not available on Starter tier",
              limits: starterLimits,
              usage,
            };
          }
          break;
        case "export":
          if (usage.exportsCompleted >= starterLimits.monthlyExports) {
            return {
              allowed: false,
              reason: `Monthly export limit of ${starterLimits.monthlyExports} reached`,
              limits: starterLimits,
              usage,
            };
          }
          break;
      }

      return {
        allowed: true,
        limits: starterLimits,
        usage,
      };
    }

    // For paid tiers, check against billing limits
    const limits = billing.planLimits;
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (!usage) {
      return {
        allowed: true,
        reason: "No usage tracking found",
        limits,
        usage: { searchesUsed: 0, emailsGenerated: 0, exportsCompleted: 0 },
      };
    }

    const requestCount = args.count || 1;

    // Check limits based on operation and plan
    switch (args.operation) {
      case "search":
        if (
          limits.monthlySearches !== -1 &&
          usage.searchesUsed + requestCount > limits.monthlySearches
        ) {
          return {
            allowed: false,
            reason: `Monthly search limit of ${limits.monthlySearches} would be exceeded`,
            limits,
            usage,
          };
        }
        break;
      case "email_generation":
        if (!limits.emailGeneration) {
          return {
            allowed: false,
            reason: "Email generation not available on your plan",
            limits,
            usage,
          };
        }
        break;
      case "export":
        if (
          limits.monthlyExports !== -1 &&
          usage.exportsCompleted + requestCount > limits.monthlyExports
        ) {
          return {
            allowed: false,
            reason: `Monthly export limit of ${limits.monthlyExports} would be exceeded`,
            limits,
            usage,
          };
        }
        break;
    }

    return {
      allowed: true,
      limits,
      usage,
    };
  },
});

// Reset usage for new billing period
export const resetUsageForNewPeriod = mutation({
  args: {
    userId: v.id("users"),
    newPeriodStart: v.number(),
    newPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    // Mark current period as not current
    const currentUsage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) => 
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    if (currentUsage) {
      await ctx.db.patch(currentUsage._id, {
        isCurrentPeriod: false,
        updatedAt: Date.now(),
      });
    }

    // Create new current period
    await ctx.runMutation(api.usageTracking.mutations.initializeUsageTracking, {
      userId: args.userId,
      billingPeriodStart: args.newPeriodStart,
      billingPeriodEnd: args.newPeriodEnd,
    });

    return { success: true };
  },
});
