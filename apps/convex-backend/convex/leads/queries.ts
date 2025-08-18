import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Get leads for a specific search
export const getSearchLeads = query({
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
    enrichmentStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed")
    )),
    minRelevanceScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.userId !== user._id) {
      throw createError("Search not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    let leadsQuery = ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId));

    // Apply filters
    if (args.status) {
      leadsQuery = ctx.db
        .query("leads")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .filter((q) => q.eq(q.field("searchId"), args.searchId));
    }

    if (args.enrichmentStatus) {
      leadsQuery = ctx.db
        .query("leads")
        .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", args.enrichmentStatus!))
        .filter((q) => q.eq(q.field("searchId"), args.searchId));
    }

    let leads = await leadsQuery
      .order("desc")
      .take(limit + offset);

    // Apply additional filters
    if (args.minRelevanceScore !== undefined) {
      leads = leads.filter(lead => 
        lead.aiAnalysis?.relevanceScore && lead.aiAnalysis.relevanceScore >= args.minRelevanceScore!
      );
    }

    const paginatedLeads = leads.slice(offset, offset + limit);

    return {
      leads: paginatedLeads,
      total: leads.length,
      hasMore: leads.length > offset + limit,
      search,
    };
  },
});

// Get a specific lead by ID
export const getLeadById = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const lead = await ctx.db.get(args.leadId);
    
    if (!lead || lead.userId !== user._id) {
      throw createError("Lead not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    // Get generated emails for this lead
    const emailSequences = lead.generatedEmails ? 
      await Promise.all(
        lead.generatedEmails.map(emailId => ctx.db.get(emailId))
      ).then(emails => emails.filter(Boolean)) : [];

    return {
      lead,
      emailSequences,
    };
  },
});

// Get user's recent leads across all searches
export const getRecentLeads = query({
  args: {
    limit: v.optional(v.number()),
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

    const limit = args.limit || 20;

    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.status) {
      query = ctx.db
        .query("leads")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .filter((q) => q.eq(q.field("userId"), user._id));
    }

    const leads = await query
      .order("desc")
      .take(limit);

    return { leads };
  },
});

// Get lead statistics for dashboard
export const getLeadStatistics = query({
  args: {
    searchId: v.optional(v.id("searches")),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const days = args.days || 30;
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);

    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.searchId) {
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId!));
    }

    const leads = await query
      .filter((q) => q.gt(q.field("createdAt"), since))
      .collect();

    // Calculate statistics
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

    const enrichmentDistribution = {
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

    // Top categories
    const categoryCount: Record<string, number> = {};
    leads.forEach(lead => {
      if (lead.category) {
        categoryCount[lead.category] = (categoryCount[lead.category] || 0) + 1;
      }
    });

    const topCategories = Object.entries(categoryCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    // Conversion funnel
    const conversionFunnel = {
      discovered: totalLeads,
      enriched: enrichedLeads,
      analyzed: analyzedLeads,
      qualified: statusDistribution.qualified + statusDistribution.contacted + statusDistribution.nurturing + statusDistribution.converted,
      contacted: statusDistribution.contacted + statusDistribution.nurturing + statusDistribution.converted,
      converted: statusDistribution.converted,
    };

    return {
      totalLeads,
      statusDistribution,
      enrichmentDistribution,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100) / 100,
      topCategories,
      conversionFunnel,
      enrichmentRate: totalLeads > 0 ? Math.round((enrichedLeads / totalLeads) * 100) : 0,
      analysisRate: totalLeads > 0 ? Math.round((analyzedLeads / totalLeads) * 100) : 0,
      conversionRate: conversionFunnel.contacted > 0 ? Math.round((conversionFunnel.converted / conversionFunnel.contacted) * 100) : 0,
    };
  },
});

