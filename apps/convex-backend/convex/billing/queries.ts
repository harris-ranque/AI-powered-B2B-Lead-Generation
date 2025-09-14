import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get user credit balance
export const getCreditBalance = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    return {
      credits: user.credits || 0,
      plan: user.plan,
    };
  },
});

// Get user billing information
export const getUserBilling = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    return {
      credits: user.credits || 0,
      plan: user.plan,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },
});

// Get credit transactions with pagination
export const getCreditTransactions = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 20;
    const offset = args.offset || 0;

    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit + offset);

    return transactions.slice(offset);
  },
});

// Get usage statistics
export const getUsageStats = query({
  args: {
    period: v.optional(
      v.union(v.literal("7d"), v.literal("30d"), v.literal("90d")),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const period = args.period || "30d";
    const now = Date.now();

    // Calculate time range
    let startTime = now;
    switch (period) {
      case "7d":
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "30d":
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "90d":
        startTime = now - 90 * 24 * 60 * 60 * 1000;
        break;
    }

    // Get credit transactions in period
    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.gte(q.field("createdAt"), startTime))
      .collect();

    // Get searches in period
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.gte(q.field("createdAt"), startTime))
      .collect();

    // Calculate statistics
    const creditsSpent = transactions
      .filter((tx) => tx.type === "usage")
      .reduce((sum, tx) => sum + tx.amount, 0);

    const creditsPurchased = transactions
      .filter((tx) => tx.type === "purchase")
      .reduce((sum, tx) => sum + tx.amount, 0);

    const leadsGenerated = searches.reduce(
      (sum, search) => sum + (search.results?.totalFound || 0),
      0,
    );

    const completedSearches = searches.filter(
      (s) => s.status === "completed",
    ).length;

    return {
      period,
      creditsSpent,
      creditsPurchased,
      creditsBalance: user.credits || 0,
      searchesCompleted: completedSearches,
      totalSearches: searches.length,
      leadsGenerated,
      avgCreditsPerSearch:
        completedSearches > 0
          ? Math.round(creditsSpent / completedSearches)
          : 0,
      avgLeadsPerSearch:
        completedSearches > 0
          ? Math.round(leadsGenerated / completedSearches)
          : 0,
    };
  },
});

// Public: Get active credit packs for purchase
export const getCreditPacks = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.query("systemConfiguration").unique();
    const packs = config?.creditPacks || [];
    // Only expose active packs; sort by credits ascending
    return packs
      .filter((p) => p.active)
      .sort((a, b) => a.credits - b.credits)
      .map((p) => ({
        id: p.id,
        credits: p.credits,
        priceCents: p.priceCents,
        bonus: p.bonus || 0,
      }));
  },
});

// Public: Get visible plan catalog for subscriptions
export const getPlanCatalog = query({
  args: {},
  handler: async (ctx) => {
    const plans = await ctx.db
      .query("planConfigurations")
      .withIndex("by_visible", (q) => q.eq("isVisible", true))
      .collect();

    return plans
      .filter((p) => p.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        planId: p.planId,
        planName: p.planName,
        monthlyPrice: p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
        stripePriceIdMonthly: p.stripePriceIdMonthly,
        stripePriceIdYearly: p.stripePriceIdYearly,
        limits: p.limits,
        features: p.features,
      }));
  },
});

// Get spending breakdown by category
export const getSpendingBreakdown = query({
  args: {
    period: v.optional(
      v.union(v.literal("7d"), v.literal("30d"), v.literal("90d")),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const period = args.period || "30d";
    const now = Date.now();

    let startTime = now;
    switch (period) {
      case "7d":
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "30d":
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "90d":
        startTime = now - 90 * 24 * 60 * 60 * 1000;
        break;
    }

    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.gte(q.field("createdAt"), startTime))
      .filter((q) => q.eq(q.field("type"), "usage"))
      .collect();

    // Group by related entity type
    const breakdown = transactions.reduce(
      (acc, tx) => {
        const category = tx.relatedEntity?.type || "other";
        acc[category] = (acc[category] || 0) + tx.amount;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      period,
      breakdown,
      total: Object.values(breakdown).reduce((sum, amount) => sum + amount, 0),
    };
  },
});

// Get credit usage summary
export const getCreditUsage = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get recent usage transactions
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const recentTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.gte(q.field("createdAt"), thirtyDaysAgo))
      .collect();

    const usageTransactions = recentTransactions.filter(
      (tx) => tx.type === "usage",
    );
    const totalUsed = usageTransactions.reduce((sum, tx) => sum + tx.amount, 0);

    return {
      currentBalance: user.credits || 0,
      totalUsed30Days: totalUsed,
      recentTransactions: usageTransactions.slice(0, 10),
      plan: user.plan,
    };
  },
});
