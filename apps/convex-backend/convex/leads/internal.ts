import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  normalizeAddress,
  normalizePlaceName,
  extractPrimaryEmail,
  leadRecordHasStoredEmail,
} from "../lib/deduplication";
import { resolveSearchExportData } from "../lib/exportEligibility";
import { getAnalysisCompletionState } from "../lib/analysisProgress";
import {
  isAllEnrichmentTerminal,
  isFailedSearchAnalysisTimeout,
} from "../lib/searchAnalysisRecovery";
import { isMultiContactPipelineEnabled } from "../lib/featureFlags";

// Internal query to get lead without auth check
export const getLeadInternal = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.leadId);
  },
});

/** Whether a business already has email on the lead row or accepted leadContacts. */
export const leadHasExistingContactEmail = internalQuery({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return false;
    }

    if (leadRecordHasStoredEmail(lead)) {
      return true;
    }

    const acceptedContact = await ctx.db
      .query("leadContacts")
      .withIndex("by_lead_status", (q) =>
        q.eq("leadId", args.leadId).eq("status", "accepted"),
      )
      .first();

    return acceptedContact !== null;
  },
});

// Internal query to get all leads for a search (includes linked prior-account leads)
export const getSearchLeadsInternal = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const nativeLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const links = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const seen = new Set(nativeLeads.map((lead) => String(lead._id)));
    const merged = [...nativeLeads];

    for (const link of links) {
      const key = String(link.leadId);
      if (seen.has(key)) {
        continue;
      }
      const lead = await ctx.db.get(link.leadId);
      if (lead) {
        seen.add(key);
        merged.push(lead);
      }
    }

    return merged;
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

/** Native unenriched leads plus linked prior-account leads queued for re-enrichment. */
export const getLeadsForEnrichment = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const nativeLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) =>
        q.or(
          q.eq(q.field("enrichmentStatus"), "pending"),
          q.eq(q.field("enrichmentStatus"), "failed"),
        ),
      )
      .collect();

    const pendingLinks = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "pending"),
      )
      .collect();

    const nativeIds = new Set(nativeLeads.map((lead) => String(lead._id)));
    const reenrichLeads: Array<
      typeof nativeLeads[number] & { reenrichForSearch?: boolean }
    > = [];

    for (const link of pendingLinks) {
      if (nativeIds.has(String(link.leadId))) {
        continue;
      }
      const lead = await ctx.db.get(link.leadId);
      if (lead) {
        reenrichLeads.push({ ...lead, reenrichForSearch: true });
      }
    }

    return [
      ...nativeLeads.map((lead) => ({ ...lead, reenrichForSearch: false })),
      ...reenrichLeads,
    ];
  },
});

// ============================================================================
// DEDUPLICATION QUERIES (Safe for pagination - called from actions)
// ============================================================================
// These queries can safely use pagination because queries (not mutations)
// support multiple .paginate() calls. The action iterates through pages.

/**
 * Check for duplicate address across user's leads using pagination.
 * Called from actions which iterate through pages until duplicate found or done.
 *
 * @returns { found: boolean, duplicateId: string | null, continueCursor: string | null, isDone: boolean }
 */
export const checkAddressDuplicatePage = internalQuery({
  args: {
    userId: v.id("users"),
    normalizedAddress: v.string(),
    cursor: v.optional(v.string()), // Kept for backwards compat, ignored
    batchSize: v.optional(v.number()), // Kept for backwards compat, ignored
  },
  handler: async (ctx, args) => {
    // O(1) direct index lookup - no pagination needed!
    const duplicate = await ctx.db
      .query("leads")
      .withIndex("by_user_normalized_address", (q) =>
        q
          .eq("userId", args.userId)
          .eq("normalizedAddress", args.normalizedAddress),
      )
      .first();

    if (duplicate) {
      return {
        found: true,
        duplicateId: duplicate._id,
        continueCursor: null,
        isDone: true,
      };
    }

    return {
      found: false,
      duplicateId: null,
      continueCursor: null,
      isDone: true, // Always done - O(1) lookup
    };
  },
});

/**
 * Check for duplicate email across user's leads using pagination.
 * Called from actions which iterate through pages until duplicate found or done.
 *
 * @returns { found: boolean, duplicateId: string | null, continueCursor: string | null, isDone: boolean }
 */
