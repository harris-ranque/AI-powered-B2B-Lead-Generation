import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { internal } from "../_generated/api";

// Create a new search
export const createSearch = mutation({
  args: {
    name: v.string(),
    parameters: v.object({
      location: v.string(),
      radius: v.number(),
      keywords: v.array(v.string()),
      industries: v.optional(v.array(v.string())),
      excludeTerms: v.optional(v.array(v.string())),
      minRating: v.optional(v.number()),
      maxResults: v.number(),
      filters: v.optional(v.object({
        minEmployees: v.optional(v.number()),
        maxEmployees: v.optional(v.number()),
      })),
    }),
    autoStart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    const searchId = await ctx.db.insert("searches", {
      userId: user._id,
      name: args.name,
      parameters: args.parameters,
      status: "pending",
      progress: {
        discovered: 0,
        enriched: 0,
        analyzed: 0,
        total: 0,
      },
      results: {
        totalFound: 0,
        enrichedCount: 0,
        avgRelevanceScore: 0,
      },
      creditsUsed: 0,
      createdAt: Date.now(),
    });
    
    // If autoStart is true, schedule the orchestration
    if (args.autoStart) {
      await ctx.scheduler.runAfter(0, internal["search/orchestrator"].orchestrateSearch, {
        searchId,
      });
    }
    
    return { searchId, success: true, autoStarted: args.autoStart || false };
  },
});

// Update search status
export const updateSearchStatus = mutation({
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
    const user = await requireAuth(ctx);
    
    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }
    
    const updates: any = {
      status: args.status,
    };
    
    if (args.error) {
      updates.error = args.error;
    }
    
    if (args.status === "in_progress" && !search.startedAt) {
      updates.startedAt = Date.now();
    }
    
    if (args.status === "completed" || args.status === "failed") {
      updates.completedAt = Date.now();
    }
    
    await ctx.db.patch(args.searchId, updates);
    
    return { success: true };
  },
});

// Update search progress
export const updateSearchProgress = mutation({
  args: {
    searchId: v.id("searches"),
    progress: v.object({
      discovered: v.number(),
      enriched: v.number(),
      analyzed: v.number(),
      total: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }
    
    await ctx.db.patch(args.searchId, {
      progress: args.progress,
      lastOrchestrationAt: Date.now(),
    });
    
    return { success: true };
  },
});

// Cancel a search
export const cancelSearch = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }
    
    // Only allow cancelling if not completed
    if (search.status === "completed") {
      throw new Error("Cannot cancel completed search");
    }
    
    await ctx.db.patch(args.searchId, {
      status: "cancelled",
      completedAt: Date.now(),
    });
    
    return { success: true };
  },
});

// Delete a search
export const deleteSearch = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }
    
    // Get all leads associated with this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();
    
    // Delete all associated leads first
    for (const lead of leads) {
      await ctx.db.delete(lead._id);
    }
    
    // Delete the search
    await ctx.db.delete(args.searchId);
    
    return { success: true, deletedLeads: leads.length };
  },
});

// Duplicate a search
export const duplicateSearch = mutation({
  args: {
    searchId: v.id("searches"),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    // Verify user owns the search
    const originalSearch = await ctx.db.get(args.searchId);
    if (!originalSearch || originalSearch.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }
    
    const newName = args.newName || `${originalSearch.name} (Copy)`;
    
    const duplicateId = await ctx.db.insert("searches", {
      userId: user._id,
      name: newName,
      parameters: originalSearch.parameters,
      status: "pending",
      progress: {
        discovered: 0,
        enriched: 0,
        analyzed: 0,
        total: 0,
      },
      results: {
        totalFound: 0,
        enrichedCount: 0,
        avgRelevanceScore: 0,
      },
      creditsUsed: 0,
      createdAt: Date.now(),
    });
    
    return { searchId: duplicateId, success: true };
  },
});