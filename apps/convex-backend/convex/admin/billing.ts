import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "../auth";
import { Doc, Id } from "../_generated/dataModel";

// Constants for query limits
const MAX_ITERATION_COUNT = 100000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * Get comprehensive billing and subscription metrics - OPTIMIZED VERSION
 * Uses indexes and streaming for large datasets
 */
export const getBillingMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Initialize metrics
    let totalMRR = 0;
    let activeSubs = 0;
    let canceledSubs = 0;
    let trialingSubs = 0;
    let monthlyRevenue = 0;
    let yearlyRevenue = 0;
    let recentSubsCount = 0;
    let recentCancellationsCount = 0;
    const planCounts: Record<string, number> = {};

    // Stream through billing records using index for active subscriptions
    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "active"))) {
      activeSubs++;
      const plan = billing.plan || "unknown";
      planCounts[plan] = (planCounts[plan] || 0) + 1;

      if (!billing.cancelAtPeriodEnd) {
        const monthlyAmount =
          billing.billingCycle === "yearly" ? billing.amount / 12 : billing.amount;
        totalMRR += monthlyAmount;
      }

      if (billing.billingCycle === "monthly") {
        monthlyRevenue += billing.amount;
      } else if (billing.billingCycle === "yearly") {
        yearlyRevenue += billing.amount;
      }

      if (billing.isTrialing) trialingSubs++;
      if (billing.createdAt > sevenDaysAgo) recentSubsCount++;

      if (activeSubs >= MAX_ITERATION_COUNT) break;
    }

    // Count cancelled subscriptions using index
    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "cancelled"))) {
      canceledSubs++;
      if (billing.updatedAt > sevenDaysAgo) recentCancellationsCount++;
      if (canceledSubs >= MAX_ITERATION_COUNT) break;
    }

    // Also count those with cancelAtPeriodEnd from active subs
    let pendingCancellations = 0;
    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "active"))) {
      if (billing.cancelAtPeriodEnd) {
        pendingCancellations++;
        if (billing.updatedAt > sevenDaysAgo) recentCancellationsCount++;
      }
      if (pendingCancellations >= MAX_ITERATION_COUNT) break;
    }

    const totalChurn = canceledSubs + pendingCancellations;
    const churnRate =
      activeSubs > 0
        ? (totalChurn / (activeSubs + totalChurn)) * 100
        : 0;

    const totalARR = totalMRR * 12;

    return {
      revenue: {
        totalMRR: Math.round(totalMRR),
        totalARR: Math.round(totalARR),
        monthlyRevenue: Math.round(monthlyRevenue),
        yearlyRevenue: Math.round(yearlyRevenue),
      },
      subscriptions: {
        total: activeSubs,
        planCounts,
        recentSubscriptions: recentSubsCount,
        cancelations: totalChurn,
        churnRate: Math.round(churnRate * 100) / 100,
      },
      trials: {
        active: trialingSubs,
        conversionRate: 0, // Would need historical data
      },
      growth: {
        newSubscriptions7d: recentSubsCount,
        cancelations7d: recentCancellationsCount,
        netGrowth7d: recentSubsCount - recentCancellationsCount,
      },
    };
  },
});

/**
 * Get all subscriptions for admin management - OPTIMIZED VERSION
 * Uses indexes for filtering
 */
