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

    // Create new lead with proper optional property handling
    const leadData: any = {
      searchId: args.searchId,
      userId: args.userId,
      businessName: args.businessName,
      address: args.address,
      placeId: args.placeId,
      location: args.location,
      enrichmentStatus: "pending",
      status: "new",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Add optional fields only if they exist
    if (args.phone) leadData.phone = args.phone;
    if (args.website) leadData.website = args.website;
    if (args.rating !== undefined) leadData.rating = args.rating;
    if (args.reviewCount !== undefined) leadData.reviewCount = args.reviewCount;
    if (args.category) leadData.category = args.category;

    const leadId = await ctx.db.insert("leads", leadData);

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
        type: v.string(),
        confidence: v.number(),
      })),
      contacts: v.array(v.object({
        name: v.string(),
        title: v.optional(v.string()),
        email: v.optional(v.string()),
        linkedin: v.optional(v.string()),
        confidence: v.number(),
        domain: v.optional(v.string()),
      })),
      socialProfiles: v.optional(v.object({
        linkedin: v.optional(v.string()),
        twitter: v.optional(v.string()),
        facebook: v.optional(v.string()),
      })),
      // Fallback system tracking
      fallbackUsed: v.optional(v.boolean()),
      fallbackReason: v.optional(v.string()),
    }),
    enrichmentStatus: v.union(
      v.literal("completed"),
      v.literal("completed_fallback"),
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

// Moved duplicate functions to bottom with enhanced functionality

// Update lead analysis attempt counter
export const updateLeadAnalysisAttempt = internalMutation({
  args: {
    leadId: v.id("leads"),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      analysisAttempts: args.attempt,
      lastAnalysisAttempt: Date.now(),
    });
  },
});

// Update lead analysis error
export const updateLeadAnalysisError = internalMutation({
  args: {
    leadId: v.id("leads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      analysisError: args.error,
    });
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
    const enrichedLeads = leads.filter(l => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback").length;
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

// Get leads pending enrichment for a specific search
export const getLeadsPendingEnrichment = internalQuery({
  args: { 
    searchId: v.optional(v.id("searches")),
    limit: v.optional(v.number()) 
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    
    let query = ctx.db
      .query("leads")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "pending"));
    
    if (args.searchId) {
      query = query.filter((q) => q.eq(q.field("searchId"), args.searchId));
    }
    
    // Get all pending leads first, then filter out those with emails in code
    const allPendingLeads = await query.collect();
    
    // Filter out leads that already have email addresses from enrichment
    const leadsNeedingEnrichment = allPendingLeads.filter(lead => {
      if (!lead.contactInfo) return true;
      if (!lead.contactInfo.emails) return true;
      return lead.contactInfo.emails.length === 0;
    });
    
    return leadsNeedingEnrichment.slice(0, limit);
  },
});

// Get enriched leads ready for analysis (must have emails)
export const getEnrichedLeadsForAnalysis = internalQuery({
  args: { 
    searchId: v.id("searches"),
    limit: v.optional(v.number()) 
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    const MAX_ANALYSIS_ATTEMPTS = 3; // Maximum retry attempts
    
    const candidateLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) => 
        q.and(
          q.or(
            q.eq(q.field("enrichmentStatus"), "completed"),
            q.eq(q.field("enrichmentStatus"), "completed_fallback")
          ),
          q.eq(q.field("aiAnalysis"), undefined),
          // Only analyze leads that have email addresses
          q.and(
            q.neq(q.field("contactInfo"), undefined),
            q.neq(q.field("contactInfo.emails"), undefined)
          )
        )
      )
      .collect();
    
    // Filter to ensure emails array has actual content and hasn't exceeded retry limits
    const enrichedLeads = candidateLeads.filter(lead => {
      // Check if lead has emails
      if (!lead.contactInfo?.emails || lead.contactInfo.emails.length === 0) {
        return false;
      }
      
      // Check if lead has exceeded retry attempts
      const attempts = lead.analysisAttempts || 0;
      if (attempts >= MAX_ANALYSIS_ATTEMPTS) {
        console.log(`Lead ${lead._id} has exceeded max analysis attempts (${attempts}/${MAX_ANALYSIS_ATTEMPTS})`);
        return false;
      }
      
      return true;
    });
    
    return enrichedLeads.slice(0, limit);
  },
});

// Get leads pending analysis for a specific search
export const getLeadsPendingAnalysis = internalQuery({
  args: { 
    searchId: v.optional(v.id("searches")),
    limit: v.optional(v.number()) 
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    
    let query = ctx.db
      .query("leads")
      .filter((q) => q.and(
        q.or(
          q.eq(q.field("enrichmentStatus"), "completed"),
          q.eq(q.field("enrichmentStatus"), "completed_fallback")
        ),
        q.eq(q.field("aiAnalysis"), undefined)
      ));
    
    if (args.searchId) {
      query = query.filter((q) => q.eq(q.field("searchId"), args.searchId));
    }
    
    return await query.take(limit);
  },
});

// Get lead count for a search
export const getLeadCount = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();
    
    return leads.length;
  },
});

// Get search statistics
export const getSearchStatistics = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const totalLeads = leads.length;
    const enrichedLeads = leads.filter(l => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback").length;
    const analyzedLeads = leads.filter(l => l.aiAnalysis).length;

    // Calculate average relevance score
    const leadsWithRelevance = leads.filter(l => l.aiAnalysis?.relevanceScore);
    const avgRelevanceScore = leadsWithRelevance.length > 0 
      ? leadsWithRelevance.reduce((sum, lead) => sum + (lead.aiAnalysis?.relevanceScore || 0), 0) / leadsWithRelevance.length
      : 0;

    return {
      totalLeads,
      enrichedLeads,
      analyzedLeads,
      avgRelevanceScore,
    };
  },
});