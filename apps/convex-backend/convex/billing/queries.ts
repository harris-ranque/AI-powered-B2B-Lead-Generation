import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Get current user's billing information
export const getCurrentBilling = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Get active billing record
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    return {
      user: {
        plan: user.plan,
        credits: user.credits,
      },
      billing,
    };
  },
});

// Get user's credit transaction history
export const getCreditHistory = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    type: v.optional(v.union(
      v.literal("purchase"),
      v.literal("usage"),
      v.literal("refund"),
      v.literal("bonus")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    let query = ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.type !== undefined) {
      const typeFilter = args.type; // TypeScript now knows this is not undefined
      query = ctx.db
        .query("creditTransactions")
        .withIndex("by_type", (q) => q.eq("type", typeFilter))
        .filter((q) => q.eq(q.field("userId"), user._id));
    }

    const transactions = await query
      .order("desc")
      .take(limit + offset);

    const paginatedTransactions = transactions.slice(offset, offset + limit);

    // Calculate summary statistics
    const totalPurchases = transactions
      .filter(t => t.type === "purchase")
      .reduce((sum, t) => sum + t.amount, 0);

    const totalUsage = transactions
      .filter(t => t.type === "usage")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const totalRefunds = transactions
      .filter(t => t.type === "refund")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const totalBonus = transactions
      .filter(t => t.type === "bonus")
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      transactions: paginatedTransactions,
      total: transactions.length,
      hasMore: transactions.length > offset + limit,
      summary: {
        totalPurchases,
        totalUsage,
        totalRefunds,
        totalBonus,
        netCredits: totalPurchases + totalBonus - totalUsage - totalRefunds,
      },
    };
  },
});

// Get billing history
export const getBillingHistory = query({
  args: {
    limit: v.optional(v.number()),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 20;
    const includeInactive = args.includeInactive || false;

    let query = ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (!includeInactive) {
      query = query.filter((q) => 
        q.or(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "past_due")
        )
      );
    }

    const billingRecords = await query
      .order("desc")
      .take(limit);

    return {
      billingRecords,
      total: billingRecords.length,
    };
  },
});

// Get available credit packages
export const getCreditPackages = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    return {
      packages: [
        {
          id: "starter_100",
          name: "Starter Pack",
          credits: 100,
          price: 1900, // $19.00 in cents
          savings: 0,
          popular: false,
          description: "Perfect for trying out Genni",
        },
        {
          id: "growth_500",
          name: "Growth Pack",
          credits: 500,
          price: 7900, // $79.00 in cents
          savings: 1600, // $16.00 savings
          popular: true,
          description: "Great for growing businesses",
        },
        {
          id: "pro_1000",
          name: "Pro Pack",
          credits: 1000,
          price: 14900, // $149.00 in cents
          savings: 4100, // $41.00 savings
          popular: false,
          description: "For power users and agencies",
        },
        {
          id: "enterprise_2500",
          name: "Enterprise Pack",
          credits: 2500,
          price: 29900, // $299.00 in cents
          savings: 17600, // $176.00 savings
          popular: false,
          description: "Maximum value for large operations",
        },
      ],
    };
  },
});

// Get subscription plans
export const getSubscriptionPlans = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const currentPlan = user?.plan || "free";

    return {
      currentPlan,
      plans: [
        {
          id: "free",
          name: "Free",
          monthlyPrice: 0,
          yearlyPrice: 0,
          credits: 50,
          features: [
            "50 credits per month",
            "Up to 25 leads per search",
            "Basic email generation",
            "Standard support",
          ],
          limits: {
            maxSearches: 5,
            maxLeadsPerSearch: 25,
            bulkOperations: false,
            apiAccess: false,
          },
          popular: false,
        },
        {
          id: "pro",
          name: "Pro",
          monthlyPrice: 2900, // $29.00
          yearlyPrice: 29000, // $290.00 (2 months free)
          credits: 500,
          features: [
            "500 credits per month",
            "Up to 100 leads per search",
            "Advanced AI email generation",
            "Bulk operations",
            "API access",
            "Priority support",
          ],
          limits: {
            maxSearches: 50,
            maxLeadsPerSearch: 100,
            bulkOperations: true,
            apiAccess: true,
          },
          popular: true,
        },
        {
          id: "enterprise",
          name: "Enterprise",
          monthlyPrice: 9900, // $99.00
          yearlyPrice: 99000, // $990.00 (2 months free)
          credits: 2000,
          features: [
            "2000 credits per month",
            "Up to 500 leads per search",
            "Premium AI features",
            "Advanced bulk operations",
            "Full API access",
            "Dedicated support",
            "Custom integrations",
          ],
          limits: {
            maxSearches: -1, // Unlimited
            maxLeadsPerSearch: 500,
            bulkOperations: true,
            apiAccess: true,
          },
          popular: false,
        },
      ],
    };
  },
});

