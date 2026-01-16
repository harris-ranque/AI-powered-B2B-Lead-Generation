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
      v.literal("no_contacts_found"), // API succeeded but no discoverable contacts
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    // New timestamp fields for stuck detection monitoring
    enrichmentStartedAt: v.optional(v.number()),
    enrichmentCompletedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      enrichmentStatus: args.status,
      updatedAt: Date.now(),
    };

    // Track enrichment start time for stuck detection
    if (args.enrichmentStartedAt !== undefined) {
      updateData.enrichmentStartedAt = args.enrichmentStartedAt;
    }

    // Track enrichment completion time
    if (args.enrichmentCompletedAt !== undefined) {
      updateData.enrichmentCompletedAt = args.enrichmentCompletedAt;
    }

    // Auto-set completion time when transitioning to terminal states
    if (
      args.status === "completed" ||
      args.status === "completed_fallback" ||
      args.status === "no_contacts_found" ||
      args.status === "failed"
    ) {
      if (!args.enrichmentCompletedAt) {
        updateData.enrichmentCompletedAt = Date.now();
      }
    }

    // Clear contactInfo for failed enrichments to prevent false positives in UI
    // Note: no_contacts_found keeps the lead but without contact info
    if (args.status === "failed" || args.status === "completed_fallback" || args.status === "no_contacts_found") {
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

// Internal mutation to delete lead without contacts
export const deleteLead = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { success: false, reason: "Lead not found" };
    }

    // Update search progress metrics before deleting
    const search = await ctx.db.get(lead.searchId);
    if (search && search.progress) {
      // Decrement the discovered count since we're removing a lead
      const newDiscovered = Math.max(0, (search.progress.discovered || 0) - 1);

      await ctx.db.patch(search._id, {
        progress: {
          ...search.progress,
          discovered: newDiscovered,
          // Update total to match actual lead count
          total: newDiscovered,
        },
        updatedAt: Date.now(),
      });
    }

    // Delete the lead from database
    await ctx.db.delete(args.leadId);

    return { success: true, leadId: args.leadId };
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

    // Check for duplicate email across user's leads (excluding this one)
    // Uses paginated search to avoid 16MB limit for users with many leads
    // Only stores the duplicate lead ID to minimize memory usage
    const MAX_LEADS_TO_CHECK = 10000;
    const BATCH_SIZE = 1000;
    let leadsChecked = 0;
    let duplicateLeadId: typeof args.leadId | null = null;
    let emailCursor: string | null = null;
    let emailIsDone = false;

    while (!emailIsDone && leadsChecked < MAX_LEADS_TO_CHECK && !duplicateLeadId) {
      const result = await ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .paginate({ numItems: BATCH_SIZE, cursor: emailCursor as any ?? null });

      // Check this batch for email match - only extract necessary fields
      for (const existingLead of result.page) {
        // Skip comparing with itself
        if (existingLead._id === args.leadId) {
          continue;
        }
        // Check if this lead has the same email (only access contactInfo.emails)
        const existingEmail = extractPrimaryEmail(existingLead.contactInfo);
        if (existingEmail && existingEmail === primaryEmail) {
          duplicateLeadId = existingLead._id; // Only store the ID, not full lead
          break;
        }
      }

      leadsChecked += result.page.length;
      emailIsDone = result.isDone;
      emailCursor = result.continueCursor;
    }

    if (duplicateLeadId) {
      console.log(
        `Duplicate email detected after enrichment: ${primaryEmail} for lead ${args.leadId}, marking as duplicate`
      );

      // Track duplicate prevention for analytics
      await ctx.db.insert("duplicateMetrics", {
        userId: args.userId,
        searchId: args.searchId,
        placeId: lead.placeId,
        duplicateType: "email",
        originalLeadId: duplicateLeadId,
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
    enrichmentProvider: v.optional(v.literal("findymail")),
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

    // Use deduplication settings from caller (already resolved with fallback chain in search/actions.ts)
    // This ensures per-search overrides are properly respected
    const enablePlaceNameDedup = args.deduplication?.enablePlaceNameDedup ?? false;
    const enableEmailDedup = args.deduplication?.enableEmailDedup ?? true; // Default ON
    const enableAddressDedup = args.deduplication?.enableAddressDedup ?? true; // Default ON

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
    // Uses paginated search to avoid 16MB limit for users with many leads
    if (enableAddressDedup && args.leadData.address) {
      const normalizedAddress = normalizeAddress(args.leadData.address);

      if (normalizedAddress) {
        // Use paginated approach to avoid 16MB memory limit
        // Check up to 10,000 recent leads in batches of 1000
        // Only stores the duplicate lead ID to minimize memory usage
        const MAX_LEADS_TO_CHECK = 10000;
        const BATCH_SIZE = 1000;
        let leadsChecked = 0;
        let duplicateAddressLeadId: string | null = null;
        let cursor: string | null = null;
        let isDone = false;

        while (!isDone && leadsChecked < MAX_LEADS_TO_CHECK && !duplicateAddressLeadId) {
          const result = await ctx.db
            .query("leads")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .paginate({ numItems: BATCH_SIZE, cursor: cursor as any ?? null });

          // Check this batch for address match - only access address field
          for (const lead of result.page) {
            if (normalizeAddress(lead.address) === normalizedAddress) {
              duplicateAddressLeadId = lead._id; // Only store ID, not full lead
              break;
            }
          }

          leadsChecked += result.page.length;
          isDone = result.isDone;
          cursor = result.continueCursor;
        }

        // Log if we hit the limit without checking all leads
        if (!isDone && leadsChecked >= MAX_LEADS_TO_CHECK && !duplicateAddressLeadId) {
          console.log(
            `Address dedup check: Only checked ${leadsChecked} of user's leads due to volume limit`
          );
        }

        if (duplicateAddressLeadId) {
          console.log(
            `Duplicate address detected: "${args.leadData.address}" for user ${args.userId}, skipping`
          );

          // Track duplicate prevention for analytics
          await ctx.db.insert("duplicateMetrics", {
            userId: args.userId,
            searchId: args.searchId,
            placeId: args.leadData.placeId,
            duplicateType: "address",
            originalLeadId: duplicateAddressLeadId as any,
            businessName: args.leadData.businessName,
            preventedAt: Date.now(),
          });

          return {
            status: "skipped" as const,
            reason: "address" as const,
            duplicateLeadId: duplicateAddressLeadId as any,
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
      // Research tier tracking from LangGraph
      researchTier: v.optional(v.string()),
      // Structured company data from research extraction
      companyData: v.optional(v.any()),
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

// Internal query to get leads for a user with pagination (for exports)
// Uses pagination to avoid 16MB limit for users with many leads
export const getUserLeadsInternal = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()), // Default 1000, max 5000
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(args.limit || 1000, 5000);

    const result = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .paginate({ numItems: pageSize, cursor: args.cursor as any ?? null });

    return {
      leads: result.page,
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
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

// Update lead retry count for failed lead retry system
export const updateLeadRetryCount = internalMutation({
  args: {
    leadId: v.id("leads"),
    retryCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      analysisRetryCount: args.retryCount,
      lastRetryAttempt: Date.now(),
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
    // Note: "no_contacts_found" is also a terminal state (API succeeded but no contacts)
    const allEnrichmentComplete = allLeads.every((lead) =>
      lead.enrichmentStatus === "completed" ||
      lead.enrichmentStatus === "completed_fallback" ||
      lead.enrichmentStatus === "no_contacts_found" ||
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
    // Note: Only analyze leads WITH emails (completed/completed_fallback)
    // Leads with "no_contacts_found" are skipped since there's nothing to analyze
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

// Internal mutation to update enrichment provider
export const updateEnrichmentProvider = internalMutation({
  args: {
    leadId: v.id("leads"),
    provider: v.union(
      v.literal("findymail"),
      v.literal("csv_import")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      enrichmentProvider: args.provider,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get search enrichment status for DLQ processor
 * Returns summary of lead enrichment states and whether analysis can be triggered
 */
export const getSearchEnrichmentStatus = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return null;
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const totalLeads = leads.length;
    const statusCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      completed_fallback: 0,
      no_contacts_found: 0,
      failed: 0,
    };

    for (const lead of leads) {
      const status = lead.enrichmentStatus ?? "pending";
      if (status in statusCounts) {
        statusCounts[status as keyof typeof statusCounts]++;
      }
    }

    const enrichedCount =
      statusCounts.completed +
      statusCounts.completed_fallback +
      statusCounts.no_contacts_found +
      statusCounts.failed;

    const allLeadsEnriched = enrichedCount === totalLeads && totalLeads > 0;

    return {
      status: search.status,
      totalLeads,
      enrichedCount,
      statusCounts,
      allLeadsEnriched,
    };
  },
});
