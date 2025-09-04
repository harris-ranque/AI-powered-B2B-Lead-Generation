import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get user searches with pagination
export const getUserSearches = query({
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

    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit + offset);

    return searches.slice(offset);
  },
});

// Get search by ID
export const getSearchById = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    return search;
  },
});

// Get search statistics for user
export const getSearchStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const completedSearches = searches.filter(s => s.status === "completed");
    const failedSearches = searches.filter(s => s.status === "failed");
    
    const totalLeadsDiscovered = searches.reduce((sum, search) => 
      sum + (search.results?.totalFound || 0), 0
    );

    const totalCreditsUsed = searches.reduce((sum, search) => 
      sum + search.creditsUsed, 0
    );

    return {
      totalSearches: searches.length,
      completedSearches: completedSearches.length,
      failedSearches: failedSearches.length,
      successRate: searches.length > 0 ? 
        Math.round((completedSearches.length / searches.length) * 100) : 0,
      totalLeadsDiscovered,
      totalCreditsUsed,
      recentSearches: searches
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map(search => ({
          _id: search._id,
          name: search.name,
          status: search.status,
          results: search.results,
          createdAt: search.createdAt,
        })),
    };
  },
});

// Get active searches (in progress)
export const getActiveSearches = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    return await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .order("desc")
      .take(10);
  },
});

// Get search by ID (alias for getSearchById to match frontend expectations)
export const getSearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    return search;
  },
});