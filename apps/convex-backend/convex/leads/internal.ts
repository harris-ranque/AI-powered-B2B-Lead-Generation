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
    const updateData: any = {
      enrichmentStatus: args.status,
      updatedAt: Date.now(),
    };

    // Clear contactInfo for failed enrichments to prevent false positives in UI
    if (args.status === "failed" || args.status === "completed_fallback") {
      updateData.contactInfo = {
        emails: [],
        contacts: [],
        socialProfiles: {},
      };
    }

    if (args.error) {
      updateData.enrichmentData = { error: args.error };
    }

    await ctx.db.patch(args.leadId, updateData);
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
    enrichmentProvider: v.optional(v.union(v.literal("findymail"), v.literal("icypeas"))),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      enrichmentStatus: args.status,
      enrichmentData: args.enrichmentData,
      enrichmentProvider: args.enrichmentProvider,
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
          args.enrichmentData.fallbackReason || `${args.enrichmentProvider || "Enrichment provider"} unavailable`;
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

    // FIRST: Check for duplicate within THIS search (for spatial tiling deduplication)
    const duplicateInSearch = await ctx.db
      .query("leads")
      .withIndex("by_search_place", (q) =>
        q.eq("searchId", args.searchId).eq("placeId", args.leadData.placeId)
      )
      .first();

    if (duplicateInSearch) {
      console.log(
        `Duplicate tile detected for placeId ${args.leadData.placeId} in search ${args.searchId}, skipping to prevent duplicate tiles`
      );
      return null; // Skip duplicate tile in this search
    }

    // SECOND: Check for duplicate at USER level (across all searches)
    const duplicateAcrossSearches = await ctx.db
      .query("leads")
      .withIndex("by_user_place", (q) =>
        q.eq("userId", args.userId).eq("placeId", args.leadData.placeId)
      )
      .first();

    if (duplicateAcrossSearches) {
      console.log(
        `Duplicate lead detected for placeId ${args.leadData.placeId} for user ${args.userId} (existing in search ${duplicateAcrossSearches.searchId}), skipping to prevent re-processing`
      );
      return null; // Skip duplicate, don't re-process business user already has
    }

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
    followUpEmails: v.optional(
      v.array(
        v.object({
          subject: v.string(),
          body: v.string(),
          delay_days: v.optional(v.number()),
        }),
      ),
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

    // Store follow-up emails in the lead record
    if (args.followUpEmails && args.followUpEmails.length > 0) {
      updateData.followUpEmails = args.followUpEmails;
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

// ============================================================================
// ASYNC ANALYSIS FUNCTIONS (Webhook-Based Architecture)
// ============================================================================

// Internal query to get leads ready for analysis
export const getLeadsForAnalysis = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    // Get leads with valid contact info and enrichment completed
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) =>
        q.and(
          // Enrichment completed
          q.or(
            q.eq(q.field("enrichmentStatus"), "completed"),
            q.eq(q.field("enrichmentStatus"), "completed_fallback"),
          ),
          // Not already analyzed
          q.or(
            q.eq(q.field("analysisStatus"), undefined),
            q.eq(q.field("analysisStatus"), "pending"),
            q.eq(q.field("analysisStatus"), "failed"),
            q.eq(q.field("analysisStatus"), "timeout"),
          ),
        ),
      )
      .collect();

    // Filter to only leads with valid contact information (email + name)
    return leads.filter((lead) => {
      const hasEmail = lead.contactInfo?.emails?.length && lead.contactInfo.emails.length > 0;
      const hasContactName =
        lead.contactInfo?.contacts?.length &&
        lead.contactInfo.contacts.length > 0 &&
        lead.contactInfo.contacts[0]?.name;
      return hasEmail && hasContactName;
    });
  },
});

// Internal mutation to mark lead as scheduled for analysis
export const markLeadAnalysisScheduled = internalMutation({
  args: {
    leadId: v.id("leads"),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return;
    }

    const attempts = typeof lead.analysisAttempts === "number" ? lead.analysisAttempts : 0;

    await ctx.db.patch(args.leadId, {
      analysisStatus: "scheduled",
      analysisScheduledAt: Date.now(),
      analysisRequestId: args.requestId,
      analysisAttempts: attempts,
      analysisStartedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

// Internal mutation to mark lead analysis as started
export const markLeadAnalysisStarted = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return;

    await ctx.db.patch(args.leadId, {
      analysisStatus: "processing",
      analysisStartedAt: Date.now(),
      lastAnalysisAttempt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// Internal mutation to mark lead analysis as completed
export const markLeadAnalysisCompleted = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      analysisStatus: "completed",
      analysisCompletedAt: Date.now(),
      analysisError: undefined, // Clear any previous errors
      updatedAt: Date.now(),
    });
  },
});

// Internal mutation to mark lead analysis as failed
export const markLeadAnalysisFailed = internalMutation({
  args: {
    leadId: v.id("leads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return;

    const attempts = (lead.analysisAttempts || 0) + 1;

    await ctx.db.patch(args.leadId, {
      analysisStatus: "failed",
      analysisError: args.error,
      analysisAttempts: attempts,
      lastAnalysisAttempt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

// Internal query to get stuck leads (scheduled but not completed)
export const getStuckLeads = internalQuery({
  args: {
    timeoutMinutes: v.number(), // e.g., 15 minutes
  },
  handler: async (ctx, args) => {
    const timeoutMs = args.timeoutMinutes * 60 * 1000;
    const cutoffTime = Date.now() - timeoutMs;

    // Get leads in "scheduled" or "processing" status that are older than timeout
    const allLeads = await ctx.db
      .query("leads")
      .withIndex("by_analysis_status", (q) => q.eq("analysisStatus", "scheduled"))
      .collect();

    const processingLeads = await ctx.db
      .query("leads")
      .withIndex("by_analysis_status", (q) => q.eq("analysisStatus", "processing"))
      .collect();

    const allPotentiallyStuck = [...allLeads, ...processingLeads];

    // Filter to only truly stuck leads
    return allPotentiallyStuck.filter((lead) => {
      const scheduledAt = lead.analysisScheduledAt || lead.createdAt;
      return scheduledAt < cutoffTime;
    });
  },
});

// Internal mutation to mark lead analysis as timeout
export const markLeadAnalysisTimeout = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) return;

    const attempts = (lead.analysisAttempts || 0) + 1;

    await ctx.db.patch(args.leadId, {
      analysisStatus: "timeout",
      analysisError: "Analysis request timed out after 15 minutes",
      analysisAttempts: attempts,
      lastAnalysisAttempt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
