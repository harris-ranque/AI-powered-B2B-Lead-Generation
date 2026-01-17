import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, getCurrentUser } from "../auth";

// Get leads for a search (FULL documents - use sparingly, prefer getLeadsListView)
export const getLeadsBySearch = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .order("desc")
      .collect();

    return leads;
  },
});

// Get leads for list view (LIGHTWEIGHT - only fields needed for display)
// Use this for lead tables/lists, use getLead() for full details on click
export const getLeadsListView = query({
  args: {
    searchId: v.id("searches"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    const pageSize = Math.min(args.limit || 25, 100); // Default 25, max 100

    const result = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .order("desc")
      .paginate({
        numItems: pageSize,
        cursor: args.cursor as any ?? null
      });

    // Return only fields needed for list display (excludes heavy aiAnalysis)
    const leads = result.page.map(lead => ({
      _id: lead._id,
      businessName: lead.businessName,
      formattedAddress: lead.location?.formattedAddress || "",
      phone: lead.phone || "",
      website: lead.website || "",
      primaryEmail: lead.contactInfo?.emails?.[0]?.email || "",
      emailCount: lead.contactInfo?.emails?.length || 0,
      status: lead.status,
      enrichmentStatus: lead.enrichmentStatus,
      enrichmentProvider: lead.enrichmentProvider,
      // Just scores and flags, not full analysis content
      relevanceScore: lead.aiAnalysis?.relevanceScore ?? null,
      hasEmailSequence: !!(lead.generatedEmails?.length),
      hasResearch: !!lead.aiAnalysis?.leadAnalysis,
      researchTier: lead.aiAnalysis?.researchTier || null,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      createdAt: lead._creationTime,
    }));

    return {
      leads,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Export leads with pagination support to avoid 16MB limit
// When searchId is provided, exports leads for that search (scoped, typically safe)
// When no searchId, uses pagination to handle users with many leads
export const exportLeads = query({
  args: {
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
    limit: v.optional(v.number()), // Default 5000 per page for exports
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit || 5000, 5000);

    let queryBuilder;
    if (args.searchId) {
      // Scoped to specific search - use that index
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId!))
        .filter((q) => q.eq(q.field("userId"), args.userId));
    } else {
      // All user leads - use user index with pagination
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", args.userId));
    }

    const result = await queryBuilder
      .order("desc")
      .paginate({ numItems: pageSize, cursor: args.cursor as any ?? null });

    const leads = result.page;

    // Format leads for export with enhanced research data
    const formattedLeads = leads.map((lead) => {
      const companyData = lead.aiAnalysis?.companyData;
      const researchTier = lead.aiAnalysis?.researchTier || "unknown";

      // Research tier label mapping
      const tierLabels: Record<string, string> = {
        "basic": "Basic (Tavily)",
        "pro": "Pro (Sonar Pro)",
        "deep": "Deep (Deep Research)",
        "unknown": "Not Available"
      };

      return {
        // Existing basic fields (9 columns)
        id: lead._id,
        name: lead.businessName,
        address: lead.location.formattedAddress,
        phone: lead.phone || "",
        website: lead.website || "",
        email: lead.contactInfo?.emails?.[0]?.email || "",
        rating: lead.rating || 0,
        reviewCount: lead.reviewCount || 0,
        placeId: lead.placeId,
        enrichmentStatus: lead.enrichmentStatus,

        // New research tier fields (2 columns)
        researchTier: researchTier,
        researchTierLabel: tierLabels[researchTier] || "Unknown",

        // Annual revenue fields (3 columns)
        annualRevenueAmount: companyData?.annual_revenue?.amount || "",
        annualRevenueYear: companyData?.annual_revenue?.year || "",
        annualRevenueSource: companyData?.annual_revenue?.source || "",

        // Employee count fields (3 columns)
        employeeCount: companyData?.employee_count?.count || "",
        employeeCountAsOf: companyData?.employee_count?.as_of || "",
        employeeCountSource: companyData?.employee_count?.source || "",

        // Leadership fields (6 columns - top 3 leaders)
        leadership1Name: companyData?.leadership_names?.[0]?.name || "",
        leadership1Title: companyData?.leadership_names?.[0]?.title || "",
        leadership2Name: companyData?.leadership_names?.[1]?.name || "",
        leadership2Title: companyData?.leadership_names?.[1]?.title || "",
        leadership3Name: companyData?.leadership_names?.[2]?.name || "",
        leadership3Title: companyData?.leadership_names?.[2]?.title || "",

        // Recent news fields (6 columns - top 3 news items)
        recentNews1: companyData?.recent_news?.[0]?.event || "",
        recentNews1Date: companyData?.recent_news?.[0]?.date || "",
        recentNews2: companyData?.recent_news?.[1]?.event || "",
        recentNews2Date: companyData?.recent_news?.[1]?.date || "",
        recentNews3: companyData?.recent_news?.[2]?.event || "",
        recentNews3Date: companyData?.recent_news?.[2]?.date || "",

        // Funding details fields (3 columns)
        fundingTotalRaised: companyData?.funding_details?.total_raised || "",
        fundingLatestRound: companyData?.funding_details?.latest_round || "",
        fundingSource: companyData?.funding_details?.source || "",

        // Full research report fields (3 columns)
        fullResearchReport: lead.aiAnalysis?.leadAnalysis?.research_metadata?.comprehensive_report ||
                           lead.aiAnalysis?.leadAnalysis?.comprehensive_report || "",
        perplexityCitations: JSON.stringify(lead.aiAnalysis?.leadAnalysis?.research_metadata?.citations || []),
        researchConfidenceScore: lead.aiAnalysis?.leadAnalysis?.research_metadata?.confidence_score || "",

        // Timestamps
        createdAt: new Date(lead.createdAt || lead._creationTime).toISOString(),
        updatedAt: new Date(lead.updatedAt || lead._creationTime).toISOString(),
      };
    });

    return {
      leads: formattedLeads,
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get user leads with pagination (FULL documents - use sparingly)
// Returns null if not authenticated (allows query during auth hydration)
export const getUserLeads = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    // OPTIMIZATION: Reduce default limit from 20 to 10
    const limit = Math.min(args.limit || 10, 50); // Cap at 50 leads max
    const offset = args.offset || 0;

    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.searchId) {
      const searchId = args.searchId;
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .filter((q) => q.eq(q.field("userId"), user._id));
    }

    const leads = await query.order("desc").take(limit + offset);

    return leads.slice(offset);
  },
});

// Get user leads for list view (LIGHTWEIGHT with cursor pagination)
// Use this for lead tables/history, use getLead() for full details on click
export const getUserLeadsListView = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const pageSize = Math.min(args.limit || 25, 100); // Default 25, max 100

    let queryBuilder;

    if (args.searchId) {
      // Verify user owns the search
      const search = await ctx.db.get(args.searchId);
      if (!search || search.userId !== user._id) {
        throw new Error("Search not found or access denied");
      }
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId!));
    } else {
      queryBuilder = ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", user._id));
    }

    const result = await queryBuilder
      .order("desc")
      .paginate({
        numItems: pageSize,
        cursor: args.cursor as any ?? null
      });

    // Return only fields needed for list display
    const leads = result.page.map(lead => ({
      _id: lead._id,
      businessName: lead.businessName,
      formattedAddress: lead.location?.formattedAddress || "",
      phone: lead.phone || "",
      website: lead.website || "",
      primaryEmail: lead.contactInfo?.emails?.[0]?.email || "",
      emailCount: lead.contactInfo?.emails?.length || 0,
      status: lead.status,
      enrichmentStatus: lead.enrichmentStatus,
      enrichmentProvider: lead.enrichmentProvider,
      relevanceScore: lead.aiAnalysis?.relevanceScore ?? null,
      hasEmailSequence: !!(lead.generatedEmails?.length),
      hasResearch: !!lead.aiAnalysis?.leadAnalysis,
      researchTier: lead.aiAnalysis?.researchTier || null,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      searchId: lead.searchId,
      createdAt: lead._creationTime,
    }));

    return {
      leads,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get single lead by ID
export const getLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    return lead;
  },
});

