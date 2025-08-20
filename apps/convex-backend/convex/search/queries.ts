import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES, BUSINESS_RULES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Get user's searches
export const getUserSearches = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 20;
    const offset = args.offset || 0;

    let searchQuery = ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.status !== undefined) {
      const statusFilter = args.status;
      searchQuery = ctx.db
        .query("searches")
        .withIndex("by_status", (q) => q.eq("status", statusFilter))
        .filter((q) => q.eq(q.field("userId"), user._id));
    }

    const searches = await searchQuery
      .order("desc")
      .take(limit + offset);

    const paginatedSearches = searches.slice(offset, offset + limit);

    return {
      searches: paginatedSearches,
      total: searches.length,
      hasMore: searches.length > offset + limit,
    };
  },
});

// Get search by ID
export const getSearchById = query({
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

    // Check if user owns this search
    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    return search;
  },
});

// Get search results (leads associated with search)
export const getSearchResults = query({
  args: {
    searchId: v.id("searches"),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    let leadsQuery = ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId));

    if (args.status !== undefined) {
      const statusFilter = args.status;
      leadsQuery = ctx.db
        .query("leads")
        .withIndex("by_status", (q) => q.eq("status", statusFilter))
        .filter((q) => q.eq(q.field("searchId"), args.searchId));
    }

    const leads = await leadsQuery
      .order("desc")
      .take(limit + offset);

    const paginatedLeads = leads.slice(offset, offset + limit);

    return {
      search,
      leads: paginatedLeads,
      total: leads.length,
      hasMore: leads.length > offset + limit,
    };
  },
});

// Get search by ID (alias for getSearchById)
export const getSearch = query({
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

    // Check if user owns this search
    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    return search;
  },
});

// Get search analytics
export const getSearchAnalytics = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      throw createError("Search not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (search.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Get all leads for this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Calculate analytics
    const totalLeads = leads.length;
    const enrichedLeads = leads.filter(l => l.enrichmentStatus === "completed").length;
    const analyzedLeads = leads.filter(l => l.aiAnalysis).length;
    
    const statusDistribution = {
      new: leads.filter(l => l.status === "new").length,
      qualified: leads.filter(l => l.status === "qualified").length,
      contacted: leads.filter(l => l.status === "contacted").length,
      nurturing: leads.filter(l => l.status === "nurturing").length,
      converted: leads.filter(l => l.status === "converted").length,
      unqualified: leads.filter(l => l.status === "unqualified").length,
    };

    const enrichmentStatus = {
      pending: leads.filter(l => l.enrichmentStatus === "pending").length,
      in_progress: leads.filter(l => l.enrichmentStatus === "in_progress").length,
      completed: leads.filter(l => l.enrichmentStatus === "completed").length,
      failed: leads.filter(l => l.enrichmentStatus === "failed").length,
    };

    // Calculate average relevance score
    const leadsWithRelevance = leads.filter(l => l.aiAnalysis?.relevanceScore);
    const avgRelevanceScore = leadsWithRelevance.length > 0 
      ? leadsWithRelevance.reduce((sum, lead) => sum + (lead.aiAnalysis?.relevanceScore || 0), 0) / leadsWithRelevance.length
      : 0;

    // Get top categories
    const categoryCount: Record<string, number> = {};
    leads.forEach(lead => {
      if (lead.category) {
        categoryCount[lead.category] = (categoryCount[lead.category] || 0) + 1;
      }
    });

    const topCategories = Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([category, count]) => ({ category, count }));

    // Calculate conversion funnel
    const conversionFunnel = {
      discovered: totalLeads,
      enriched: enrichedLeads,
      analyzed: analyzedLeads,
      qualified: statusDistribution.qualified + statusDistribution.contacted + statusDistribution.nurturing + statusDistribution.converted,
      contacted: statusDistribution.contacted + statusDistribution.nurturing + statusDistribution.converted,
      converted: statusDistribution.converted,
    };

    const conversionRates = {
      enrichmentRate: totalLeads > 0 ? (enrichedLeads / totalLeads) * 100 : 0,
      analysisRate: totalLeads > 0 ? (analyzedLeads / totalLeads) * 100 : 0,
      qualificationRate: totalLeads > 0 ? (conversionFunnel.qualified / totalLeads) * 100 : 0,
      contactRate: conversionFunnel.qualified > 0 ? (conversionFunnel.contacted / conversionFunnel.qualified) * 100 : 0,
      conversionRate: conversionFunnel.contacted > 0 ? (conversionFunnel.converted / conversionFunnel.contacted) * 100 : 0,
    };

    return {
      search,
      totalLeads,
      statusDistribution,
      enrichmentStatus,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100) / 100,
      topCategories,
      conversionFunnel,
      conversionRates: {
        enrichmentRate: Math.round(conversionRates.enrichmentRate * 100) / 100,
        analysisRate: Math.round(conversionRates.analysisRate * 100) / 100,
        qualificationRate: Math.round(conversionRates.qualificationRate * 100) / 100,
        contactRate: Math.round(conversionRates.contactRate * 100) / 100,
        conversionRate: Math.round(conversionRates.conversionRate * 100) / 100,
      },
    };
  },
});

