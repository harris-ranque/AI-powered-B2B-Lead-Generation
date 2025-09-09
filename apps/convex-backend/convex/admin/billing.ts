import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "../auth";
import { api } from "../_generated/api";

// Get comprehensive billing and subscription metrics
export const getBillingMetrics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    // Get all billing records
    const allBilling = await ctx.db.query("billing").collect();

    // Revenue metrics
    const totalMRR = allBilling
      .filter(b => b.status === "active" && !b.cancelAtPeriodEnd)
      .reduce((sum, b) => {
        if (b.billingCycle === "yearly") {
          return sum + (b.amount / 12); // Convert yearly to monthly
        }
        return sum + b.amount;
      }, 0);

    const totalARR = totalMRR * 12;

    // Subscription counts by plan
    const activeSubs = allBilling.filter(b => b.status === "active");
    const planCounts = activeSubs.reduce((acc, sub) => {
      const plan = sub.plan || "unknown";
      acc[plan] = (acc[plan] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Churn analysis
    const canceledSubs = allBilling.filter(b => 
      b.status === "cancelled" || b.cancelAtPeriodEnd
    );

    const totalChurn = canceledSubs.length;
    const churnRate = activeSubs.length > 0 ? 
      (totalChurn / (activeSubs.length + totalChurn)) * 100 : 0;

    // Recent subscription events
    const recentSubs = allBilling
      .filter(b => b.createdAt > sevenDaysAgo)
      .sort((a, b) => b.createdAt - a.createdAt);

    const recentCancellations = canceledSubs
      .filter(b => b.updatedAt > sevenDaysAgo)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    // Trial conversions (if we had trials)
    const trialingSubs = allBilling.filter(b => b.isTrialing);

    // Revenue breakdown
    const monthlyRevenue = activeSubs
      .filter(b => b.billingCycle === "monthly")
      .reduce((sum, b) => sum + b.amount, 0);

    const yearlyRevenue = activeSubs
      .filter(b => b.billingCycle === "yearly")
      .reduce((sum, b) => sum + b.amount, 0);

    return {
      revenue: {
        totalMRR: Math.round(totalMRR),
        totalARR: Math.round(totalARR),
        monthlyRevenue: Math.round(monthlyRevenue),
        yearlyRevenue: Math.round(yearlyRevenue),
      },
      subscriptions: {
        total: activeSubs.length,
        planCounts,
        recentSubscriptions: recentSubs.length,
        cancelations: totalChurn,
        churnRate: Math.round(churnRate * 100) / 100,
      },
      trials: {
        active: trialingSubs.length,
        conversionRate: 0, // Would need historical data
      },
      growth: {
        newSubscriptions7d: recentSubs.length,
        cancelations7d: recentCancellations.length,
        netGrowth7d: recentSubs.length - recentCancellations.length,
      },
    };
  },
});

// Get all subscriptions for admin management
export const getAllSubscriptions = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    plan: v.optional(v.union(
      v.literal("starter"), 
      v.literal("professional"), 
      v.literal("business"), 
      v.literal("enterprise")
    )),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("cancelled"),
      v.literal("past_due"),
      v.literal("paused")
    )),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // Get billing records with filters
    let billingRecords = await ctx.db.query("billing").collect();

    // Apply filters
    if (args.plan) {
      billingRecords = billingRecords.filter(b => b.plan === args.plan);
    }

    if (args.status) {
      billingRecords = billingRecords.filter(b => b.status === args.status);
    }

    // Sort by creation date (newest first)
    billingRecords.sort((a, b) => b.createdAt - a.createdAt);

    // Apply pagination
    const paginatedRecords = billingRecords.slice(offset, offset + limit);

    // Get user information for each subscription
    const subscriptionsWithUsers = await Promise.all(
      paginatedRecords.map(async (billing) => {
        const user = await ctx.db.get(billing.userId);
        return {
          ...billing,
          userEmail: user?.email || "Unknown",
          userName: user?.name || "Unknown User",
          userCreatedAt: user?.createdAt || 0,
        };
      })
    );

    return {
      subscriptions: subscriptionsWithUsers,
      total: billingRecords.length,
      hasMore: offset + limit < billingRecords.length,
    };
  },
});

// Get subscription details for a specific user
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
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .unique();

    const usage = await ctx.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
      .unique();

    const creditTransactions = await ctx.db
      .query("creditTransactions")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .order("desc")
      .take(20);

    const userSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("userId"), args.userId))
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

