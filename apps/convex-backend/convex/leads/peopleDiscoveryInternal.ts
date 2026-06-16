import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { normalizeCompanyResearchPayload } from "../lib/companyResearchCache";

export const getLeadsForPeopleDiscovery = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    return leads.filter(
      (lead) =>
        lead.sourceType === "new" || lead.sourceType === undefined,
    );
  },
});

export const getProspectsForLead = internalQuery({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const prospects = await ctx.db
      .query("leadProspects")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .collect();
    return prospects.filter((p) => p.searchId === args.searchId);
  },
});

export const getProspectsNeedingEmail = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const prospects = await ctx.db
      .query("leadProspects")
      .withIndex("by_search_email_status", (q) =>
        q.eq("searchId", args.searchId).eq("emailDiscoveryStatus", "pending"),
      )
      .collect();

    return prospects.filter(
      (p) =>
        p.status === "discovered" ||
        p.status === "email_pending",
    );
  },
});

export const countProspectsBySearch = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const prospects = await ctx.db
      .query("leadProspects")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const byStatus: Record<string, number> = {};
    for (const prospect of prospects) {
      byStatus[prospect.status] = (byStatus[prospect.status] ?? 0) + 1;
    }

    return {
      total: prospects.length,
      byStatus,
    };
  },
});

export const persistLeadProspects = internalMutation({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    people: v.array(
      v.object({
        name: v.string(),
        title: v.string(),
        matchedRole: v.optional(v.string()),
        confidence: v.number(),
        source: v.union(
          v.literal("perplexity"),
          v.literal("tavily"),
          v.literal("website_inference"),
          v.literal("manual"),
        ),
        sourceUrl: v.optional(v.string()),
        linkedinUrl: v.optional(v.string()),
        rawDiscoveryData: v.optional(v.any()),
      }),
    ),
    companyOverview: v.optional(v.string()),
    companyResearchPayload: v.optional(v.any()),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let companyResearchId: Id<"companyResearch"> | undefined;

    if (args.companyResearchPayload && args.domain) {
      const existing = await ctx.db
        .query("companyResearch")
        .withIndex("by_search_domain", (q) =>
          q.eq("searchId", args.searchId).eq("domain", args.domain),
        )
        .first();

      const normalized = normalizeCompanyResearchPayload(
        args.companyResearchPayload,
      );
      const researchData = {
        searchId: args.searchId,
        userId: args.userId,
        leadId: args.leadId,
        domain: args.domain,
        researchPayload: normalized,
        confidence:
          typeof normalized.confidence_score === "number"
            ? normalized.confidence_score
            : 0.7,
        provider: "people_discovery",
        status: "completed" as const,
        updatedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      };

      if (existing) {
        await ctx.db.patch(existing._id, researchData);
        companyResearchId = existing._id;
      } else {
        companyResearchId = await ctx.db.insert("companyResearch", {
          ...researchData,
          createdAt: now,
        });
      }
    }

    const insertedIds: Id<"leadProspects">[] = [];

    for (const person of args.people) {
      const existing = await ctx.db
        .query("leadProspects")
        .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
        .collect();

      const duplicate = existing.find(
        (p) =>
          p.searchId === args.searchId &&
          p.name.toLowerCase().trim() === person.name.toLowerCase().trim(),
      );

      const prospectData = {
        leadId: args.leadId,
        searchId: args.searchId,
        userId: args.userId,
        name: person.name.trim(),
        title: person.title.trim(),
        linkedinUrl: person.linkedinUrl,
        matchedRole: person.matchedRole,
        confidence: person.confidence,
        source: person.source,
        sourceUrl: person.sourceUrl,
        status: "discovered" as const,
        emailDiscoveryStatus: "pending" as const,
        companyResearchId,
        rawDiscoveryData: person.rawDiscoveryData,
        updatedAt: now,
      };

      if (duplicate) {
        await ctx.db.patch(duplicate._id, prospectData);
        insertedIds.push(duplicate._id);
      } else {
        const id = await ctx.db.insert("leadProspects", {
          ...prospectData,
          createdAt: now,
        });
        insertedIds.push(id);
      }
    }

    return {
      prospectCount: insertedIds.length,
      companyResearchId,
    };
  },
});

export const updateProspectEmailDiscoveryStatus = internalMutation({
  args: {
    prospectId: v.id("leadProspects"),
    emailDiscoveryStatus: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    status: v.optional(
      v.union(
        v.literal("discovered"),
        v.literal("email_pending"),
        v.literal("email_found"),
        v.literal("email_not_found"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const updates: Partial<Doc<"leadProspects">> = {
      emailDiscoveryStatus: args.emailDiscoveryStatus,
      updatedAt: Date.now(),
    };
    if (args.status) {
      updates.status = args.status;
    }
    await ctx.db.patch(args.prospectId, updates);
  },
});

export const markLeadPeopleDiscoveryComplete = internalMutation({
  args: {
    leadId: v.id("leads"),
    prospectCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.leadId, {
      updatedAt: Date.now(),
    });
    return { prospectCount: args.prospectCount };
  },
});