// Get search history summary
export const getSearchSummary = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const totalSearches = searches.length;
    const completedSearches = searches.filter(s => s.status === "completed").length;
    const failedSearches = searches.filter(s => s.status === "failed").length;
    const inProgressSearches = searches.filter(s => s.status === "in_progress").length;

    // Calculate total leads discovered across all searches
    const totalLeadsDiscovered = searches.reduce((sum, search) => sum + search.results.totalFound, 0);
    const totalCreditsUsed = searches.reduce((sum, search) => sum + search.creditsUsed, 0);

    // Get recent search activity (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentSearches = searches.filter(s => s.createdAt > thirtyDaysAgo);
    const recentLeads = recentSearches.reduce((sum, search) => sum + search.results.totalFound, 0);

    // Get most used locations
    const locationCount: Record<string, number> = {};
    searches.forEach(search => {
      const location = search.parameters.location;
      locationCount[location] = (locationCount[location] || 0) + 1;
    });

    const topLocations = Object.entries(locationCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([location, count]) => ({ location, count }));

    // Get most used keywords
    const keywordCount: Record<string, number> = {};
    searches.forEach(search => {
      search.parameters.keywords.forEach(keyword => {
        keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
      });
    });

    const topKeywords = Object.entries(keywordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([keyword, count]) => ({ keyword, count }));

    return {
      totalSearches,
      completedSearches,
      failedSearches,
      inProgressSearches,
      totalLeadsDiscovered,
      totalCreditsUsed,
      recentActivity: {
        searchesLast30Days: recentSearches.length,
        leadsLast30Days: recentLeads,
      },
      topLocations,
      topKeywords,
      successRate: totalSearches > 0 ? Math.round((completedSearches / totalSearches) * 100) : 0,
    };
  },
});

// Get saved search templates
export const getSearchTemplates = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Get user's successful searches to suggest as templates
    const completedSearches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .order("desc")
      .take(10);

    const templates = completedSearches
      .filter(search => search.results.totalFound > 0)
      .map(search => ({
        id: search._id,
        name: search.name,
        parameters: search.parameters,
        results: search.results,
        createdAt: search.createdAt,
      }));

    // Add some predefined templates
    const predefinedTemplates = [
      {
        name: "Local Restaurants",
        parameters: {
          location: "New York, NY",
          radius: 10000,
          keywords: ["restaurant", "dining"],
          maxResults: 50,
        },
        description: "Find local restaurants in a specific area",
      },
      {
        name: "Professional Services",
        parameters: {
          location: "San Francisco, CA",
          radius: 25000,
          keywords: ["consulting", "law", "accounting"],
          maxResults: 100,
        },
        description: "Target professional service providers",
      },
      {
        name: "Tech Startups",
        parameters: {
          location: "Austin, TX",
          radius: 15000,
          keywords: ["software", "tech", "startup"],
          maxResults: 75,
        },
        description: "Find technology companies and startups",
      },
      {
        name: "Healthcare Providers",
        parameters: {
          location: "Chicago, IL",
          radius: 20000,
          keywords: ["medical", "healthcare", "clinic"],
          maxResults: 100,
        },
        description: "Target healthcare and medical facilities",
      },
    ];

    return {
      userTemplates: templates,
      predefinedTemplates,
    };
  },
});

