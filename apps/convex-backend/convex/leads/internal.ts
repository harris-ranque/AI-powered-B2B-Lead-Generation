import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Internal query to get lead without auth check
export const getLeadInternal = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.leadId);
  },
});

// Internal query to get all leads for a search
export const getSearchLeadsInternal = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();
  },
});

// Internal query to get unenriched leads
export const getUnenrichedLeads = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) =>
        q.or(
          q.eq(q.field("enrichmentStatus"), "pending"),
          q.eq(q.field("enrichmentStatus"), "failed"),
        ),
      )
      .collect();
  },
});

// Internal mutation to update enrichment status
export const updateEnrichmentStatus = internalMutation({
  args: {
    leadId: v.id("leads"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("completed_fallback"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      enrichmentStatus: args.status,
      updatedAt: Date.now(),
      ...(args.error && { enrichmentData: { error: args.error } }),
    });
  },
});

// Internal mutation to update lead with enrichment data
export const updateLeadEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    enrichmentData: v.any(),
    status: v.union(
      v.literal("completed"),
      v.literal("completed_fallback"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      enrichmentStatus: args.status,
      enrichmentData: args.enrichmentData,
      updatedAt: Date.now(),
    };

    // Extract contact info from enrichment data
    if (args.enrichmentData) {
      const contactInfo: any = {
        emails: args.enrichmentData.emails || [],
        contacts: args.enrichmentData.contacts || [],
        socialProfiles: args.enrichmentData.socialProfiles || {},
      };

      if (args.status === "completed_fallback") {
        contactInfo.fallbackUsed = true;
        contactInfo.fallbackReason =
          args.enrichmentData.fallbackReason || "FindyMail unavailable";
      }

      updateData.contactInfo = contactInfo;

      // Update top-level fields if available
      if (args.enrichmentData.phone) {
        updateData.phone = args.enrichmentData.phone;
      }

      if (args.enrichmentData.linkedin) {
        if (!contactInfo.socialProfiles) {
          contactInfo.socialProfiles = {};
        }
        contactInfo.socialProfiles.linkedin = args.enrichmentData.linkedin;
      }
    }

    await ctx.db.patch(args.leadId, updateData);
  },
});