// Get usage analytics for current billing period
export const getUsageAnalytics = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Get current billing period start
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    // Default to current month if no billing record
    const periodStart = billing?.currentPeriodStart || 
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

    // Get usage transactions for current period
    const usageTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.and(
          q.eq(q.field("type"), "usage"),
          q.gt(q.field("createdAt"), periodStart)
        )
      )
      .collect();

    // Calculate usage by category
    const usageByCategory = usageTransactions.reduce((acc, transaction) => {
      const entity = transaction.relatedEntity;
      if (entity?.type) {
        acc[entity.type] = (acc[entity.type] || 0) + Math.abs(transaction.amount);
      }
      return acc;
    }, {} as Record<string, number>);

    const totalUsed = usageTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Get plan limits
    const planLimits = {
      free: { monthlyCredits: 50 },
      pro: { monthlyCredits: 500 },
      enterprise: { monthlyCredits: 2000 },
    };

    const currentPlanLimits = planLimits[user.plan as keyof typeof planLimits];
    const usagePercentage = currentPlanLimits ? 
      Math.round((totalUsed / currentPlanLimits.monthlyCredits) * 100) : 0;

    return {
      currentPeriod: {
        start: periodStart,
        end: billing?.currentPeriodEnd || Date.now(),
      },
      usage: {
        totalUsed,
        remainingCredits: user.credits,
        usagePercentage,
        usageByCategory,
      },
      plan: {
        current: user.plan,
        limits: currentPlanLimits,
      },
      dailyUsage: calculateDailyUsage(usageTransactions, periodStart),
    };
  },
});

// Helper function to calculate daily usage
function calculateDailyUsage(transactions: any[], periodStart: number) {
  const dailyUsage: Record<string, number> = {};
  
  transactions.forEach(transaction => {
    if (transaction?.createdAt && transaction?.amount !== undefined) {
      const date = new Date(transaction.createdAt).toISOString().split('T')[0];
      if (date) {
        dailyUsage[date] = (dailyUsage[date] || 0) + Math.abs(transaction.amount);
      }
    }
  });

  // Fill in missing days with 0
  const startDate = new Date(periodStart);
  const endDate = new Date();
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    if (dateStr && dailyUsage[dateStr] === undefined) {
      dailyUsage[dateStr] = 0;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return Object.entries(dailyUsage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, usage]) => ({ date, usage }));
}

// Check if user can perform operation based on credits and plan limits
export const canPerformOperation = query({
  args: {
    operation: v.union(
      v.literal("search"),
      v.literal("email_generation"),
      v.literal("bulk_analysis"),
      v.literal("api_access")
    ),
    cost: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      return { canPerform: false, reason: "Authentication required" };
    }

    // Check credit balance
    if (user.credits < args.cost) {
      return { 
        canPerform: false, 
        reason: `Insufficient credits. Required: ${args.cost}, Available: ${user.credits}` 
      };
    }

    // Check plan-specific limits
    const planLimits = {
      free: { 
        search: true, 
        email_generation: true, 
        bulk_analysis: false, 
        api_access: false 
      },
      pro: { 
        search: true, 
        email_generation: true, 
        bulk_analysis: true, 
        api_access: true 
      },
      enterprise: { 
        search: true, 
        email_generation: true, 
        bulk_analysis: true, 
        api_access: true 
      },
    };

    const userPlanLimits = planLimits[user.plan as keyof typeof planLimits];
    
    if (!userPlanLimits?.[args.operation]) {
      return { 
        canPerform: false, 
        reason: `${args.operation} not available on ${user.plan} plan. Please upgrade.` 
      };
    }

    return { canPerform: true };
  },
});

// Get user's current credit balance
export const getCreditBalance = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    return {
      balance: user.credits || 0,
      plan: user.plan,
    };
  },
});

// Get user's credit transactions
export const getCreditTransactions = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // Get credit transactions from the creditTransactions table
    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate({ numItems: limit, cursor: null });

    return transactions;
  },
});

// Get user's billing information (alias for getCurrentBilling)
export const getUserBilling = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Get active billing record
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    return {
      user: {
        plan: user.plan,
        credits: user.credits,
      },
      billing,
    };
  },
});

// Get usage statistics (alias for getUsageAnalytics)
export const getUsageStats = query({
  args: {
    timeframe: v.optional(v.union(
      v.literal("day"),
      v.literal("week"),
      v.literal("month"),
      v.literal("year")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const timeframe = args.timeframe || "month";
    const now = Date.now();
    
    // Calculate time range
    let startDate: number;
    switch (timeframe) {
      case "day":
        startDate = now - 24 * 60 * 60 * 1000;
        break;
      case "week":
        startDate = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "month":
        startDate = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "year":
        startDate = now - 365 * 24 * 60 * 60 * 1000;
        break;
    }

    // Get usage transactions in the timeframe
    const usageTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.and(
          q.eq(q.field("type"), "usage"),
          q.gte(q.field("_creationTime"), startDate)
        )
      )
      .collect();

    const totalUsed = usageTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    return {
      timeframe,
      totalUsed,
      transactionCount: usageTransactions.length,
      currentBalance: user.credits || 0,
      plan: user.plan,
    };
  },
});