import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get leads for a search
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

// Export leads (internal function)
export const exportLeads = query({
  args: {
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    // This is an internal export function, used by other backend functions
    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId));

    if (args.searchId) {
      const searchId = args.searchId;
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .filter((q) => q.eq(q.field("userId"), args.userId));
    }

    const leads = await query.collect();

    // Format leads for export with enhanced research data
    return leads.map((lead) => {
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
  },
});

// Get user leads with pagination (OPTIMIZED)
export const getUserLeads = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
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

// Get lead statistics for user (OPTIMIZED VERSION)
export const getLeadStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // OPTIMIZATION: Only fetch minimal fields needed for stats
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Use simple counters instead of arrays
    let totalLeads = 0;
    let enrichedLeads = 0;
    let analyzedLeads = 0;
    let qualifiedLeads = 0;
    let contactedLeads = 0;
    let relevanceSum = 0;
    let relevanceCount = 0;

    // Single pass through leads for all calculations
    for (const lead of leads) {
      totalLeads++;

      if (lead.enrichmentStatus === "completed") {
        enrichedLeads++;
      }

      if (lead.aiAnalysis) {
        analyzedLeads++;

        if (lead.aiAnalysis.relevanceScore) {
          relevanceSum += lead.aiAnalysis.relevanceScore;
          relevanceCount++;
        }
      }

      if (lead.status === "qualified") {
        qualifiedLeads++;
      }

      if (lead.status === "contacted") {
        contactedLeads++;
      }
    }

    const avgRelevanceScore =
      relevanceCount > 0 ? relevanceSum / relevanceCount : 0;

    return {
      totalLeads,
      enrichedLeads,
      analyzedLeads,
      qualifiedLeads,
      contactedLeads,
      enrichmentRate:
        totalLeads > 0 ? Math.round((enrichedLeads / totalLeads) * 100) : 0,
      analysisRate:
        totalLeads > 0 ? Math.round((analyzedLeads / totalLeads) * 100) : 0,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100),
      conversionRate:
        totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0,
    };
  },
});
