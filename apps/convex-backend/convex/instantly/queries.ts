import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get user's Instantly settings
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    return await ctx.db
      .query("instantlySettings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
  },
});

// Check if search has been pushed to Instantly
export const isSearchPushed = query({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const campaign = await ctx.db
      .query("instantlyCampaigns")
      .withIndex("by_user_search", (q) =>
        q.eq("userId", user._id).eq("searchId", args.searchId)
      )
      .first();

    return {
      pushed: !!campaign,
      campaign,
    };
  },
});

// Get campaign history for user
export const getCampaignHistory = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);

    return await ctx.db
      .query("instantlyCampaigns")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(50);
  },
});

// Internal: Get campaign by search ID (for duplicate prevention)
export const getCampaignBySearch = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instantlyCampaigns")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .first();
  },
});

// Internal: Get user's Instantly settings (for auto-push check)
export const getSettingsInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instantlySettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// Internal: Get leads ready for push (with email addresses and completed analysis)
// Returns only the fields needed for the Instantly push to avoid hitting Convex read limits
export const getLeadsForPush = internalQuery({
  args: {
    searchId: v.id("searches"),
    paginationOpts: v.optional(
      v.object({
        cursor: v.union(v.string(), v.null()),
        numItems: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Use pagination to avoid hitting Convex's 8MB query read limit on large searches
    const pageSize = args.paginationOpts?.numItems ?? 20;
    const result = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .paginate({
        numItems: pageSize,
        cursor: args.paginationOpts?.cursor ?? null,
      });

    // Filter to leads with email addresses and completed analysis,
    // then project only the fields needed for the Instantly push payload
    const projectedLeads = result.page
      .filter(
        (lead) =>
          lead.contactInfo?.emails &&
          lead.contactInfo.emails.length > 0 &&
          lead.analysisStatus === "completed"
      )
      .map((lead) => ({
        _id: lead._id,
        businessName: lead.businessName,
        website: lead.website,
        phone: lead.phone,
        contactInfo: lead.contactInfo,
        emailContent: lead.emailContent,
        followUpEmails: lead.followUpEmails,
      }));

    return {
      leads: projectedLeads,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
