import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  normalizeAddress,
  normalizePlaceName,
  extractPrimaryEmail,
} from "../lib/deduplication";

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

// Internal mutation to check for email duplicates after enrichment
export const checkEmailDuplication = internalMutation({
  args: {
    leadId: v.id("leads"),
    userId: v.id("users"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Get the lead with enrichment data
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !lead.contactInfo) {
      return { isDuplicate: false };
    }

    // Get user preferences
    const user = await ctx.db.get(args.userId);
    const search = await ctx.db.get(args.searchId);
    const enableEmailDedup =
      search?.parameters?.deduplication?.enableEmailDedup ??
      user?.preferences?.enableEmailDedup ??
      true;

    if (!enableEmailDedup) {
      return { isDuplicate: false };
    }

    // Extract primary email from contact info
    const primaryEmail = extractPrimaryEmail(lead.contactInfo);
    if (!primaryEmail) {
      return { isDuplicate: false };
    }

    // Check for duplicate email across all user's leads (excluding this one)
    const allUserLeads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const duplicateByEmail = allUserLeads.find(existingLead => {
      // Skip comparing with itself
      if (existingLead._id === args.leadId) {
        return false;
      }

      // Check if this lead has the same email
      const existingEmail = extractPrimaryEmail(existingLead.contactInfo);
      return existingEmail && existingEmail === primaryEmail;
    });

    if (duplicateByEmail) {
      console.log(
        `Duplicate email detected after enrichment: ${primaryEmail} for lead ${args.leadId}, marking as duplicate`
      );

      // Track duplicate prevention for analytics
      await ctx.db.insert("duplicateMetrics", {
        userId: args.userId,
        searchId: args.searchId,
        placeId: lead.placeId,
        duplicateType: "email",
        originalLeadId: duplicateByEmail._id,
        businessName: lead.businessName,
        preventedAt: Date.now(),
      });

      if (search) {
        const currentEmailDuplicates = search.duplicatesFilteredEmail || 0;
        await ctx.db.patch(search._id, {
          duplicatesFilteredEmail: currentEmailDuplicates + 1,
          updatedAt: Date.now(),
        });
      }

      // Mark this lead with a flag to skip in UI/exports
      await ctx.db.patch(args.leadId, {
        tags: [...(lead.tags || []), "duplicate_email"],
        notes: lead.notes
          ? `${lead.notes}\n\nDuplicate email detected: ${primaryEmail}`
          : `Duplicate email detected: ${primaryEmail}`,
        updatedAt: Date.now(),
      });

      return { isDuplicate: true, duplicateEmail: primaryEmail };
    }

    return { isDuplicate: false };
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
    deduplication: v.optional(
      v.object({
        enablePlaceNameDedup: v.optional(v.boolean()),
        enableEmailDedup: v.optional(v.boolean()),
        enableAddressDedup: v.optional(v.boolean()),
      }),
    ),
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

      // Track duplicate prevention for analytics
      await ctx.db.insert("duplicateMetrics", {
        userId: args.userId,
        searchId: args.searchId,
        placeId: args.leadData.placeId,
        duplicateType: "search_level",
        originalLeadId: duplicateInSearch._id,
        businessName: args.leadData.businessName,
        preventedAt: Date.now(),
      });

      return {
        status: "skipped" as const,
        reason: "search_level" as const,
        duplicateLeadId: duplicateInSearch._id,
      };
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

      // Track duplicate prevention for analytics
      await ctx.db.insert("duplicateMetrics", {
        userId: args.userId,
        searchId: args.searchId,
        placeId: args.leadData.placeId,
        duplicateType: "user_level",
        originalLeadId: duplicateAcrossSearches._id,
        businessName: args.leadData.businessName,
        preventedAt: Date.now(),
      });

      return {
        status: "skipped" as const,
        reason: "user_level" as const,
        duplicateLeadId: duplicateAcrossSearches._id,
      };
    }

    // ============================================================================
    // NEW: Additional Deduplication Checks Based on User Preferences
    // ============================================================================

    // Get user preferences for deduplication settings
    const user = await ctx.db.get(args.userId);
    const enablePlaceNameDedup =
      args.deduplication?.enablePlaceNameDedup ??
      user?.preferences?.enablePlaceNameDedup ??
      false;
    const enableEmailDedup =
      args.deduplication?.enableEmailDedup ??
      user?.preferences?.enableEmailDedup ??
      true; // Default ON
    const enableAddressDedup =
      args.deduplication?.enableAddressDedup ??
      user?.preferences?.enableAddressDedup ??
      true; // Default ON

    // THIRD: Check for duplicate place name within THIS search (if enabled)
    if (enablePlaceNameDedup && args.leadData.businessName) {
      const normalizedName = normalizePlaceName(args.leadData.businessName);

      // Query all leads in this search and check for name match
      const allSearchLeads = await ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
        .collect();

      const duplicateByName = allSearchLeads.find(lead =>
        normalizePlaceName(lead.businessName) === normalizedName
      );

      if (duplicateByName) {
        console.log(
          `Duplicate place name detected: "${args.leadData.businessName}" in search ${args.searchId}, skipping`
        );

        // Track duplicate prevention for analytics
        await ctx.db.insert("duplicateMetrics", {
          userId: args.userId,
          searchId: args.searchId,
          placeId: args.leadData.placeId,
          duplicateType: "place_name",
          originalLeadId: duplicateByName._id,
          businessName: args.leadData.businessName,
          preventedAt: Date.now(),
        });

        return {
          status: "skipped" as const,
          reason: "place_name" as const,
          duplicateLeadId: duplicateByName._id,
        };
      }
    }

    // FOURTH: Check for duplicate email at USER level (if enabled)
    // Note: This check needs enrichment data which isn't available at lead creation time
    // We'll implement this as a post-enrichment filter instead
    // For now, we'll add a placeholder that can be used after enrichment

    // FIFTH: Check for duplicate address at USER level (if enabled)
    if (enableAddressDedup && args.leadData.address) {
      const normalizedAddress = normalizeAddress(args.leadData.address);

      if (normalizedAddress) {
        // Query all user leads and check for address match
        const allUserLeads = await ctx.db
          .query("leads")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .collect();

        const duplicateByAddress = allUserLeads.find(lead =>
          normalizeAddress(lead.address) === normalizedAddress
        );

        if (duplicateByAddress) {
          console.log(
            `Duplicate address detected: "${args.leadData.address}" for user ${args.userId}, skipping`
          );

          // Track duplicate prevention for analytics
          await ctx.db.insert("duplicateMetrics", {
            userId: args.userId,
            searchId: args.searchId,
            placeId: args.leadData.placeId,
            duplicateType: "address",
            originalLeadId: duplicateByAddress._id,
            businessName: args.leadData.businessName,
            preventedAt: Date.now(),
          });

          return {
            status: "skipped" as const,
            reason: "address" as const,
            duplicateLeadId: duplicateByAddress._id,
          };
        }
      }
    }

    // ============================================================================
    // End of Additional Deduplication Checks
    // ============================================================================

    // Atomic insert with race condition protection
    try {
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

      return { status: "created" as const, leadId };
    } catch (error: any) {
      // Handle potential race condition - if duplicate was created between check and insert
      console.warn(
        `Potential race condition during lead creation for placeId ${args.leadData.placeId}`,
        error
      );

      // Double-check for duplicate that might have been created concurrently
      const raceDuplicate = await ctx.db
        .query("leads")
        .withIndex("by_user_place", (q) =>
          q.eq("userId", args.userId).eq("placeId", args.leadData.placeId)
        )
        .first();

      if (raceDuplicate) {
        console.log(
          `Race condition detected: duplicate created concurrently for placeId ${args.leadData.placeId}`
        );

        // Track the race condition duplicate
        await ctx.db.insert("duplicateMetrics", {
          userId: args.userId,
          searchId: args.searchId,
          placeId: args.leadData.placeId,
          duplicateType: "user_level",
          originalLeadId: raceDuplicate._id,
          businessName: args.leadData.businessName,
          preventedAt: Date.now(),
        });

        return {
          status: "skipped" as const,
          reason: "user_level" as const,
          duplicateLeadId: raceDuplicate._id,
        };
      }

      // If not a duplicate issue, re-throw the error
      throw error;
    }
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

/**
 * Atomically check if analysis phase should be triggered and claim the right to do so
 *
 * This mutation prevents race conditions when multiple enrichment actions complete simultaneously.
 * It uses Compare-And-Set semantics to ensure only ONE action triggers analyzeLeads.
 *
 * Returns:
 * - true: This caller won the race and should trigger analysis
 * - false: Another action already triggered analysis, or conditions not met
 */
export const tryTriggerAnalysisPhase = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Get all leads for this search
    const allLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    if (allLeads.length === 0) {
      return false; // No leads to analyze
    }

    // Check if ALL enrichment is complete
    const allEnrichmentComplete = allLeads.every((lead) =>
      lead.enrichmentStatus === "completed" ||
      lead.enrichmentStatus === "completed_fallback" ||
      lead.enrichmentStatus === "failed"
    );

    if (!allEnrichmentComplete) {
      return false; // Still waiting for enrichment to complete
    }

    // Check if analysis was already triggered by checking for any scheduled/processing/completed leads
    const analysisAlreadyTriggered = allLeads.some((lead) =>
      lead.analysisStatus === "scheduled" ||
      lead.analysisStatus === "processing" ||
      lead.analysisStatus === "completed"
    );

    if (analysisAlreadyTriggered) {
      return false; // Analysis already triggered by another action
    }

    // WE WON THE RACE! Mark all enriched leads as ready for analysis
    // This atomically claims the right to trigger analysis
    const leadsToAnalyze = allLeads.filter(
      (lead) =>
        lead.enrichmentStatus === "completed" ||
        lead.enrichmentStatus === "completed_fallback"
    );

    // Set analysisStatus to "pending" for all leads that should be analyzed
    // This prevents other concurrent actions from also triggering analysis
    for (const lead of leadsToAnalyze) {
      await ctx.db.patch(lead._id, {
        analysisStatus: "pending",
        updatedAt: Date.now(),
      });
    }

    return true; // Caller should now trigger analyzeLeads
  },
});