// Get leads with high relevance scores
export const getHighQualityLeads = query({
  args: {
    minRelevanceScore: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const minScore = args.minRelevanceScore || 0.7;
    const limit = args.limit || 20;

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.and(
          q.neq(q.field("aiAnalysis"), undefined),
          q.gte(q.field("aiAnalysis.relevanceScore"), minScore)
        )
      )
      .order("desc")
      .take(limit);

    return { 
      leads: leads.sort((a, b) => 
        (b.aiAnalysis?.relevanceScore || 0) - (a.aiAnalysis?.relevanceScore || 0)
      )
    };
  },
});

// Search leads by business name or category
export const searchLeads = query({
  args: {
    query: v.string(),
    searchId: v.optional(v.id("searches")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    if (args.query.length < 2) {
      return { leads: [] };
    }

    const limit = args.limit || 20;
    const searchQuery = args.query.toLowerCase();

    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.searchId) {
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId!));
    }

    const allLeads = await query.collect();

    // Filter leads by search query
    const filteredLeads = allLeads
      .filter(lead => 
        lead.businessName.toLowerCase().includes(searchQuery) ||
        (lead.category && lead.category.toLowerCase().includes(searchQuery)) ||
        (lead.address && lead.address.toLowerCase().includes(searchQuery))
      )
      .slice(0, limit);

    return { leads: filteredLeads };
  },
});

// Get leads that need attention (failed enrichment, low relevance, etc.)
export const getLeadsNeedingAttention = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 50;

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Categorize leads that need attention
    const needsAttention = {
      failedEnrichment: leads.filter(l => l.enrichmentStatus === "failed"),
      lowRelevance: leads.filter(l => l.aiAnalysis?.relevanceScore && l.aiAnalysis.relevanceScore < 0.3),
      missingContact: leads.filter(l => 
        l.enrichmentStatus === "completed" && 
        (!l.contactInfo?.emails || l.contactInfo.emails.length === 0)
      ),
      pendingEnrichment: leads.filter(l => l.enrichmentStatus === "pending"),
      noAnalysis: leads.filter(l => 
        l.enrichmentStatus === "completed" && !l.aiAnalysis
      ),
    };

    // Flatten and prioritize
    const prioritizedLeads = [
      ...needsAttention.failedEnrichment.map(lead => ({ 
        ...lead, 
        attentionReason: "Failed enrichment",
        priority: "high" as const
      })),
      ...needsAttention.missingContact.map(lead => ({ 
        ...lead, 
        attentionReason: "Missing contact information",
        priority: "medium" as const
      })),
      ...needsAttention.lowRelevance.map(lead => ({ 
        ...lead, 
        attentionReason: `Low relevance score (${Math.round((lead.aiAnalysis?.relevanceScore || 0) * 100)}%)`,
        priority: "low" as const
      })),
      ...needsAttention.pendingEnrichment.map(lead => ({ 
        ...lead, 
        attentionReason: "Pending enrichment",
        priority: "medium" as const
      })),
      ...needsAttention.noAnalysis.map(lead => ({ 
        ...lead, 
        attentionReason: "Missing AI analysis",
        priority: "medium" as const
      })),
    ].slice(0, limit);

    return {
      leads: prioritizedLeads,
      summary: {
        failedEnrichment: needsAttention.failedEnrichment.length,
        lowRelevance: needsAttention.lowRelevance.length,
        missingContact: needsAttention.missingContact.length,
        pendingEnrichment: needsAttention.pendingEnrichment.length,
        noAnalysis: needsAttention.noAnalysis.length,
      },
    };
  },
});