// Validate search parameters
export const validateSearchParameters = query({
  args: {
    location: v.string(),
    radius: v.number(),
    keywords: v.array(v.string()),
    industries: v.optional(v.array(v.string())),
    excludeTerms: v.optional(v.array(v.string())),
    minRating: v.optional(v.number()),
    maxResults: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const errors = [];
    const warnings = [];

    // Validate location
    if (!args.location.trim()) {
      errors.push("Location is required");
    }

    // Validate radius
    if (args.radius < BUSINESS_RULES.SEARCH.MIN_RADIUS) {
      errors.push(`Radius must be at least ${BUSINESS_RULES.SEARCH.MIN_RADIUS / 1000}km`);
    }
    if (args.radius > BUSINESS_RULES.SEARCH.MAX_RADIUS) {
      errors.push(`Radius cannot exceed ${BUSINESS_RULES.SEARCH.MAX_RADIUS / 1000}km`);
    }

    // Validate keywords
    if (args.keywords.length === 0) {
      errors.push("At least one keyword is required");
    }
    if (args.keywords.length > BUSINESS_RULES.SEARCH.MAX_KEYWORDS) {
      errors.push(`Maximum ${BUSINESS_RULES.SEARCH.MAX_KEYWORDS} keywords allowed`);
    }

    // Validate exclude terms
    if (args.excludeTerms && args.excludeTerms.length > BUSINESS_RULES.SEARCH.MAX_EXCLUDE_TERMS) {
      errors.push(`Maximum ${BUSINESS_RULES.SEARCH.MAX_EXCLUDE_TERMS} exclude terms allowed`);
    }

    // Validate rating
    if (args.minRating && (args.minRating < 1 || args.minRating > 5)) {
      errors.push("Minimum rating must be between 1 and 5");
    }

    // Validate max results based on plan
    let maxAllowed: number = BUSINESS_RULES.SEARCH.MAX_RESULTS_FREE;
    if (user.plan === "pro") {
      maxAllowed = BUSINESS_RULES.SEARCH.MAX_RESULTS_PRO;
    } else if (user.plan === "enterprise") {
      maxAllowed = BUSINESS_RULES.SEARCH.MAX_RESULTS_ENTERPRISE;
    }

    if (args.maxResults > maxAllowed) {
      errors.push(`Your ${user.plan} plan allows maximum ${maxAllowed} results per search`);
    }

    // Check credit requirements
    const estimatedCost = args.maxResults * 3; // Rough estimate: 1 for discovery + 2 for enrichment
    if (user.credits < estimatedCost) {
      warnings.push(`This search may require approximately ${estimatedCost} credits. You have ${user.credits} credits remaining.`);
    }

    // Performance warnings
    if (args.maxResults > 100) {
      warnings.push("Large searches may take several minutes to complete");
    }

    if (args.radius > 25000) {
      warnings.push("Large search radius may return generic results");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      estimatedCost,
      estimatedDuration: Math.ceil(args.maxResults / 20) * 30, // Seconds
    };
  },
});

// Get search statistics for dashboard
export const getSearchStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Get all user searches
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Calculate stats
    const totalSearches = searches.length;
    const completedSearches = searches.filter(s => s.status === "completed");
    const inProgressSearches = searches.filter(s => s.status === "in_progress");
    const failedSearches = searches.filter(s => s.status === "failed");

    // Get total leads from completed searches
    const totalLeads = completedSearches.reduce((total, search) => 
      total + (search.results?.totalFound || 0), 0
    );

    // Calculate average completion time for completed searches
    const completedWithDuration = completedSearches.filter(s => 
      s.completedAt && s.createdAt
    );
    const avgCompletionTime = completedWithDuration.length > 0
      ? completedWithDuration.reduce((total, search) => 
          total + (search.completedAt! - search.createdAt), 0
        ) / completedWithDuration.length
      : 0;

    return {
      totalSearches,
      completedSearches: completedSearches.length,
      inProgressSearches: inProgressSearches.length,
      failedSearches: failedSearches.length,
      totalLeads,
      avgCompletionTime: Math.round(avgCompletionTime / 1000), // Convert to seconds
      completionRate: totalSearches > 0 
        ? Math.round((completedSearches.length / totalSearches) * 100) 
        : 0,
    };
  },
});