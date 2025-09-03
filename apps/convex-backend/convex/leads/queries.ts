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

    // Stub implementation
    return [];
  },
});

// Export leads (internal function)
export const exportLeads = query({
  args: { 
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    return [];
  },
});

// Get user leads with pagination
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

    const limit = args.limit || 20;
    const offset = args.offset || 0;

    let query = ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.searchId) {
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId));
    }

    const leads = await query
      .order("desc")
      .take(limit + offset);

    return leads.slice(offset);
  },
});

// Get lead statistics for user
export const getLeadStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const enrichedLeads = leads.filter(l => l.enrichmentStatus === "completed");
    const analyzedLeads = leads.filter(l => l.aiAnalysis);
    const qualifiedLeads = leads.filter(l => l.status === "qualified");
    const contactedLeads = leads.filter(l => l.status === "contacted");

    // Calculate average relevance score
    const leadsWithAnalysis = leads.filter(l => l.aiAnalysis?.relevanceScore);
    const avgRelevanceScore = leadsWithAnalysis.length > 0 ?
      leadsWithAnalysis.reduce((sum, lead) => 
        sum + (lead.aiAnalysis?.relevanceScore || 0), 0
      ) / leadsWithAnalysis.length : 0;

    return {
      totalLeads: leads.length,
      enrichedLeads: enrichedLeads.length,
      analyzedLeads: analyzedLeads.length,
      qualifiedLeads: qualifiedLeads.length,
      contactedLeads: contactedLeads.length,
      enrichmentRate: leads.length > 0 ? 
        Math.round((enrichedLeads.length / leads.length) * 100) : 0,
      analysisRate: leads.length > 0 ? 
        Math.round((analyzedLeads.length / leads.length) * 100) : 0,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100),
      conversionRate: leads.length > 0 ? 
        Math.round((qualifiedLeads.length / leads.length) * 100) : 0,
    };
  },
});