/**
 * Link prior-account businesses to a new search for role-targeted re-enrichment.
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const linkLeadForSearchReenrichment = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    leadId: v.id("leads"),
    originalSearchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== args.userId) {
      return { linked: false, reason: "search_not_found" };
    }

    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== args.userId) {
      return { linked: false, reason: "lead_not_found" };
    }

    const existing = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search_lead", (q) =>
        q.eq("searchId", args.searchId).eq("leadId", args.leadId),
      )
      .unique();

    if (existing) {
      if (existing.status === "pending") {
        return { linked: true, reason: "already_linked" };
      }
      await ctx.db.patch(existing._id, {
        status: "pending",
        enrichedAt: undefined,
      });
      return { linked: true, reason: "reopened" };
    }

    const maxLinks = search.parameters.maxResults;
    const pendingLinks = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "pending"),
      )
      .collect();

    if (pendingLinks.length >= maxLinks) {
      return { linked: false, reason: "cap_reached" };
    }

    await ctx.db.insert("searchLinkedLeads", {
      searchId: args.searchId,
      leadId: args.leadId,
      userId: args.userId,
      linkReason: "duplicate_reenrichment",
      status: "pending",
      originalSearchId: args.originalSearchId ?? lead.searchId,
      createdAt: Date.now(),
    });

    return { linked: true, reason: "created" };
  },
});

export const markSearchLinkedLeadEnriched = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search_lead", (q) =>
        q.eq("searchId", args.searchId).eq("leadId", args.leadId),
      )
      .unique();

    if (!link) {
      return;
    }

    await ctx.db.patch(link._id, {
      status: args.failed ? "failed" : "enriched",
      enrichedAt: Date.now(),
    });
  },
});

export const countSearchLinkedLeads = internalQuery({
  args: {
    searchId: v.id("searches"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("enriched"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      const links = await ctx.db
        .query("searchLinkedLeads")
        .withIndex("by_search_status", (q) =>
          q.eq("searchId", args.searchId).eq("status", args.status!),
        )
        .collect();
      return links.length;
    }

    const links = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();
    return links.length;
  },
});

export const getLinkedLeadIdsForSearch = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("searchLinkedLeads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();
    return links.map((link) => link.leadId);
  },
});
