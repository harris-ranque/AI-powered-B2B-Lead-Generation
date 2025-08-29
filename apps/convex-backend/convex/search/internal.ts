import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

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

    // Record credit usage using atomic transaction system
    await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
      userId: search.userId,
      type: "usage",
      amount: -args.creditsUsed,
      description: `Search: ${search.name}`,
      relatedEntity: {
        type: "search",
        id: args.searchId,
      },
      requireMinimumBalance: false, // Allow overdraft for completed operations
    });
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

// Cron job functions
export const processPendingSearches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pendingSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(5); // Process 5 at a time

    for (const search of pendingSearches) {
      // Mark as in_progress
      await ctx.db.patch(search._id, {
        status: "in_progress",
        startedAt: Date.now(),
      });

      // Trigger orchestration pipeline
      console.log(`Processing search: ${search.name}`);
      
      try {
        await ctx.scheduler.runAfter(1000, internal.search.orchestrator.orchestrateSearchPipeline, {
          searchId: search._id,
        });
      } catch (error) {
        console.error(`Failed to schedule orchestration for search ${search._id}:`, error);
        await ctx.db.patch(search._id, {
          status: "failed",
          error: `Failed to start orchestration: ${error}`,
          completedAt: Date.now(),
        });
      }
    }
  },
});

export const checkStaleSearches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    // Find searches that have been in progress for over an hour
    const staleSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .filter((q) => q.lt(q.field("startedAt"), oneHourAgo))
      .collect();
      
    // Mark stale searches as failed
    for (const search of staleSearches) {
      await ctx.db.patch(search._id, {
        status: "failed",
        error: "Search timed out after 1 hour",
        completedAt: Date.now(),
      });
      console.log(`Marked stale search ${search._id} as failed`);
    }
    
    // Find searches that have been in progress for 5+ minutes with no leads
    const stuckSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .filter((q) => q.lt(q.field("startedAt"), fiveMinutesAgo))
      .collect();
      
    // Check if any of these have zero leads and should be completed
    for (const search of stuckSearches) {
      const leadCount = await ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", search._id))
        .collect();
        
      if (leadCount.length === 0) {
        // Complete search with zero results
        await ctx.db.patch(search._id, {
          status: "completed",
          completedAt: Date.now(),
          results: {
            totalFound: 0,
            enrichedCount: 0,
            avgRelevanceScore: 0,
          },
          progress: {
            discovered: 0,
            enriched: 0,
            analyzed: 0,
            total: 0,
          },
        });
        
        // Send completion broadcast
        await ctx.scheduler.runAfter(0, internal.realtime.broadcaster.broadcastSearchStatus, {
          searchId: search._id,
          status: "completed",
          message: `Search completed - No results found for your search criteria`,
          progress: {
            discovered: 0,
            enriched: 0,
            analyzed: 0,
            total: 0,
          },
          priority: 3,
        });
        
        console.log(`Completed stuck search ${search._id} with zero results`);
      }
    }
  },
});

export const updateSearchAnalytics = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Update search analytics and metrics
    const completedSearches = await ctx.db
      .query("searches")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .collect();

    // Calculate metrics
    const totalSearches = completedSearches.length;
    const avgCompletionTime = totalSearches > 0 
      ? completedSearches.reduce((sum, s) => sum + ((s.completedAt || s.createdAt) - s.createdAt), 0) / totalSearches
      : 0;

    // TODO: Store analytics data
    console.log(`Analytics updated: ${totalSearches} searches, avg time: ${avgCompletionTime}ms`);
  },
});

// Get search for processing without user restriction (for orchestrator)
export const getSearchById = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.searchId);
  },
});