export const getAllSubscriptions = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    plan: v.optional(
      v.union(
        v.literal("starter"),
        v.literal("professional"),
        v.literal("business"),
        v.literal("enterprise"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("cancelled"),
        v.literal("past_due"),
        v.literal("paused"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = Math.min(args.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = args.offset || 0;

    // Build query with appropriate index
    let query;
    if (args.status !== undefined && args.plan !== undefined) {
      // Use plan_status compound index
      query = ctx.db
        .query("billing")
        .withIndex("by_plan_status", (q) =>
          q.eq("plan", args.plan!).eq("status", args.status!)
        );
    } else if (args.plan !== undefined) {
      query = ctx.db
        .query("billing")
        .withIndex("by_plan", (q) => q.eq("plan", args.plan!));
    } else if (args.status !== undefined) {
      query = ctx.db
        .query("billing")
        .withIndex("by_status", (q) => q.eq("status", args.status!));
    } else {
      query = ctx.db.query("billing");
    }

    // Stream with pagination
    const billingRecords: Array<{
      _id: any;
      userId: any;
      plan: string;
      status: string;
      amount: number;
      billingCycle: string;
      [key: string]: any;
    }> = [];
    let total = 0;
    let skipped = 0;

    for await (const record of query) {
      total++;
      if (skipped < offset) {
        skipped++;
        continue;
      }
      if (billingRecords.length < limit) {
        billingRecords.push(record);
      }
      if (total >= MAX_ITERATION_COUNT) break;
    }

    // Batch user lookups - cast to proper user ID type
    const userIds = Array.from(new Set(billingRecords.map((b) => b.userId as Id<"users">)));
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map<Id<"users">, Doc<"users">>(
      users.filter((u): u is Doc<"users"> => u !== null).map((u) => [u._id, u])
    );

    // Map subscriptions with user info
    const subscriptionsWithUsers = billingRecords.map((billing) => {
      const user = userMap.get(billing.userId as Id<"users">);
      return {
        ...billing,
        userEmail: user?.email || "Unknown",
        userName: user?.name || "Unknown User",
        userCreatedAt: user?.createdAt || 0,
      };
    });

    return {
      subscriptions: subscriptionsWithUsers,
      total,
      hasMore: offset + limit < total,
    };
  },
});

// Get subscription details for a specific user - no major changes needed (single user lookup)
export const getUserSubscriptionDetails = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) =>
        q.eq("userId", args.userId).eq("isCurrentPeriod", true)
      )
      .unique();

    const creditTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);

    const userSearches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(10);

    return {
      user,
      billing,
      usage,
      recentTransactions: creditTransactions,
      recentSearches: userSearches,
    };
  },
});