// Get email sequences for a lead
export const getEmailSequences = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify lead belongs to user
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    // Get email sequences (LangGraph requests) for this lead
    const emailRequests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .filter((q) => q.eq(q.field("type"), "email_generation"))
      .order("desc")
      .collect();

    // Format as email sequences
    return emailRequests.map((request) => ({
      id: request._id,
      requestId: request.requestId,
      status: request.status,
      emailType: request.inputData?.emailType || "initial",
      subject: request.outputData?.subject || null,
      content: request.outputData?.content || null,
      createdAt: request.createdAt,
      completedAt: request.completedAt || null,
      error: request.error || null,
    }));
  },
});

// Get enrichment progress for a specific search (for user-facing status updates)
export const getEnrichmentProgress = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Get all leads for this search
    const allLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Count by enrichment status
    const pending = allLeads.filter(l => l.enrichmentStatus === "pending").length;
    const inProgress = allLeads.filter(l => l.enrichmentStatus === "in_progress").length;
    const completed = allLeads.filter(l =>
      l.enrichmentStatus === "completed" ||
      l.enrichmentStatus === "completed_fallback"
    ).length;
    const failed = allLeads.filter(l => l.enrichmentStatus === "failed").length;

    // Calculate completion percentage
    const total = allLeads.length;
    const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Get provider breakdown for completed leads
    const findymailCount = allLeads.filter(l => l.enrichmentProvider === "findymail").length;

    return {
      searchId: args.searchId,
      searchStatus: search.status,
      total,
      pending,
      inProgress,
      completed,
      failed,
      percentComplete,
      providers: {
        findymail: findymailCount,
      },
      isComplete: pending === 0 && inProgress === 0,
      isPaused: search.enrichmentPaused || false,
    };
  },
});

