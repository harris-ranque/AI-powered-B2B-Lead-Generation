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
          q.eq(q.field("enrichmentStatus"), "failed")
        )
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
      v.literal("failed")
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
      v.literal("failed")
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
        contactInfo.fallbackReason = args.enrichmentData.fallbackReason || "FindyMail unavailable";
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
        q.eq("domain", args.domain).eq("searchId", args.searchId)
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
    }),
  },
  handler: async (ctx, args) => {
    // Check if cache already exists
    const existing = await ctx.db
      .query("findymailDomainCache")
      .withIndex("by_domain_search", (q) => 
        q.eq("domain", args.domain).eq("searchId", args.searchId)
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
    aiAnalysis: v.any(),
    emailContent: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      aiAnalysis: args.aiAnalysis,
      updatedAt: Date.now(),
    };

    if (args.emailContent) {
      updateData.emailContent = args.emailContent;
    }

    await ctx.db.patch(args.leadId, updateData);
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
          q.eq(q.field("enrichmentStatus"), "completed_fallback")
        )
      )
      .collect();
  },
});