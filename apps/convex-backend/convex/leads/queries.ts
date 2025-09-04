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
    let query = ctx.db.query("leads").withIndex("by_user", (q) => q.eq("userId", args.userId));

    if (args.searchId) {
      const searchId = args.searchId;
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .filter((q) => q.eq(q.field("userId"), args.userId));
    }

    const leads = await query.collect();

    // Format leads for export
    return leads.map(lead => ({
      id: lead._id,
      name: lead.businessName,
      address: lead.location.formattedAddress,
      phone: lead.phone,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      placeId: lead.placeId,
      enrichedEmails: lead.contactInfo?.emails || [],
      enrichmentStatus: lead.enrichmentStatus,
      createdAt: new Date(lead.createdAt || lead._creationTime).toISOString(),
      updatedAt: new Date(lead.updatedAt || lead._creationTime).toISOString(),
    }));
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
      const searchId = args.searchId;
      query = ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .filter((q) => q.eq(q.field("userId"), user._id));
    }

    const leads = await query
      .order("desc")
      .take(limit + offset);

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
    return emailRequests.map(request => ({
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