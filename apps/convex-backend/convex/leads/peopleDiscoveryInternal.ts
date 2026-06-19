import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Native Google Maps leads for this search, capped at parameters.maxResults.
 */
export const getLeadsForPeopleDiscovery = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    const maxResults =
      typeof search?.parameters.maxResults === "number" &&
      search.parameters.maxResults > 0
        ? search.parameters.maxResults
        : undefined;

    const nativeLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const cappedNativeLeads =
      maxResults !== undefined
        ? nativeLeads.slice(0, maxResults)
        : nativeLeads;

    return cappedNativeLeads;
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
        rankScore: v.optional(v.number()),
        discoverySources: v.optional(v.array(v.string())),
        source: v.union(
          v.literal("perplexity"),
          v.literal("tavily"),
          v.literal("website_inference"),
          v.literal("findymail_employees"),
          v.literal("manual"),
        ),
        sourceUrl: v.optional(v.string()),
        linkedinUrl: v.optional(v.string()),
        rawDiscoveryData: v.optional(v.any()),
        employmentVerified: v.optional(v.boolean()),
        employmentConfidence: v.optional(v.number()),
        verificationEvidence: v.optional(v.array(v.any())),
        status: v.optional(
          v.union(
            v.literal("discovered"),
            v.literal("email_pending"),
            v.literal("email_found"),
            v.literal("email_not_found"),
            v.literal("rejected"),
          ),
        ),
        emailDiscoveryStatus: v.optional(
          v.union(
            v.literal("pending"),
            v.literal("in_progress"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("skipped"),
          ),
        ),
      }),
    ),
    rejectedPeople: v.optional(
      v.array(
        v.object({
          name: v.string(),
          title: v.string(),
          matchedRole: v.optional(v.string()),
          confidence: v.number(),
          rankScore: v.optional(v.number()),
          discoverySources: v.optional(v.array(v.string())),
          source: v.union(
            v.literal("perplexity"),
            v.literal("tavily"),
            v.literal("website_inference"),
            v.literal("findymail_employees"),
            v.literal("manual"),
          ),
          sourceUrl: v.optional(v.string()),
          linkedinUrl: v.optional(v.string()),
          rawDiscoveryData: v.optional(v.any()),
          employmentVerified: v.optional(v.boolean()),
          employmentConfidence: v.optional(v.number()),
          verificationEvidence: v.optional(v.array(v.any())),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const insertedIds: Id<"leadProspects">[] = [];
    let verifiedCount = 0;

    const allPeople = [
      ...args.people.map((person) => ({
        ...person,
        status: person.status ?? ("discovered" as const),
        emailDiscoveryStatus: person.emailDiscoveryStatus ?? ("pending" as const),
      })),
      ...(args.rejectedPeople ?? []).map((person) => ({
        ...person,
        status: "rejected" as const,
        emailDiscoveryStatus: "skipped" as const,
        employmentVerified: person.employmentVerified ?? false,
      })),
    ];

    for (const person of allPeople) {
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
        rankScore: person.rankScore,
        discoverySources: person.discoverySources,
        employmentVerified: person.employmentVerified,
        employmentConfidence: person.employmentConfidence,
        verificationEvidence: person.verificationEvidence,
        source: person.source,
        sourceUrl: person.sourceUrl,
        status: person.status,
        emailDiscoveryStatus: person.emailDiscoveryStatus,
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

      if (person.status === "discovered") {
        verifiedCount += 1;
      }
    }

    return {
      prospectCount: verifiedCount,
      totalPersisted: insertedIds.length,
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

export const appendPeopleDiscoveryLog = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    leadId: v.optional(v.id("leads")),
    batchId: v.optional(v.string()),
    event: v.union(
      v.literal("batch_started"),
      v.literal("lead_started"),
      v.literal("lead_completed"),
      v.literal("lead_failed"),
      v.literal("progress"),
      v.literal("batch_completed"),
    ),
    message: v.string(),
    businessName: v.optional(v.string()),
    domain: v.optional(v.string()),
    prospectCount: v.optional(v.number()),
    people: v.optional(
      v.array(
        v.object({
          name: v.string(),
          title: v.string(),
          matchedRole: v.optional(v.string()),
        }),
      ),
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("peopleDiscoveryLogs", {
      searchId: args.searchId,
      userId: args.userId,
      leadId: args.leadId,
      batchId: args.batchId,
      event: args.event,
      message: args.message,
      businessName: args.businessName,
      domain: args.domain,
      prospectCount: args.prospectCount,
      people: args.people,
      metadata: args.metadata,
      createdAt: Date.now(),
    });

    const leadHint = args.businessName ?? args.domain ?? args.leadId ?? "search";
    console.log(
      `[PeopleDiscovery] ${args.event} | ${leadHint}: ${args.message}`,
    );
  },
});
