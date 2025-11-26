import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Create a new lead
export const createLead = mutation({
  args: {
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
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify search belongs to user
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // FIRST: Check for duplicate within THIS search (for spatial tiling deduplication)
    const duplicateInSearch = await ctx.db
      .query("leads")
      .withIndex("by_search_place", (q) =>
        q.eq("searchId", args.searchId).eq("placeId", args.leadData.placeId)
      )
      .first();

    if (duplicateInSearch) {
      // Track duplicate prevention for analytics
      await ctx.db.insert("duplicateMetrics", {
        userId: user._id,
        searchId: args.searchId,
        placeId: args.leadData.placeId,
        duplicateType: "search_level",
        originalLeadId: duplicateInSearch._id,
        businessName: args.leadData.businessName,
        preventedAt: Date.now(),
      });

      throw new Error(
        `This location is already in this search. Cannot create duplicate tile.`
      );
    }

    // SECOND: Check for duplicate at USER level (across all searches)
    const duplicateAcrossSearches = await ctx.db
      .query("leads")
      .withIndex("by_user_place", (q) =>
        q.eq("userId", user._id).eq("placeId", args.leadData.placeId)
      )
      .first();

    if (duplicateAcrossSearches) {
      // Track duplicate prevention for analytics
      await ctx.db.insert("duplicateMetrics", {
        userId: user._id,
        searchId: args.searchId,
        placeId: args.leadData.placeId,
        duplicateType: "user_level",
        originalLeadId: duplicateAcrossSearches._id,
        businessName: args.leadData.businessName,
        preventedAt: Date.now(),
      });

      throw new Error(
        `Lead with this location already exists in another search (${duplicateAcrossSearches.searchId}). Cannot create duplicate.`
      );
    }

    // Atomic insert with race condition protection
    try {
      const leadId = await ctx.db.insert("leads", {
        userId: user._id,
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
        enrichmentStatus: "pending", // Set to valid enum value
        status: "new", // Set to valid status enum
        tags: [], // Initialize empty tags array
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return leadId;
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
          q.eq("userId", user._id).eq("placeId", args.leadData.placeId)
        )
        .first();

      if (raceDuplicate) {
        // Track the race condition duplicate
        await ctx.db.insert("duplicateMetrics", {
          userId: user._id,
          searchId: args.searchId,
          placeId: args.leadData.placeId,
          duplicateType: "user_level",
          originalLeadId: raceDuplicate._id,
          businessName: args.leadData.businessName,
          preventedAt: Date.now(),
        });

        throw new Error(
          `Lead with this location already exists. Duplicate prevented by race condition protection.`
        );
      }

      // If not a duplicate issue, re-throw the error
      throw error;
    }
  },
});

// Update lead information
export const updateLead = mutation({
  args: {
    leadId: v.id("leads"),
    updates: v.object({
      status: v.optional(
        v.union(
          v.literal("new"),
          v.literal("qualified"),
          v.literal("contacted"),
          v.literal("nurturing"),
          v.literal("converted"),
          v.literal("unqualified"),
        ),
      ),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    await ctx.db.patch(args.leadId, {
      ...args.updates,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Update lead status specifically
export const updateLeadStatus = mutation({
  args: {
    leadId: v.id("leads"),
    status: v.union(
      v.literal("new"),
      v.literal("qualified"),
      v.literal("contacted"),
      v.literal("nurturing"),
      v.literal("converted"),
      v.literal("unqualified"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    await ctx.db.patch(args.leadId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Add notes to a lead
export const addLeadNotes = mutation({
  args: {
    leadId: v.id("leads"),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    const currentNotes = lead.notes || "";
    const timestamp = new Date().toISOString();
    const newNote = `[${timestamp}] ${args.notes}`;
    const updatedNotes = currentNotes
      ? `${currentNotes}\n\n${newNote}`
      : newNote;

    await ctx.db.patch(args.leadId, {
      notes: updatedNotes,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Delete a lead
export const deleteLead = mutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify user owns the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    await ctx.db.delete(args.leadId);

    return { success: true };
  },
});

/**
 * Track CSV Import
 *
 * Records CSV import metadata for analytics, debugging, and user history.
 * Called after CSV parsing completes (success or partial success).
 */
export const trackCSVImport = mutation({
  args: {
    searchId: v.id("searches"),
    fileName: v.string(),
    fileSize: v.number(),
    totalRows: v.number(),
    validRows: v.number(),
    invalidRows: v.number(),
    skippedRows: v.number(),
    estimatedCost: v.number(),
    leadsWithEmail: v.number(),
    leadsNeedingEnrichment: v.number(),
    errorReport: v.optional(
      v.array(
        v.object({
          rowNumber: v.number(),
          companyName: v.optional(v.string()),
          errors: v.array(v.string()),
          warnings: v.optional(v.array(v.string())),
          rawData: v.optional(v.any()),
        })
      )
    ),
    columnMapping: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify search belongs to user
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Create CSV import record
    const importId = await ctx.db.insert("csvImports", {
      userId: user._id,
      searchId: args.searchId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      totalRows: args.totalRows,
      validRows: args.validRows,
      invalidRows: args.invalidRows,
      skippedRows: args.skippedRows,
      estimatedCost: args.estimatedCost,
      actualCost: undefined, // Will be updated after processing
      leadsWithEmail: args.leadsWithEmail,
      leadsNeedingEnrichment: args.leadsNeedingEnrichment,
      status: args.invalidRows === 0 ? "completed" : "partial_success",
      errorReport: args.errorReport,
      columnMapping: args.columnMapping,
      createdAt: Date.now(),
      completedAt: Date.now(),
    });

    console.log(`CSV Import tracked: ${importId} (${args.validRows}/${args.totalRows} valid rows)`);

    return {
      success: true,
      importId,
      status: args.invalidRows === 0 ? "completed" : "partial_success",
    };
  },
});

/**
 * Create Search and Batch Insert CSV Leads
 *
 * Creates a search record and batch inserts all leads from CSV upload.
 * Handles credit deduction and sets up leads for enrichment/analysis pipeline.
 */
export const createSearchFromCSV = mutation({
  args: {
    fileName: v.string(),
    fileSize: v.number(),
    columnMapping: v.record(v.string(), v.string()),
    leads: v.array(
      v.object({
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
        category: v.optional(v.string()),
        dataSource: v.optional(
          v.union(
            v.literal("google_maps"),
            v.literal("csv_upload"),
            v.literal("manual")
          )
        ),
        enrichmentStatus: v.string(),
        contactInfo: v.optional(
          v.object({
            emails: v.array(
              v.object({
                email: v.string(),
                type: v.string(),
                confidence: v.number(),
              })
            ),
            contacts: v.array(
              v.object({
                name: v.string(),
                title: v.optional(v.string()),
                email: v.optional(v.string()),
                linkedin: v.optional(v.string()),
                confidence: v.number(),
              })
            ),
            socialProfiles: v.optional(
              v.object({
                linkedin: v.optional(v.string()),
                twitter: v.optional(v.string()),
                facebook: v.optional(v.string()),
              })
            ),
          })
        ),
        costEstimate: v.object({
          cost: v.number(),
          reason: v.string(),
          skipEnrichment: v.boolean(),
        }),
      })
    ),
    statistics: v.object({
      totalRows: v.number(),
      validRows: v.number(),
      invalidRows: v.number(),
      leadsWithEmail: v.number(),
      leadsNeedingEnrichment: v.number(),
      estimatedCost: v.number(),
      errorReport: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const now = Date.now();

    // Check and deduct credits FIRST (fail fast if insufficient)
    const creditCost = args.statistics.estimatedCost;
    const currentBalance = user.credits || 0;

    // Skip credit check for enterprise users (handled by deductCredits)
    if (currentBalance < creditCost && user.plan !== "enterprise") {
      throw new Error(
        `Insufficient credits. Need ${creditCost} credits, have ${currentBalance}.`
      );
    }

    // Create search record
    const searchId = await ctx.db.insert("searches", {
      userId: user._id,
      name: `CSV Import: ${args.fileName}`,
      status: "processing",
      parameters: {
        location: "CSV Upload",
        locationPlaceId: undefined,
        radius: 0,
        keywords: [],
        maxResults: args.leads.length,
      },
      progress: {
        discovered: args.leads.length,
        enriched: 0,
        analyzed: 0,
        total: args.leads.length,
      },
      results: {
        totalFound: args.leads.length,
        enrichedCount: 0,
        analyzedCount: 0,
      },
      creditsUsed: creditCost,
      createdAt: now,
      updatedAt: now,
    });

    // Deduct credits for the import
    await ctx.db.patch(user._id, {
      credits: (user.credits || 0) - creditCost,
    });

    // Log credit transaction
    await ctx.db.insert("creditTransactions", {
      userId: user._id,
      amount: -creditCost,
      type: "usage",
      description: `CSV Import: ${args.fileName} (${args.leads.length} leads)`,
      relatedEntity: {
        type: "search",
        id: searchId,
      },
      balanceAfter: currentBalance - creditCost,
      createdAt: now,
    });

    console.log(
      `Credits deducted: ${creditCost} for CSV import (user: ${user._id}, search: ${searchId})`
    );

    // Batch insert all leads
    const leadIds: string[] = [];
    for (const leadData of args.leads) {
      const leadId = await ctx.db.insert("leads", {
        searchId,
        userId: user._id,
        businessName: leadData.businessName,
        address: leadData.address,
        placeId: leadData.placeId,
        location: leadData.location,
        phone: leadData.phone,
        website: leadData.website,
        rating: undefined,
        reviewCount: undefined,
        category: leadData.category,
        dataSource: leadData.dataSource || "csv_upload",
        enrichmentStatus: leadData.enrichmentStatus as any,
        enrichmentProvider: leadData.costEstimate.skipEnrichment ? "csv_import" : undefined,
        contactInfo: leadData.contactInfo,
        aiAnalysis: undefined,
        status: "new",
        tags: [],
        notes: "",
        createdAt: now,
        updatedAt: now,
      });
      leadIds.push(leadId);
    }

    // Track CSV import
    const importId = await ctx.db.insert("csvImports", {
      userId: user._id,
      searchId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      totalRows: args.statistics.totalRows,
      validRows: args.statistics.validRows,
      invalidRows: args.statistics.invalidRows,
      skippedRows: 0,
      estimatedCost: args.statistics.estimatedCost,
      actualCost: args.statistics.estimatedCost,
      leadsWithEmail: args.statistics.leadsWithEmail,
      leadsNeedingEnrichment: args.statistics.leadsNeedingEnrichment,
      status: args.statistics.invalidRows === 0 ? "completed" : "partial_success",
      errorReport: args.statistics.errorReport,
      columnMapping: args.columnMapping,
      createdAt: now,
      completedAt: now,
    });

    console.log(
      `CSV Import complete: ${searchId} (${args.leads.length} leads, ${args.statistics.estimatedCost} credits)`
    );

    return {
      success: true,
      searchId,
      importId,
      leadIds,
      statistics: args.statistics,
    };
  },
});