// Update subscription plan (admin only) - no changes needed (simple mutations)
export const updateSubscriptionPlan = mutation({
  args: {
    userId: v.id("users"),
    newPlan: v.union(
      v.literal("starter"),
      v.literal("professional"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Update user plan
    await ctx.db.patch(args.userId, {
      plan: args.newPlan,
      updatedAt: Date.now(),
    });

    // Update billing record if exists
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (billing) {
      const planLimits = {
        monthlySearches: -1,
        maxLeadsPerSearch: 100,
        monthlyEnrichments: -1,
        monthlyExports: -1,
        emailGeneration: true,
        bulkOperations: true,
        apiAccess: true,
        requiresOwnApiKeys: args.newPlan === "enterprise",
      };

      await ctx.db.patch(billing._id, {
        plan: args.newPlan,
        planLimits,
        updatedAt: Date.now(),
      });
    }

    // Log the admin action
    await ctx.db.insert("subscriptionEvents", {
      userId: args.userId,
      eventType: "plan_changed",
      oldPlan: user.plan,
      newPlan: args.newPlan,
      metadata: {
        reason: args.reason || "Admin update",
      },
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Cancel subscription (admin only) - no changes needed (simple mutations)
export const cancelSubscriptionAdmin = mutation({
  args: {
    userId: v.id("users"),
    cancelAtPeriodEnd: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (!billing) {
      throw new Error("No billing record found for user");
    }

    if (args.cancelAtPeriodEnd) {
      await ctx.db.patch(billing._id, {
        cancelAtPeriodEnd: true,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(billing._id, {
        status: "cancelled",
        cancelAtPeriodEnd: false,
        canceledAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.patch(args.userId, {
        plan: "starter",
        updatedAt: Date.now(),
      });
    }

    await ctx.db.insert("subscriptionEvents", {
      userId: args.userId,
      eventType: "subscription_cancelled",
      metadata: {
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        reason: args.reason || "Admin cancellation",
      },
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get revenue analytics - OPTIMIZED VERSION
 * Uses streaming with indexes
 */
export const getRevenueAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();

    // Calculate MRR by plan using streaming
    const mrrByPlan: Record<string, number> = {};
    let activeSubscriptions = 0;
    let totalLifetimeValue = 0;

    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "active"))) {
      if (!billing.cancelAtPeriodEnd) {
        const plan = billing.plan || "unknown";
        const monthlyAmount =
          billing.billingCycle === "yearly" ? billing.amount / 12 : billing.amount;
        mrrByPlan[plan] = (mrrByPlan[plan] || 0) + monthlyAmount;
        activeSubscriptions++;
      }
      totalLifetimeValue += billing.amount;

      if (activeSubscriptions >= MAX_ITERATION_COUNT) break;
    }

    // Also add lifetime value from cancelled subscriptions
    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "cancelled"))) {
      totalLifetimeValue += billing.amount;
    }

    const currentMRR = Object.values(mrrByPlan).reduce((sum, mrr) => sum + mrr, 0);

    // Generate monthly revenue data (simplified - just current month estimate)
    // For historical data, this would need a separate aggregation table
    const monthlyRevenue = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = now - i * 30 * 24 * 60 * 60 * 1000;
      monthlyRevenue.push({
        month: new Date(monthStart).toISOString().slice(0, 7),
        revenue: i === 0 ? Math.round(currentMRR) : 0, // Only current month is accurate
        subscriptions: i === 0 ? activeSubscriptions : 0,
        note: i > 0 ? "Historical data requires daily aggregation" : undefined,
      });
    }

    return {
      currentMRR: Math.round(currentMRR),
      currentARR: Math.round(currentMRR * 12),
      mrrByPlan: Object.entries(mrrByPlan).map(([plan, mrr]) => ({
        plan,
        mrr: Math.round(mrr),
      })),
      monthlyRevenue,
      totalActiveSubscriptions: activeSubscriptions,
      totalLifetimeValue: Math.round(totalLifetimeValue),
    };
  },
});

/**
 * Get cost and credit analytics - OPTIMIZED VERSION
 * Uses indexes and streaming
 */
export const getCostAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Stream usage transactions with index
    let totalCreditsUsed = 0;
    let recentCosts = 0;
    const costsByOperation: Record<string, number> = {};

    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type", (q) => q.eq("type", "usage"))) {
      totalCreditsUsed += tx.amount;
      if (tx.createdAt > thirtyDaysAgo) {
        recentCosts += tx.amount;
      }
      const operation = tx.description || "unknown";
      costsByOperation[operation] = (costsByOperation[operation] || 0) + tx.amount;
    }

    // Stream purchase transactions
    let totalCreditsIssued = 0;
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type", (q) => q.eq("type", "purchase"))) {
      totalCreditsIssued += tx.amount;
    }

    // Get usage by plan - use plan index to count users per plan
    const usageByPlan = await Promise.all(
      ["starter", "professional", "business", "enterprise"].map(async (plan) => {
        let userCount = 0;
        const planUserIds: string[] = [];

        // Count users per plan using index
        for await (const user of ctx.db
          .query("users")
          .withIndex("by_plan", (q) => q.eq("plan", plan as any))) {
          userCount++;
          planUserIds.push(user._id);
          if (userCount >= 10000) break; // Limit for safety
        }

        // Calculate total usage for these users
        // This is approximate - for exact numbers, use aggregation table
        let planUsage = 0;
        for await (const tx of ctx.db
          .query("creditTransactions")
          .withIndex("by_type", (q) => q.eq("type", "usage"))) {
          if (planUserIds.includes(tx.userId)) {
            planUsage += tx.amount;
          }
        }

        return {
          plan,
          usage: planUsage,
          users: userCount,
          avgUsagePerUser:
            userCount > 0 ? Math.round(planUsage / userCount) : 0,
        };
      })
    );

    return {
      totalCosts: totalCreditsUsed,
      recentCosts,
      totalCreditsIssued,
      totalCreditsUsed,
      creditUtilization:
        totalCreditsIssued > 0
          ? Math.round((totalCreditsUsed / totalCreditsIssued) * 100)
          : 0,
      costsByOperation: Object.entries(costsByOperation).map(
        ([operation, cost]) => ({
          operation,
          cost,
        })
      ),
      usageByPlan,
    };
  },
});
