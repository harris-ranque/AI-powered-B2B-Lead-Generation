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

    const avgRelevanceScore = relevanceCount > 0 ? relevanceSum / relevanceCount : 0;

    return {
      totalLeads,
      enrichedLeads,
      analyzedLeads,
      qualifiedLeads,
      contactedLeads,
      enrichmentRate: totalLeads > 0 ? 
        Math.round((enrichedLeads / totalLeads) * 100) : 0,
      analysisRate: totalLeads > 0 ? 
        Math.round((analyzedLeads / totalLeads) * 100) : 0,
      avgRelevanceScore: Math.round(avgRelevanceScore * 100),
      conversionRate: totalLeads > 0 ? 
        Math.round((qualifiedLeads / totalLeads) * 100) : 0,
    };
  },
});