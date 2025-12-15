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
export const getLeadsForPush = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // Filter to leads with email addresses and completed analysis
    return leads.filter(
      (lead) =>
        lead.contactInfo?.emails &&
        lead.contactInfo.emails.length > 0 &&
        lead.analysisStatus === "completed"
    );
  },
});
