import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get current usage for authenticated user
export const getCurrentUsage = query({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const usage = await ctx.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
      .unique();

    const billing = await ctx.db
      .query("billing")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .unique();

    // Default limits for starter tier
    const defaultLimits = {
      monthlySearches: 10,
      maxLeadsPerSearch: 25,
      monthlyEnrichments: 500,
      monthlyExports: 10,
      emailGeneration: false,
      bulkOperations: false,
      apiAccess: false,
      requiresOwnApiKeys: true,
    };

    const limits = billing?.planLimits || defaultLimits;

    if (!usage) {
      return {
        searchesUsed: 0,
        leadsEnriched: 0,
        emailsGenerated: 0,
        exportsCompleted: 0,
        apiCallsMade: 0,
        creditsUsed: 0,
        limits,
        percentUsed: {
          searches: 0,
          enrichments: 0,
          exports: 0,
        },
        period: {
          start: Date.now(),
          end: Date.now() + 30 * 24 * 60 * 60 * 1000,
        },
        plan: user.plan,
      };
    }

    // Calculate usage percentages
    const percentUsed = {
      searches:
        limits.monthlySearches === -1
          ? 0
          : Math.min(
              100,
              Math.round((usage.searchesUsed / limits.monthlySearches) * 100),
            ),
      enrichments:
        limits.monthlyEnrichments === -1
          ? 0
          : Math.min(
              100,
              Math.round(
                (usage.leadsEnriched / limits.monthlyEnrichments) * 100,
              ),
            ),
      exports:
        limits.monthlyExports === -1
          ? 0
          : Math.min(
              100,
              Math.round(
                (usage.exportsCompleted / limits.monthlyExports) * 100,
              ),
            ),
    };

    return {
      searchesUsed: usage.searchesUsed,
      leadsEnriched: usage.leadsEnriched,
      emailsGenerated: usage.emailsGenerated,
      exportsCompleted: usage.exportsCompleted,
      apiCallsMade: usage.apiCallsMade,
      creditsUsed: usage.creditsUsed,
      limits,
      percentUsed,
      period: {
        start: usage.billingPeriodStart,
        end: usage.billingPeriodEnd,
      },
      plan: user.plan,
      lastUpdated: usage.updatedAt,
    };
  },
});

// Get usage history
export const getUsageHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const usageRecords = await ctx.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(args.limit || 12); // Default to 12 months

    return usageRecords.map((record) => ({
      period: {
        start: record.billingPeriodStart,
        end: record.billingPeriodEnd,
      },
      usage: {
        searchesUsed: record.searchesUsed,
        leadsEnriched: record.leadsEnriched,
        emailsGenerated: record.emailsGenerated,
        exportsCompleted: record.exportsCompleted,
        apiCallsMade: record.apiCallsMade,
        creditsUsed: record.creditsUsed,
      },
      isCurrentPeriod: record.isCurrentPeriod,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
  },
});

// Check if operation is allowed
export const canPerformOperation = query({
  args: {
    operation: v.union(
      v.literal("search"),
      v.literal("email_generation"),
      v.literal("export"),
      v.literal("bulk_operation"),
    ),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const result = await ctx.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
      .unique();

    const billing = await ctx.db
      .query("billing")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .unique();

    // Default limits for starter tier
    const defaultLimits = {
      monthlySearches: 10,
      monthlyEnrichments: 500,
      monthlyExports: 10,
      emailGeneration: false,
      bulkOperations: false,
    };

    const limits = billing?.planLimits || defaultLimits;
    const usage = result || {
      searchesUsed: 0,
      leadsEnriched: 0,
      emailsGenerated: 0,
      exportsCompleted: 0,
      apiCallsMade: 0,
    };

    const requestCount = args.count || 1;

    switch (args.operation) {
      case "search":
        if (limits.monthlySearches === -1) {
          return { allowed: true, remaining: -1 };
        }
        const remainingSearches = limits.monthlySearches - usage.searchesUsed;
        return {
          allowed: remainingSearches >= requestCount,
          remaining: remainingSearches,
          used: usage.searchesUsed,
          limit: limits.monthlySearches,
        };

      case "email_generation":
        return {
          allowed: limits.emailGeneration,
          reason: limits.emailGeneration
            ? undefined
            : "Email generation not available on your plan",
        };

      case "export":
        if (limits.monthlyExports === -1) {
          return { allowed: true, remaining: -1 };
        }
        const remainingExports = limits.monthlyExports - usage.exportsCompleted;
        return {
          allowed: remainingExports >= requestCount,
          remaining: remainingExports,
          used: usage.exportsCompleted,
          limit: limits.monthlyExports,
        };

      case "bulk_operation":
        return {
          allowed: limits.bulkOperations,
          reason: limits.bulkOperations
            ? undefined
            : "Bulk operations not available on your plan",
        };

      default:
        return { allowed: false, reason: "Unknown operation" };
    }
  },
});

// Get usage analytics for admin
export const getUsageAnalytics = query({
  args: {
    userId: v.optional(v.id("users")),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // This would typically require admin permissions
    const user = await requireAuth(ctx);

    // For now, just return current user's analytics
    if (args.userId && args.userId !== user._id) {
      throw new Error("Not authorized to view other users' analytics");
    }

    const targetUserId = args.userId || user._id;
    let query = ctx.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), targetUserId));

    if (args.startDate !== undefined) {
      query = query.filter((q) =>
        q.gte(q.field("billingPeriodStart"), args.startDate!),
      );
    }
    if (args.endDate !== undefined) {
      query = query.filter((q) =>
        q.lte(q.field("billingPeriodEnd"), args.endDate!),
      );
    }

    const usageRecords = await query.collect();

    // Aggregate analytics
    const totals = usageRecords.reduce(
      (acc, record) => ({
        totalSearches: acc.totalSearches + record.searchesUsed,
        totalLeadsEnriched: acc.totalLeadsEnriched + record.leadsEnriched,
        totalEmailsGenerated: acc.totalEmailsGenerated + record.emailsGenerated,
        totalExports: acc.totalExports + record.exportsCompleted,
        totalApiCalls: acc.totalApiCalls + record.apiCallsMade,
        totalCreditsUsed: acc.totalCreditsUsed + record.creditsUsed,
      }),
      {
        totalSearches: 0,
        totalLeadsEnriched: 0,
        totalEmailsGenerated: 0,
        totalExports: 0,
        totalApiCalls: 0,
        totalCreditsUsed: 0,
      },
    );

    // Monthly breakdown
    const monthlyData = usageRecords.map((record) => ({
      month: new Date(record.billingPeriodStart).toISOString().slice(0, 7), // YYYY-MM
      searches: record.searchesUsed,
      leads: record.leadsEnriched,
      emails: record.emailsGenerated,
      exports: record.exportsCompleted,
      apiCalls: record.apiCallsMade,
      credits: record.creditsUsed,
    }));

    return {
      totals,
      monthlyData,
      periodCount: usageRecords.length,
    };
  },
});
