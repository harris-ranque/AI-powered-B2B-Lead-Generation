import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { createSearchValidator } from "../lib/validators";
import { ERROR_CODES, BUSINESS_RULES, STATUS } from "../lib/constants";
import { createError, calculateSearchCost, hasCredits } from "../lib/helpers";
import { withRateLimit } from "../rateLimit/middleware";

// Create a new search
export const createSearch = mutation({
  args: createSearchValidator,
  handler: async (ctx, args) => {
    return await withRateLimit(ctx, "searches", async () => {
      const user = await getCurrentUser(ctx);

      if (!user) {
        throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
      }

      // Check if system is paused
      const systemControlState = await ctx.db
        .query("systemControlState")
        .unique();
      
      if (systemControlState?.systemPaused || systemControlState?.leadGenerationDisabled) {
        const message = systemControlState.maintenanceMode 
          ? "System is temporarily under maintenance. Please try again later."
          : `Lead generation is currently paused. ${systemControlState.reason || 'Please try again later.'}`;
          
        throw createError(
          message,
          ERROR_CODES.SYSTEM_MAINTENANCE,
          503
        );
      }

      // Validate search parameters
      const { parameters } = args;
      
      // Check plan limits
      let maxAllowed: number = BUSINESS_RULES.SEARCH.MAX_RESULTS_FREE;
      if (user.plan === "pro") {
        maxAllowed = BUSINESS_RULES.SEARCH.MAX_RESULTS_PRO;
      } else if (user.plan === "enterprise") {
        maxAllowed = BUSINESS_RULES.SEARCH.MAX_RESULTS_ENTERPRISE;
      }

      if (parameters.maxResults > maxAllowed) {
        throw createError(
          `Your ${user.plan} plan allows maximum ${maxAllowed} results per search`,
          ERROR_CODES.PLAN_LIMIT_EXCEEDED,
          400
        );
      }

      // Calculate estimated credit cost
      const estimatedCost = calculateSearchCost(
        parameters.maxResults,
        true, // Include enrichment
        true  // Include AI analysis
      );

      if (!hasCredits(user, estimatedCost)) {
        throw createError(
          `Insufficient credits. This search requires approximately ${estimatedCost} credits.`,
          ERROR_CODES.INSUFFICIENT_CREDITS,
          400
        );
      }

      // Create the search record
      const searchId = await ctx.db.insert("searches", {
        userId: user._id,
        name: args.name,
        parameters,
        status: STATUS.SEARCH.PENDING,
        progress: {
          discovered: 0,
          enriched: 0,
          analyzed: 0,
          total: parameters.maxResults,
        },
        results: {
          totalFound: 0,
          enrichedCount: 0,
        },
        creditsUsed: 0,
        createdAt: Date.now(),
      });

      // Send notification
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Search Created",
        message: `Search "${args.name}" has been created and will begin processing shortly.`,
        data: { 
          searchId,
          searchName: args.name,
          estimatedCost,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return { 
        success: true, 
        searchId,
        estimatedCost,
        message: "Search created successfully",
      };
    });
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
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const updateData: any = {
      status: args.status,
    };

    if (args.status === "in_progress" && !search.startedAt) {
      updateData.startedAt = Date.now();
    }

    if (args.status === "completed" || args.status === "failed") {
      updateData.completedAt = Date.now();
    }

    if (args.error) {
      updateData.error = args.error;
    }

    await ctx.db.patch(args.searchId, updateData);

    // Send notification for status changes
    if (args.status === "completed") {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "search_completed",
        title: "Search Completed! 🎉",
        message: `Your search "${search.name}" has completed. ${search.results.totalFound} leads discovered.`,
        data: { 
          searchId: args.searchId,
          searchName: search.name,
          totalFound: search.results.totalFound,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    } else if (args.status === "failed") {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Search Failed",
        message: `Your search "${search.name}" has failed. ${args.error || "Please try again."}`,
        data: { 
          searchId: args.searchId,
          searchName: search.name,
          error: args.error,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Update search progress
export const updateSearchProgress = mutation({
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
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
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

    return { success: true };
  },
});

// Cancel search
export const cancelSearch = mutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Can only cancel pending or in-progress searches
    if (search.status === "completed" || search.status === "failed" || search.status === "cancelled") {
      throw createError("Cannot cancel completed search", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    await ctx.db.patch(args.searchId, {
      status: STATUS.SEARCH.CANCELLED,
      completedAt: Date.now(),
    });

    // Send notification
    await ctx.db.insert("notifications", {
      userId: user._id,
      type: "system_alert",
      title: "Search Cancelled",
      message: `Your search "${search.name}" has been cancelled.`,
      data: { 
        searchId: args.searchId,
        searchName: search.name,
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete search
export const deleteSearch = mutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Get all leads associated with this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Delete all associated leads
    for (const lead of leads) {
      await ctx.db.delete(lead._id);
    }

    // Delete the search
    await ctx.db.delete(args.searchId);

    return { 
      success: true,
      deletedLeads: leads.length,
    };
  },
});

// Duplicate search with new parameters
export const duplicateSearch = mutation({
  args: {
    searchId: v.id("searches"),
    name: v.string(),
    parameters: v.optional(v.object({
      location: v.string(),
      radius: v.number(),
      keywords: v.array(v.string()),
      industries: v.optional(v.array(v.string())),
      excludeTerms: v.optional(v.array(v.string())),
      minRating: v.optional(v.number()),
      maxResults: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const originalSearch = await ctx.db.get(args.searchId);
    
    if (!originalSearch) {
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (originalSearch.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Use provided parameters or original search parameters
    const parameters = args.parameters || originalSearch.parameters;

    // Validate plan limits
    let maxAllowed: number = BUSINESS_RULES.SEARCH.MAX_RESULTS_FREE;
    if (user.plan === "pro") {
      maxAllowed = BUSINESS_RULES.SEARCH.MAX_RESULTS_PRO;
    } else if (user.plan === "enterprise") {
      maxAllowed = BUSINESS_RULES.SEARCH.MAX_RESULTS_ENTERPRISE;
    }

    if (parameters.maxResults > maxAllowed) {
      throw createError(
        `Your ${user.plan} plan allows maximum ${maxAllowed} results per search`,
        ERROR_CODES.PLAN_LIMIT_EXCEEDED,
        400
      );
    }

    // Check credits
    const estimatedCost = calculateSearchCost(parameters.maxResults, true, true);
    
    if (!hasCredits(user, estimatedCost)) {
      throw createError(
        `Insufficient credits. This search requires approximately ${estimatedCost} credits.`,
        ERROR_CODES.INSUFFICIENT_CREDITS,
        400
      );
    }

    // Create the duplicated search
    const newSearchId = await ctx.db.insert("searches", {
      userId: user._id,
      name: args.name,
      parameters,
      status: STATUS.SEARCH.PENDING,
      progress: {
        discovered: 0,
        enriched: 0,
        analyzed: 0,
        total: parameters.maxResults,
      },
      results: {
        totalFound: 0,
        enrichedCount: 0,
      },
      creditsUsed: 0,
      createdAt: Date.now(),
    });

    return { 
      success: true, 
      searchId: newSearchId,
      estimatedCost,
    };
  },
});