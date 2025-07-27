import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Internal function to get search for processing
export const getSearchForProcessing = internalQuery({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.userId !== args.userId) {
      return null;
    }

    return search;
  },
});

// Internal function to update search status
export const updateSearchStatus = internalMutation({
  args: {
    searchId: v.id("searches"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      status: args.status,
    };

    if (args.status === "in_progress") {
      updateData.startedAt = Date.now();
    }

    if (args.status === "completed" || args.status === "failed") {
      updateData.completedAt = Date.now();
    }

    if (args.error) {
      updateData.error = args.error;
    }

    await ctx.db.patch(args.searchId, updateData);
  },
});

// Internal function to update search progress
export const updateSearchProgress = internalMutation({
  args: {
    searchId: v.id("searches"),
    discovered: v.optional(v.number()),
    enriched: v.optional(v.number()),
    analyzed: v.optional(v.number()),
    totalFound: v.optional(v.number()),
    enrichedCount: v.optional(v.number()),
    avgRelevanceScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw new Error("Search not found");
    }

    const updateData: any = {};

    // Update progress
    if (args.discovered !== undefined || args.enriched !== undefined || args.analyzed !== undefined) {
      updateData.progress = {
        discovered: args.discovered ?? search.progress.discovered,
        enriched: args.enriched ?? search.progress.enriched,
        analyzed: args.analyzed ?? search.progress.analyzed,
        total: search.progress.total,
      };
    }

    // Update results
    if (args.totalFound !== undefined || args.enrichedCount !== undefined || args.avgRelevanceScore !== undefined) {
      updateData.results = {
        totalFound: args.totalFound ?? search.results.totalFound,
        enrichedCount: args.enrichedCount ?? search.results.enrichedCount,
        avgRelevanceScore: args.avgRelevanceScore ?? search.results.avgRelevanceScore,
      };
    }

    await ctx.db.patch(args.searchId, updateData);
  },
});

// Internal function to record credit usage for search
export const recordSearchCredits = internalMutation({
  args: {
    searchId: v.id("searches"),
    creditsUsed: v.number(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw new Error("Search not found");
    }

    const totalCreditsUsed = search.creditsUsed + args.creditsUsed;

    await ctx.db.patch(args.searchId, {
      creditsUsed: totalCreditsUsed,
    });

    // Update user credits
    const user = await ctx.db.get(search.userId);
    
    if (user) {
      const newBalance = user.credits - args.creditsUsed;
      
      await ctx.db.patch(search.userId, {
        credits: Math.max(0, newBalance),
        updatedAt: Date.now(),
      });

      // Record transaction
      await ctx.db.insert("creditTransactions", {
        userId: search.userId,
        type: "usage",
        amount: -args.creditsUsed,
        description: `Search: ${search.name}`,
        relatedEntity: {
          type: "search",
          id: args.searchId,
        },
        balanceAfter: Math.max(0, newBalance),
        createdAt: Date.now(),
      });
    }
  },
});

// Internal function to get pending searches for processing
export const getPendingSearches = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    
    return await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc") // Process older searches first
      .take(limit);
  },
});

// Internal function to get searches that need completion check
export const getInProgressSearches = internalQuery({
  args: {},
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    return await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .filter((q) => q.lt(q.field("startedAt"), oneHourAgo))
      .collect();
  },
});