// Internal mutation to create a lead (for scheduled/system actions)
export const createLeadInternal = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    leadData: v.object({
      businessName: v.string(),
      address: v.string(),
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
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      rating: v.optional(v.number()),
      reviewCount: v.optional(v.number()),
      category: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Trust caller to ensure search exists and belongs to user
    const leadId = await ctx.db.insert("leads", {
      userId: args.userId,
      searchId: args.searchId,
      businessName: args.leadData.businessName,
      address: args.leadData.address,
      placeId: args.leadData.placeId,
      location: args.leadData.location,
      phone: args.leadData.phone,
      website: args.leadData.website,
      rating: args.leadData.rating,
      reviewCount: args.leadData.reviewCount,
      category: args.leadData.category,
      enrichmentStatus: "pending",
      status: "new",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return leadId;
  },
});

// Internal query to get domain cache
export const getDomainCache = internalQuery({
  args: {
    domain: v.string(),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("findymailDomainCache")
      .withIndex("by_domain_search", (q) =>
        q.eq("domain", args.domain).eq("searchId", args.searchId),
      )
      .first();

    // Check if cache is still valid
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    return null;
  },
});

// Internal mutation to cache domain data
export const cacheDomainData = internalMutation({
  args: {
    domain: v.string(),
    searchId: v.id("searches"),
    enrichmentData: v.object({
      emails: v.array(
        v.object({
          email: v.string(),
          type: v.string(),
          confidence: v.number(),
        }),
      ),
      contacts: v.array(
        v.object({
          name: v.string(),
          title: v.optional(v.string()),
          email: v.optional(v.string()),
          linkedin: v.optional(v.string()),
          confidence: v.number(),
          domain: v.optional(v.string()),
        }),
      ),
      socialProfiles: v.optional(
        v.object({
          linkedin: v.optional(v.string()),
          twitter: v.optional(v.string()),
          facebook: v.optional(v.string()),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    // Check if cache already exists
    const existing = await ctx.db
      .query("findymailDomainCache")
      .withIndex("by_domain_search", (q) =>
        q.eq("domain", args.domain).eq("searchId", args.searchId),
      )
      .first();

    if (existing) {
      // Update existing cache
      await ctx.db.patch(existing._id, {
        enrichmentData: args.enrichmentData,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });
    } else {
      // Create new cache entry
      await ctx.db.insert("findymailDomainCache", {
        domain: args.domain,
        searchId: args.searchId,
        enrichmentData: args.enrichmentData,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });
    }
  },
});

// Internal mutation to update lead with AI analysis results
export const updateLeadAnalysis = internalMutation({
  args: {
    leadId: v.id("leads"),
    aiAnalysis: v.object({
      relevanceScore: v.number(),
      painPoints: v.array(v.string()),
      valueMatches: v.array(v.string()),
      recommendations: v.array(v.string()),
      leadAnalysis: v.any(),
      processingTime: v.number(),
      confidence: v.optional(v.number()),
      // Legacy fields for backward compatibility
      fitAssessment: v.optional(v.string()),
      recommendedApproach: v.optional(v.string()),
    }),
    emailContent: v.optional(
      v.object({
        subject: v.string(),
        body: v.string(),
        personalizationNotes: v.array(v.string()),
        estimatedEffectiveness: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      aiAnalysis: args.aiAnalysis,
      updatedAt: Date.now(),
    };

    if (args.emailContent) {
      updateData.emailContent = args.emailContent;
    }

    // Track analysis attempts
    const currentLead = await ctx.db.get(args.leadId);
    if (currentLead) {
      updateData.analysisAttempts = (currentLead.analysisAttempts || 0) + 1;
      updateData.lastAnalysisAttempt = Date.now();

      // Clear any previous analysis errors if this was successful
      if (args.aiAnalysis.relevanceScore > 0) {
        updateData.analysisError = undefined;
      } else if (args.aiAnalysis.leadAnalysis?.error) {
        updateData.analysisError = args.aiAnalysis.leadAnalysis.error;
      }
    }

    await ctx.db.patch(args.leadId, updateData);
  },
});

// Internal mutation to create email sequence from LangGraph results
export const createEmailSequence = internalMutation({
  args: {
    leadId: v.id("leads"),
    userId: v.id("users"),
    requestId: v.string(),
    emailContent: v.object({
      subject: v.string(),
      body: v.string(),
      personalizationNotes: v.array(v.string()),
      estimatedEffectiveness: v.number(),
    }),
    agentResults: v.optional(
      v.array(
        v.object({
          agentName: v.string(),
          role: v.string(),
          output: v.string(),
          confidenceScore: v.number(),
          executionTime: v.number(),
        }),
      ),
    ),
    processingTime: v.optional(v.number()),
    recommendations: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("emailSequences", {
      leadId: args.leadId,
      userId: args.userId,
      requestId: args.requestId,
      subject: args.emailContent.subject,
      body: args.emailContent.body,
      tone: "professional",
      personalizationNotes: args.emailContent.personalizationNotes,
      sequenceType: "primary",
      sequenceOrder: 1,
      agentResults: args.agentResults || [],
      estimatedEffectiveness: args.emailContent.estimatedEffectiveness,
      recommendations: args.recommendations || [],
      processingTime: args.processingTime || 0,
      status: "generated",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// Internal query to get enriched leads
export const getEnrichedLeads = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) =>
        q.or(
          q.eq(q.field("enrichmentStatus"), "completed"),
          q.eq(q.field("enrichmentStatus"), "completed_fallback"),
        ),
      )
      .collect();
  },
});

// Internal query to get all leads for a user (for exports)
export const getUserLeadsInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});
