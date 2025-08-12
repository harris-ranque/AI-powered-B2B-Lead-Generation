import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { STATUS } from "../lib/constants";

// Internal function to create lead from search
export const createLeadFromSearch = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    businessName: v.string(),
    address: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    rating: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
    category: v.optional(v.string()),
    placeId: v.string(),
    location: v.object({
      lat: v.number(),
      lng: v.number(),
      formattedAddress: v.string(),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      country: v.optional(v.string()),
      postalCode: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Check if lead already exists by placeId
    const existingLead = await ctx.db
      .query("leads")
      .withIndex("by_place_id", (q) => q.eq("placeId", args.placeId))
      .filter((q) => q.eq(q.field("searchId"), args.searchId))
      .unique();

    if (existingLead) {
      return existingLead._id;
    }

    // Create new lead
    const leadId = await ctx.db.insert("leads", {
      searchId: args.searchId,
      userId: args.userId,
      businessName: args.businessName,
      address: args.address,
      phone: args.phone,
      website: args.website,
      rating: args.rating,
      reviewCount: args.reviewCount,
      category: args.category,
      placeId: args.placeId,
      location: args.location,
      enrichmentStatus: STATUS.ENRICHMENT.PENDING,
      status: STATUS.LEAD.NEW,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return leadId;
  },
});

// Internal function to update lead enrichment data
export const updateLeadEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    contactInfo: v.object({
      emails: v.array(v.object({
        email: v.string(),
        type: v.optional(v.string()),
        confidence: v.optional(v.number()),
      })),
      contacts: v.array(v.object({
        name: v.string(),
        title: v.optional(v.string()),
        email: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        confidence: v.optional(v.number()),
      })),
      socialProfiles: v.optional(v.object({
        linkedin: v.optional(v.string()),
        twitter: v.optional(v.string()),
        facebook: v.optional(v.string()),
      })),
    }),
    enrichmentStatus: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("in_progress")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      contactInfo: args.contactInfo,
      enrichmentStatus: args.enrichmentStatus,
      updatedAt: Date.now(),
    });
  },
});

// Internal function to update lead AI analysis
export const updateLeadAnalysis = internalMutation({
  args: {
    leadId: v.id("leads"),
    aiAnalysis: v.object({
      relevanceScore: v.number(),
      painPoints: v.array(v.string()),
      valueMatches: v.array(v.string()),
      fitAssessment: v.string(),
      recommendedApproach: v.string(),
      confidence: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      aiAnalysis: args.aiAnalysis,
      updatedAt: Date.now(),
    });
  },
});

// Internal function to get leads pending enrichment
export const getLeadsPendingEnrichment = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    
    return await ctx.db
      .query("leads")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "pending"))
      .take(limit);
  },
});

// Internal function to get leads pending AI analysis
export const getLeadsPendingAnalysis = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "completed"))
      .filter((q) => q.eq(q.field("aiAnalysis"), undefined))
      .take(limit);

    return leads;
  },
});

// Internal function to get lead by ID for processing
export const getLeadForProcessing = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.leadId);
  },
});

// Internal function to bulk update lead statuses
export const bulkUpdateLeadStatus = internalMutation({
  args: {
    leadIds: v.array(v.id("leads")),
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified")
    ),
  },
  handler: async (ctx, args) => {
    for (const leadId of args.leadIds) {
      await ctx.db.patch(leadId, {
        status: args.status,
        updatedAt: Date.now(),
      });
    }
  },
});

// Internal function to add generated email to lead
export const addGeneratedEmailToLead = internalMutation({
  args: {
    leadId: v.id("leads"),
    emailSequenceId: v.id("emailSequences"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    
    if (!lead) {
      throw new Error("Lead not found");
    }

    const currentEmails = lead.generatedEmails || [];
    
    await ctx.db.patch(args.leadId, {
      generatedEmails: [...currentEmails, args.emailSequenceId],
      updatedAt: Date.now(),
    });
  },
});

// Internal function to get search progress for updating
export const getSearchProgressData = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const totalLeads = leads.length;
    const enrichedLeads = leads.filter(l => l.enrichmentStatus === "completed").length;
    const analyzedLeads = leads.filter(l => l.aiAnalysis).length;

    // Calculate average relevance score
    const leadsWithRelevance = leads.filter(l => l.aiAnalysis?.relevanceScore);
    const avgRelevanceScore = leadsWithRelevance.length > 0 
      ? leadsWithRelevance.reduce((sum, lead) => sum + (lead.aiAnalysis?.relevanceScore || 0), 0) / leadsWithRelevance.length
      : undefined;

    return {
      totalLeads,
      enrichedLeads,
      analyzedLeads,
      avgRelevanceScore,
    };
  },
});