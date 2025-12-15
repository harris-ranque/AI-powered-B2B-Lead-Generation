import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Cache sender accounts from Instantly API
export const cacheAccounts = internalMutation({
  args: {
    userId: v.id("users"),
    accounts: v.array(
      v.object({
        id: v.string(),
        email: v.string(),
        displayName: v.optional(v.string()),
        status: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("instantlySettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        cachedAccounts: args.accounts,
        cachedAccountsAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("instantlySettings", {
        userId: args.userId,
        autoPushEnabled: false,
        cachedAccounts: args.accounts,
        cachedAccountsAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});

// Create campaign tracking record
export const createCampaignRecord = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    instantlyCampaignId: v.string(),
    instantlyCampaignName: v.string(),
    senderEmail: v.string(),
    leadsCount: v.number(),
    autoPushed: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("instantlyCampaigns", {
      userId: args.userId,
      searchId: args.searchId,
      instantlyCampaignId: args.instantlyCampaignId,
      instantlyCampaignName: args.instantlyCampaignName,
      senderEmail: args.senderEmail,
      leadsCount: args.leadsCount,
      pushedAt: Date.now(),
      autoPushed: args.autoPushed,
    });
  },
});