// Export leads data for external use
export const exportLeads = query({
  args: {
    searchId: v.id("searches"),
    format: v.union(v.literal("json"), v.literal("csv")),
    includeEmails: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.userId !== user._id) {
      throw createError("Search not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Prepare export data
    const exportData = leads.map(lead => ({
      businessName: lead.businessName,
      address: lead.address,
      phone: lead.phone,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      category: lead.category,
      status: lead.status,
      enrichmentStatus: lead.enrichmentStatus,
      primaryEmail: lead.contactInfo?.emails?.[0]?.email,
      primaryContact: lead.contactInfo?.contacts?.[0]?.name,
      contactTitle: lead.contactInfo?.contacts?.[0]?.title,
      linkedIn: lead.contactInfo?.socialProfiles?.linkedin,
      relevanceScore: lead.aiAnalysis?.relevanceScore,
      painPoints: lead.aiAnalysis?.painPoints?.join(", "),
      valueMatches: lead.aiAnalysis?.valueMatches?.join(", "),
      fitAssessment: lead.aiAnalysis?.fitAssessment,
      recommendedApproach: lead.aiAnalysis?.recommendedApproach,
      tags: lead.tags?.join(", "),
      notes: lead.notes,
      createdAt: new Date(lead.createdAt).toISOString(),
    }));

    if (args.format === "csv") {
      // Convert to CSV format
      const headers = Object.keys(exportData[0] || {}).join(",");
      const rows = exportData.map(row => 
        Object.values(row).map(value => 
          typeof value === "string" && value.includes(",") 
            ? `"${value.replace(/"/g, '""')}"` 
            : value
        ).join(",")
      );
      
      return [headers, ...rows].join("\n");
    }

    return JSON.stringify(exportData, null, 2);
  },
});

// Get all leads for the current user across all searches
export const getUserLeads = query({
  args: {
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

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // Get user's searches first
    const userSearches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    
    const searchIds = userSearches.map(search => search._id);

    if (searchIds.length === 0) {
      return [];
    }

    // Get leads for all user searches
    let allLeads = [];
    for (const searchId of searchIds) {
      let leadsQuery = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId));

      if (args.status) {
        leadsQuery = leadsQuery.filter((q) => q.eq(q.field("status"), args.status!));
      }

      const searchLeads = await leadsQuery.collect();
      allLeads.push(...searchLeads);
    }

    // Sort by creation time (most recent first) and paginate
    allLeads.sort((a, b) => b._creationTime - a._creationTime);
    
    const startIndex = offset;
    const endIndex = Math.min(startIndex + limit, allLeads.length);
    const paginatedLeads = allLeads.slice(startIndex, endIndex);

    return {
      page: paginatedLeads,
      isDone: endIndex >= allLeads.length,
      continueCursor: endIndex < allLeads.length ? endIndex.toString() : null,
    };
  },
});

// Get lead statistics for the current user
export const getLeadStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Get user's searches first
    const userSearches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    
    const searchIds = userSearches.map(search => search._id);

    if (searchIds.length === 0) {
      return {
        total: 0,
        byStatus: {},
        byEnrichment: {},
        averageRelevanceScore: 0,
        recentlyCreated: 0,
      };
    }

    // Get all leads for user's searches
    const allLeads = await ctx.db
      .query("leads")
      .filter((q) => q.or(...searchIds.map(id => q.eq(q.field("searchId"), id))))
      .collect();

    // Calculate statistics
    const byStatus = allLeads.reduce((acc, lead) => {
      acc[lead.status] = (acc[lead.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byEnrichment = allLeads.reduce((acc, lead) => {
      acc[lead.enrichmentStatus] = (acc[lead.enrichmentStatus] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const relevanceScores = allLeads
      .map(lead => lead.aiAnalysis?.relevanceScore)
      .filter((score): score is number => score !== undefined);
    
    const averageRelevanceScore = relevanceScores.length > 0 
      ? relevanceScores.reduce((sum, score) => sum + score, 0) / relevanceScores.length 
      : 0;

    // Leads created in the last 7 days
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyCreated = allLeads.filter(lead => lead.createdAt > weekAgo).length;

    return {
      total: allLeads.length,
      byStatus,
      byEnrichment,
      averageRelevanceScore,
      recentlyCreated,
    };
  },
});