export const checkEmailDuplicatePage = internalQuery({
  args: {
    userId: v.id("users"),
    email: v.string(),
    excludeLeadId: v.optional(v.id("leads")),
    cursor: v.optional(v.string()), // Kept for backwards compat, ignored
    batchSize: v.optional(v.number()), // Kept for backwards compat, ignored
  },
  handler: async (ctx, args) => {
    const targetEmail = args.email.toLowerCase().trim();

    // O(1) direct index lookup - no pagination needed!
    // Query for leads with matching primaryEmail (denormalized field)
    const duplicates = await ctx.db
      .query("leads")
      .withIndex("by_user_primary_email", (q) =>
        q.eq("userId", args.userId).eq("primaryEmail", targetEmail),
      )
      .take(2); // Take 2 to handle excludeLeadId case

    // Find first match that isn't the excluded lead
    const duplicate = duplicates.find(
      (lead) => !args.excludeLeadId || lead._id !== args.excludeLeadId,
    );

    if (duplicate) {
      return {
        found: true,
        duplicateId: duplicate._id,
        continueCursor: null,
        isDone: true,
      };
    }

    return {
      found: false,
      duplicateId: null,
      continueCursor: null,
      isDone: true, // Always done - O(1) lookup
    };
  },
});

// ============================================================================
// END DEDUPLICATION QUERIES
// ============================================================================

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
    if (
      args.status === "failed" ||
      args.status === "completed_fallback" ||
      args.status === "no_contacts_found"
    ) {
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

/**
 * Mark a lead as having a duplicate email.
 * Called by actions after they've used checkEmailDuplicatePage query to find a duplicate.
 * This mutation just does the marking - no checking logic.
 */
export const markLeadAsEmailDuplicate = internalMutation({
  args: {
    leadId: v.id("leads"),
    userId: v.id("users"),
    searchId: v.id("searches"),
    duplicateEmail: v.string(),
    duplicateLeadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { success: false, reason: "lead_not_found" };
    }

    const search = await ctx.db.get(args.searchId);

    console.log(
      `Duplicate email detected after enrichment: ${args.duplicateEmail} for lead ${args.leadId}, marking as duplicate`,
    );

    // Track duplicate prevention for analytics
    await ctx.db.insert("duplicateMetrics", {
      userId: args.userId,
      searchId: args.searchId,
      placeId: lead.placeId,
      duplicateType: "email",
      originalLeadId: args.duplicateLeadId,
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
        ? `${lead.notes}\n\nDuplicate email detected: ${args.duplicateEmail}`
        : `Duplicate email detected: ${args.duplicateEmail}`,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get lead's email deduplication settings and primary email.
 * Called by actions before running the email dedup query loop.
 */
export const getLeadEmailDedupInfo = internalQuery({
  args: {
    leadId: v.id("leads"),
    userId: v.id("users"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !lead.contactInfo) {
      return { shouldCheck: false, reason: "no_contact_info" };
    }

    const user = await ctx.db.get(args.userId);
    const search = await ctx.db.get(args.searchId);
    const enableEmailDedup =
      search?.parameters?.deduplication?.enableEmailDedup ??
      user?.preferences?.enableEmailDedup ??
      true;

    if (!enableEmailDedup) {
      return { shouldCheck: false, reason: "disabled" };
    }

    const primaryEmail = extractPrimaryEmail(lead.contactInfo);
    if (!primaryEmail) {
      return { shouldCheck: false, reason: "no_email" };
    }

    return {
      shouldCheck: true,
      primaryEmail,
    };
  },
});

// DEPRECATED: Use the action-based approach instead (checkEmailDuplicatePage query + markLeadAsEmailDuplicate mutation)
// This mutation is kept for backwards compatibility but has a 5000 lead limit.
// For users with >5000 leads, use the query-based approach in actions.
export const checkEmailDuplication = internalMutation({
  args: {
    leadId: v.id("leads"),
    userId: v.id("users"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // DEPRECATED: This mutation has a 5000 lead limit.
    // For proper handling of large user datasets, use:
    // 1. getLeadEmailDedupInfo query to get settings
    // 2. checkEmailDuplicatePage query in a loop
    // 3. markLeadAsEmailDuplicate mutation if duplicate found
    console.warn(
      "DEPRECATED: checkEmailDuplication mutation called. Use action-based approach for >5000 leads.",
    );

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
    // Uses .take() with limit - DEPRECATED, has 5000 lead limit
    const MAX_LEADS_TO_CHECK = 5000;
    let duplicateLeadId: typeof args.leadId | null = null;

    const recentLeads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(MAX_LEADS_TO_CHECK);

    for (const existingLead of recentLeads) {
      if (existingLead._id === args.leadId) {
        continue;
      }
      const existingEmail = extractPrimaryEmail(existingLead.contactInfo);
      if (
        existingEmail &&
        existingEmail.toLowerCase() === primaryEmail.toLowerCase()
      ) {
        duplicateLeadId = existingLead._id;
        break;
      }
    }

    if (duplicateLeadId) {
      console.log(
        `Duplicate email detected after enrichment: ${primaryEmail} for lead ${args.leadId}, marking as duplicate`,
      );

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
          args.enrichmentData.fallbackReason ||
          `${args.enrichmentProvider || "Enrichment provider"} unavailable`;
      }

      updateData.contactInfo = contactInfo;

      // Extract and store primary email for efficient dedup lookups (O(1) vs O(n))
      const primaryEmail = extractPrimaryEmail(contactInfo);
      if (primaryEmail) {
        updateData.primaryEmail = primaryEmail.toLowerCase().trim();
      }

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
        skipCompaniesWithExistingEmails: v.optional(v.boolean()),
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
        q.eq("searchId", args.searchId).eq("placeId", args.leadData.placeId),
      )
      .first();

    if (duplicateInSearch) {
      console.log(
        `Duplicate tile detected for placeId ${args.leadData.placeId} in search ${args.searchId}, skipping to prevent duplicate tiles`,
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

    // ============================================================================
    // NEW: Additional Deduplication Checks Based on User Preferences
    // ============================================================================

    // Use deduplication settings from caller (already resolved with fallback chain in search/actions.ts)
    // This ensures per-search overrides are properly respected
    const enablePlaceNameDedup =
      args.deduplication?.enablePlaceNameDedup ?? false;
    const enableAddressDedup = args.deduplication?.enableAddressDedup ?? true; // Default ON

    // SECOND: Check for duplicate at USER level (across all searches)
    // Gated by enableAddressDedup — placeId and address represent the same
    // location-based concern: "have I already found this place in a prior search?"
    if (enableAddressDedup) {
      const duplicateAcrossSearches = await ctx.db
        .query("leads")
        .withIndex("by_user_place", (q) =>
          q.eq("userId", args.userId).eq("placeId", args.leadData.placeId),
        )
        .first();

      if (duplicateAcrossSearches) {
        console.log(
          `Duplicate lead detected for placeId ${args.leadData.placeId} for user ${args.userId} (existing in search ${duplicateAcrossSearches.searchId}), skipping to prevent re-processing`,
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
    }

    // THIRD: Check for duplicate place name within THIS search (if enabled)
    if (enablePlaceNameDedup && args.leadData.businessName) {
      const normalizedName = normalizePlaceName(args.leadData.businessName);

      // Query all leads in this search and check for name match
      const allSearchLeads = await ctx.db
        .query("leads")
        .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
        .collect();

      const duplicateByName = allSearchLeads.find(
        (lead) => normalizePlaceName(lead.businessName) === normalizedName,
      );

      if (duplicateByName) {
        console.log(
          `Duplicate place name detected: "${args.leadData.businessName}" in search ${args.searchId}, skipping`,
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
    // NOTE: Address deduplication is now handled in the ACTION layer (search/actions.ts)
    // using checkAddressDuplicatePage query which can safely paginate through all user leads.
    // The action calls the query in a loop before calling this mutation.
    // This mutation trusts that address dedup was already performed if enableAddressDedup is true.
    // See: tryProcessPlace() in search/actions.ts for the implementation.

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
        normalizedAddress: args.leadData.address
          ? normalizeAddress(args.leadData.address)
          : undefined, // Store normalized address for O(1) dedup lookups
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
        error,
      );

      // Double-check for duplicate that might have been created concurrently
      const raceDuplicate = await ctx.db
        .query("leads")
        .withIndex("by_user_place", (q) =>
          q.eq("userId", args.userId).eq("placeId", args.leadData.placeId),
        )
        .first();

      if (raceDuplicate && enableAddressDedup) {
        console.log(
          `Race condition detected: duplicate created concurrently for placeId ${args.leadData.placeId}`,
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

/**
 * Backfill denormalized fields for existing leads.
 * Run once after deploying schema changes to populate primaryEmail and normalizedAddress.
 * This enables O(1) dedup lookups for existing leads.
 *
 * Usage: Call from Convex dashboard or schedule as one-time job.
 */
export const backfillDenormalizedFields = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = args.batchSize || 100;
    let updated = 0;

    const result = await ctx.db
      .query("leads")
      .paginate({ numItems: pageSize, cursor: (args.cursor as any) ?? null });

    for (const lead of result.page) {
      const updates: {
        normalizedAddress?: string;
        primaryEmail?: string;
      } = {};

      // Backfill normalizedAddress if not set
      if (lead.address && !lead.normalizedAddress) {
        const normalized = normalizeAddress(lead.address);
        if (normalized) {
          updates.normalizedAddress = normalized;
        }
      }

      // Backfill primaryEmail if not set
      if (lead.contactInfo && !lead.primaryEmail) {
        const email = extractPrimaryEmail(lead.contactInfo);
        if (email) {
          updates.primaryEmail = email.toLowerCase().trim();
        }
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(lead._id, updates);
        updated++;
      }
    }

    return {
      updated,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
      message: result.isDone
        ? `Backfill complete. Updated ${updated} leads in this batch.`
        : `Batch complete. Updated ${updated} leads. Call again with cursor to continue.`,
    };
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
      .paginate({ numItems: pageSize, cursor: (args.cursor as any) ?? null });

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

    // Filter to only leads with valid email (contact name not required —
    // LangGraph worker handles missing names with fallbacks like "Unknown"/"there")
    return leads.filter((lead) => {
      const hasEmail =
        lead.contactInfo?.emails?.length && lead.contactInfo.emails.length > 0;
      return hasEmail;
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

    const attempts =
      typeof lead.analysisAttempts === "number" ? lead.analysisAttempts : 0;

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
      .withIndex("by_analysis_status", (q) =>
        q.eq("analysisStatus", "scheduled"),
      )
      .collect();

    const processingLeads = await ctx.db
      .query("leads")
      .withIndex("by_analysis_status", (q) =>
        q.eq("analysisStatus", "processing"),
      )
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
 * Evaluate whether analyzeLeads should be scheduled directly (recovery path).
 * Used when tryTriggerAnalysisPhase returns false but contacts are still pending.
 */
export const evaluateAnalysisRecoveryNeed = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return { shouldScheduleDirect: false, reason: "search_not_found" };
    }

    if (search.status === "cancelled") {
      return { shouldScheduleDirect: false, reason: "cancelled" };
    }

    const recoverableProcessing = search.status === "processing";
    const recoverableFailed =
      search.status === "failed" &&
      isFailedSearchAnalysisTimeout(search.error);

    if (!recoverableProcessing && !recoverableFailed) {
      return { shouldScheduleDirect: false, reason: "status_not_recoverable" };
    }

    if (search.enrichmentCheckpoint?.errorCode && search.enrichmentCheckpoint.resumable) {
      return { shouldScheduleDirect: false, reason: "checkpoint_paused" };
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const pendingLinked = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "pending"),
      )
      .take(1);

    if (!isAllEnrichmentTerminal(leads) || pendingLinked.length > 0) {
      return { shouldScheduleDirect: false, reason: "enrichment_incomplete" };
    }

    const completion = await getAnalysisCompletionState(ctx, args.searchId);

    if (completion.isComplete) {
      return { shouldScheduleDirect: false, reason: "analysis_complete" };
    }

    // Pending contacts/leads were never sent to LangGraph (no scheduled/processing).
    if (
      completion.pending > 0 &&
      completion.scheduled === 0 &&
      completion.processing === 0
    ) {
      return {
        shouldScheduleDirect: true,
        reason: "pending_never_scheduled",
        pending: completion.pending,
        total: completion.total,
      };
    }

    return {
      shouldScheduleDirect: false,
      reason: "analysis_in_flight_or_no_pending",
      pending: completion.pending,
      scheduled: completion.scheduled,
      processing: completion.processing,
    };
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
    const pendingLinked = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "pending"),
      )
      .take(1);

    if (pendingLinked.length > 0) {
      return false;
    }

    // Get all native leads for this search
    const allLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    if (allLeads.length === 0) {
      if (!isMultiContactPipelineEnabled()) {
        return false;
      }

      const acceptedSample = await ctx.db
        .query("leadContacts")
        .withIndex("by_search_status", (q) =>
          q.eq("searchId", args.searchId).eq("status", "accepted"),
        )
        .take(1);

      if (acceptedSample.length === 0) {
        return false;
      }

      const completion = await getAnalysisCompletionState(ctx, args.searchId);

      if (completion.inProgress > 0) {
        return false;
      }

      if (completion.isComplete) {
        return false;
      }

      const workRemaining = completion.pending + completion.failed;
      if (workRemaining === 0) {
        return false;
      }

      console.log(
        `[Analysis Trigger] Search ${args.searchId}: ${workRemaining} linked-business contacts pending Write Emails`,
      );
      return true;
    }

    const analysisStatusCounts = {
      unset: 0,
      pending: 0,
      scheduled: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      timeout: 0,
      other: 0,
    };

    for (const lead of allLeads) {
      const status = lead.analysisStatus ?? "unset";
      if (Object.prototype.hasOwnProperty.call(analysisStatusCounts, status)) {
        analysisStatusCounts[status as keyof typeof analysisStatusCounts] += 1;
      } else {
        analysisStatusCounts.other += 1;
      }
    }

    console.log(
      `[Analysis Trigger] Search ${args.searchId} analysis status counts`,
      analysisStatusCounts,
    );

    // Check if ALL enrichment is complete
    // Note: "no_contacts_found" is also a terminal state (API succeeded but no contacts)
    const allEnrichmentComplete = allLeads.every(
      (lead) =>
        lead.enrichmentStatus === "completed" ||
        lead.enrichmentStatus === "completed_fallback" ||
        lead.enrichmentStatus === "no_contacts_found" ||
        lead.enrichmentStatus === "failed",
    );

    if (!allEnrichmentComplete) {
      return false; // Still waiting for enrichment to complete
    }

    if (isMultiContactPipelineEnabled()) {
      const acceptedSample = await ctx.db
        .query("leadContacts")
        .withIndex("by_search_status", (q) =>
          q.eq("searchId", args.searchId).eq("status", "accepted"),
        )
        .take(1);

      if (acceptedSample.length > 0) {
        const completion = await getAnalysisCompletionState(ctx, args.searchId);

        if (completion.inProgress > 0) {
          return false;
        }

        if (completion.isComplete) {
          return false;
        }

        const workRemaining = completion.pending + completion.failed;
        if (workRemaining === 0) {
          return false;
        }

        console.log(
          `[Analysis Trigger] Search ${args.searchId}: ${workRemaining} contacts pending Write Emails (multi-contact)`,
        );
        return true;
      }
    }

    // Block only when analysis is actively in-flight (legacy lead pipeline)
    const analysisInFlight = allLeads.some(
      (lead) =>
        lead.analysisStatus === "scheduled" ||
        lead.analysisStatus === "processing",
    );

    if (analysisInFlight) {
      return false; // Analysis already in progress
    }

    // WE WON THE RACE! Mark leads that still need analysis as ready
    // Note: Only analyze leads WITH emails (completed/completed_fallback)
    // Leads with "no_contacts_found" are skipped since there's nothing to analyze
    const leadsToAnalyze = allLeads.filter((lead) => {
      const needsAnalysis =
        lead.analysisStatus === "pending" ||
        lead.analysisStatus === "failed" ||
        lead.analysisStatus === "timeout" ||
        lead.analysisStatus === undefined;

      return (
        (lead.enrichmentStatus === "completed" ||
          lead.enrichmentStatus === "completed_fallback") &&
        needsAnalysis
      );
    });

    // Set analysisStatus to "pending" for all leads that should be analyzed
    // This prevents other concurrent actions from also triggering analysis
    for (const lead of leadsToAnalyze) {
      await ctx.db.patch(lead._id, {
        analysisStatus: "pending",
        updatedAt: Date.now(),
      });
    }

    // Mark "no_contacts_found" and "failed" enrichment leads as "skipped" for analysis
    // This provides clear UI feedback about why analysis wasn't performed
    const leadsToSkip = allLeads.filter((lead) => {
      const wasNotAnalyzed =
        lead.analysisStatus === undefined || lead.analysisStatus === "pending";

      return (
        (lead.enrichmentStatus === "no_contacts_found" ||
          lead.enrichmentStatus === "failed") &&
        wasNotAnalyzed
      );
    });

    for (const lead of leadsToSkip) {
      const skipReason =
        lead.enrichmentStatus === "no_contacts_found"
          ? "No email contacts found for this business"
          : "Enrichment failed - unable to find contact information";

      await ctx.db.patch(lead._id, {
        analysisStatus: "skipped",
        analysisError: skipReason,
        updatedAt: Date.now(),
      });
    }

    console.log(
      `[Analysis Trigger] Search ${args.searchId}: ${leadsToAnalyze.length} leads pending analysis, ${leadsToSkip.length} leads skipped (no contacts)`,
    );

    return true; // Caller should now trigger analyzeLeads
  },
});

/**
 * Manual recovery: reset stuck analysis statuses for a specific search.
 * Marks scheduled/processing leads as failed so they can be retried safely.
 */
export const resetStuckAnalysisForSearch = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    if (leads.length === 0) {
      console.log(`[Recovery] No leads found for search ${args.searchId}`);
      return { resetCount: 0, totalLeads: 0 };
    }

    let resetCount = 0;

    for (const lead of leads) {
      if (
        lead.analysisStatus === "scheduled" ||
        lead.analysisStatus === "processing"
      ) {
        const attempts = (lead.analysisAttempts || 0) + 1;

        await ctx.db.patch(lead._id, {
          analysisStatus: "failed",
          analysisError: "manual_reset_stuck_analysis",
          analysisAttempts: attempts,
          analysisScheduledAt: undefined,
          analysisStartedAt: undefined,
          analysisRequestId: undefined,
          lastAnalysisAttempt: Date.now(),
          updatedAt: Date.now(),
        });

        resetCount++;
      }
    }

    console.log(
      `[Recovery] Reset ${resetCount}/${leads.length} stuck analysis leads for search ${args.searchId}`,
    );

    return { resetCount, totalLeads: leads.length };
  },
});

// Internal mutation to update enrichment provider
export const updateEnrichmentProvider = internalMutation({
  args: {
    leadId: v.id("leads"),
    provider: v.union(v.literal("findymail"), v.literal("csv_import")),
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

// ============================================================================
// ENRICHMENT QUEUE MANAGEMENT (OCC-Safe Lead-Based Queue)
// ============================================================================

/**
 * Queue a lead for enrichment using lead-based queue fields (OCC-safe)
 *
 * This replaces the old enrichmentSlotQueue table approach to avoid OCC failures.
 * Queue state is stored directly in the lead document, and the single-consumer
 * cron (enrichmentQueueProcessor) processes queued leads.
 *
 * @param leadId - The lead to queue
 * @param searchId - Associated search (for FIFO ordering by search)
 * @param apiKeyHash - API key hash for tenant isolation
 * @param searchQueuedAt - Search creation time (denormalized for FIFO ordering)
 */
export const queueLeadForEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    apiKeyHash: v.string(),
    searchQueuedAt: v.number(),
    reenrichForSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { queued: false, reason: "lead_not_found" };
    }

    const isReenrich = Boolean(args.reenrichForSearch);

    if (isReenrich) {
      const link = await ctx.db
        .query("searchLinkedLeads")
        .withIndex("by_search_lead", (q) =>
          q.eq("searchId", args.searchId).eq("leadId", args.leadId),
        )
        .unique();
      if (!link || link.status !== "pending") {
        return { queued: false, reason: "no_pending_reenrich_link" };
      }
    } else if (lead.enrichmentStatus !== "pending") {
      return {
        queued: false,
        reason: "not_pending",
        currentStatus: lead.enrichmentStatus,
      };
    }

    if (
      !isReenrich &&
      lead.enrichmentQueuedAt &&
      lead.enrichmentApiKeyHash
    ) {
      return { queued: false, reason: "already_queued" };
    }

    const now = Date.now();
    const patch: Record<string, unknown> = {
      enrichmentQueuedAt: now,
      enrichmentSearchQueuedAt: args.searchQueuedAt,
      enrichmentApiKeyHash: args.apiKeyHash,
      updatedAt: now,
    };

    if (isReenrich) {
      patch.enrichmentStatus = "pending";
      patch.enrichmentTargetSearchId = args.searchId;
      patch.enrichmentStartedAt = undefined;
    }

    await ctx.db.patch(args.leadId, patch);

    console.log(
      `[EnrichmentQueue] Queued lead ${args.leadId} for API key ${args.apiKeyHash.substring(0, 8)}...${isReenrich ? " (re-enrich)" : ""}`,
    );

    return { queued: true };
  },
});

/**
 * Re-queue a lead that was claimed for processing but couldn't acquire a slot.
 * This resets the lead back to "pending" and restores queue fields.
 */
export const requeueLeadForEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    apiKeyHash: v.string(),
    searchQueuedAt: v.number(),
    reenrichForSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { queued: false, reason: "lead_not_found" };
    }

    const isReenrich =
      Boolean(args.reenrichForSearch) || String(args.searchId) !== String(lead.searchId);

    const patch: Record<string, unknown> = {
      enrichmentStatus: "pending",
      enrichmentQueuedAt: Date.now(),
      enrichmentSearchQueuedAt: args.searchQueuedAt,
      enrichmentApiKeyHash: args.apiKeyHash,
      enrichmentStartedAt: undefined,
      updatedAt: Date.now(),
    };

    if (isReenrich) {
      patch.enrichmentTargetSearchId = args.searchId;
    } else {
      patch.enrichmentTargetSearchId = undefined;
    }

    await ctx.db.patch(args.leadId, patch);

    console.log(
      `[EnrichmentQueue] Re-queued lead ${args.leadId} for API key ${args.apiKeyHash.substring(0, 8)}...${isReenrich ? " (re-enrich)" : ""}`,
    );

    return { queued: true };
  },
});

/**
 * Cancel queued leads for a search (OCC-safe version)
 * Called when a search is cancelled to stop pending enrichments
 */
export const cancelQueuedLeadsForSearchV2 = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Find all queued leads for this search
    const queuedLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .filter((q) =>
        q.and(
          q.eq(q.field("enrichmentStatus"), "pending"),
          q.neq(q.field("enrichmentQueuedAt"), undefined),
        ),
      )
      .collect();

    // Clear queue fields (they will not be processed by the cron)
    for (const lead of queuedLeads) {
      await ctx.db.patch(lead._id, {
        enrichmentQueuedAt: undefined,
        enrichmentSearchQueuedAt: undefined,
        // Keep enrichmentApiKeyHash for reference
        updatedAt: Date.now(),
      });
    }

    console.log(
      `[EnrichmentQueue] Cancelled ${queuedLeads.length} queued leads for search ${args.searchId}`,
    );

    return { cancelled: queuedLeads.length };
  },
});