// Get lead statistics for user
// OPTIMIZED: Aggregates from searches table (much lighter than leads)
// Searches already have pre-computed stats in progress/results fields
// Returns null if not authenticated (allows query during auth hydration)
export const getLeadStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    // Aggregate from searches table - MUCH lighter than loading all leads
    // Each search has pre-computed stats in results.totalFound, results.enrichedCount, etc.
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Aggregate stats from all searches
    let totalLeads = 0;
    let enrichedLeads = 0;
    let analyzedLeads = 0;
    let relevanceSum = 0;
    let relevanceCount = 0;
    let thisWeekLeads = 0;

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const search of searches) {
      // Use pre-computed stats from search.results
      const searchTotal = search.results?.totalFound || 0;
      const searchEnriched = search.results?.enrichedCount || 0;
      const searchAnalyzed = search.results?.analyzedCount || 0;
      const searchAvgRelevance = search.results?.avgRelevanceScore;

      totalLeads += searchTotal;
      enrichedLeads += searchEnriched;
      analyzedLeads += searchAnalyzed;

      // Calculate weighted average for relevance score
      if (searchAvgRelevance && searchAnalyzed > 0) {
        relevanceSum += searchAvgRelevance * searchAnalyzed;
        relevanceCount += searchAnalyzed;
      }

      // Count leads created this week (use search creation time as proxy)
      if (search._creationTime >= oneWeekAgo) {
        thisWeekLeads += searchTotal;
      }
    }

    const avgRelevanceScore =
      relevanceCount > 0 ? relevanceSum / relevanceCount : 0;

    return {
      // Primary stats (from search aggregation)
      totalLeads,
      enrichedLeads,
      analyzedLeads,
      // withEmails is same as enrichedLeads (leads with contact info)
      withEmails: enrichedLeads,
      // thisWeek is approximate based on search creation dates
      thisWeek: thisWeekLeads,
      // Rates
      enrichmentRate:
        totalLeads > 0 ? Math.round((enrichedLeads / totalLeads) * 100) : 0,
      analysisRate:
        totalLeads > 0 ? Math.round((analyzedLeads / totalLeads) * 100) : 0,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100),
      // Note: qualifiedLeads/contactedLeads/conversionRate not available from search aggregation
      // These would require scanning leads or pre-computing on status changes
      qualifiedLeads: 0,
      contactedLeads: 0,
      conversionRate: 0,
    };
  },
});