// Update subscription plan (admin only)
export const updateSubscriptionPlan = mutation({
  args: {
    userId: v.id("users"),
    newPlan: v.union(
      v.literal("starter"), 
      v.literal("professional"), 
      v.literal("business"), 
      v.literal("enterprise")
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
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .unique();

    if (billing) {
      // Get plan limits for the new plan
      // Get plan limits (simplified for now)
      const planLimits = {
        monthlySearches: -1,
        maxLeadsPerSearch: 100,
        monthlyEnrichments: -1,
        monthlyExports: -1,
        emailGeneration: true,
        bulkOperations: true,
        apiAccess: true,
        requiresOwnApiKeys: false,
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

// Cancel subscription (admin only)
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
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .unique();

    if (!billing) {
      throw new Error("No billing record found for user");
    }

    if (args.cancelAtPeriodEnd) {
      // Schedule cancellation
      await ctx.db.patch(billing._id, {
        cancelAtPeriodEnd: true,
        updatedAt: Date.now(),
      });
    } else {
      // Cancel immediately
      await ctx.db.patch(billing._id, {
        status: "cancelled",
        cancelAtPeriodEnd: false,
        canceledAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Downgrade user to starter
      await ctx.db.patch(args.userId, {
        plan: "starter",
        updatedAt: Date.now(),
      });
    }

    // Log the admin action
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

// Get revenue analytics
export const getRevenueAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
    const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
    const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);

    const allBilling = await ctx.db.query("billing").collect();

    // Current active subscriptions
    const activeSubscriptions = allBilling.filter(b => 
      b.status === "active" && !b.cancelAtPeriodEnd
    );

    // Calculate MRR by plan
    const mrrByPlan = activeSubscriptions.reduce((acc, sub) => {
      const plan = sub.plan || "unknown";
      const monthlyAmount = sub.billingCycle === "yearly" ? sub.amount / 12 : sub.amount;
      acc[plan] = (acc[plan] || 0) + monthlyAmount;
      return acc;
    }, {} as Record<string, number>);

    // Revenue growth over time (monthly)
    const monthlyRevenue = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = now - (i * 30 * 24 * 60 * 60 * 1000);
      const monthEnd = now - ((i - 1) * 30 * 24 * 60 * 60 * 1000);
      
      const monthSubs = allBilling.filter(b => 
        b.createdAt <= monthEnd && 
        (b.status === "active" || (b.canceledAt && b.canceledAt > monthStart))
      );

      const revenue = monthSubs.reduce((sum, sub) => {
        const monthlyAmount = sub.billingCycle === "yearly" ? sub.amount / 12 : sub.amount;
        return sum + monthlyAmount;
      }, 0);

      monthlyRevenue.push({
        month: new Date(monthStart).toISOString().slice(0, 7), // YYYY-MM
        revenue: Math.round(revenue),
        subscriptions: monthSubs.length,
      });
    }

    return {
      currentMRR: Math.round(Object.values(mrrByPlan).reduce((sum, mrr) => sum + mrr, 0)),
      currentARR: Math.round(Object.values(mrrByPlan).reduce((sum, mrr) => sum + mrr, 0) * 12),
      mrrByPlan: Object.entries(mrrByPlan).map(([plan, mrr]) => ({
        plan,
        mrr: Math.round(mrr),
      })),
      monthlyRevenue,
      totalActiveSubscriptions: activeSubscriptions.length,
      totalLifetimeValue: Math.round(allBilling.reduce((sum, b) => sum + b.amount, 0)),
    };
  },
});

// Get cost and credit analytics
export const getCostAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

    // Get all credit transactions
    const allTransactions = await ctx.db.query("creditTransactions").collect();
    
    // Separate usage (costs) from purchases (revenue)
    const usageTransactions = allTransactions.filter(t => t.type === "usage");
    const purchaseTransactions = allTransactions.filter(t => t.type === "purchase");

    // Recent costs (last 30 days)
    const recentCosts = usageTransactions
      .filter(t => t.createdAt > thirtyDaysAgo)
      .reduce((sum, t) => sum + t.amount, 0);

    // Costs by operation type
    const costsByOperation = usageTransactions.reduce((acc, t) => {
      const operation = t.description || "unknown";
      acc[operation] = (acc[operation] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    // Credits purchased vs used
    const totalCreditsIssued = purchaseTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalCreditsUsed = usageTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Get usage by plan
    const usageByPlan = await Promise.all(
      ["starter", "professional", "business", "enterprise"].map(async (plan) => {
        const planUsers = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("plan"), plan))
          .collect();

        const planUserIds = planUsers.map(u => u._id);
        
        const planUsage = usageTransactions
          .filter(t => planUserIds.includes(t.userId))
          .reduce((sum, t) => sum + t.amount, 0);

        return {
          plan,
          usage: planUsage,
          users: planUsers.length,
          avgUsagePerUser: planUsers.length > 0 ? Math.round(planUsage / planUsers.length) : 0,
        };
      })
    );

    return {
      totalCosts: totalCreditsUsed,
      recentCosts: recentCosts,
      totalCreditsIssued,
      totalCreditsUsed,
      creditUtilization: totalCreditsIssued > 0 ? 
        Math.round((totalCreditsUsed / totalCreditsIssued) * 100) : 0,
      costsByOperation: Object.entries(costsByOperation).map(([operation, cost]) => ({
        operation,
        cost,
      })),
      usageByPlan,
    };
  },
});