/**
 * Get queue stats for an API key (for monitoring)
 */
export const getEnrichmentQueueStats = internalQuery({
  args: {
    apiKeyHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("leads")
      .withIndex("by_enrichment_status", (q) =>
        q.eq("enrichmentStatus", "pending"),
      )
      .filter((q) => q.neq(q.field("enrichmentQueuedAt"), undefined));

    const queuedLeads = await query.collect();

    // Group by API key hash
    const byApiKey = new Map<string, number>();
    for (const lead of queuedLeads) {
      if (lead.enrichmentApiKeyHash) {
        const count = byApiKey.get(lead.enrichmentApiKeyHash) || 0;
        byApiKey.set(lead.enrichmentApiKeyHash, count + 1);
      }
    }

    if (args.apiKeyHash) {
      return {
        apiKeyHash: args.apiKeyHash.substring(0, 8),
        queuedCount: byApiKey.get(args.apiKeyHash) || 0,
        totalQueued: queuedLeads.length,
      };
    }

    return {
      totalQueued: queuedLeads.length,
      byApiKey: Array.from(byApiKey.entries()).map(([hash, count]) => ({
        apiKeyHash: hash.substring(0, 8),
        count,
      })),
    };
  },
});

export const resolveSearchExportInternal = internalQuery({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await resolveSearchExportData(ctx, args.searchId, args.userId);
  },
});
