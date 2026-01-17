import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, getCurrentUser } from "../auth";

// Real-time broadcast queries using Convex's native subscriptions
// These replace the deprecated SSE implementation

// Get user's real-time status broadcasts
export const getUserBroadcasts = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    includeDelivered: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;
    const includeDelivered = args.includeDelivered ?? true;

    let query = ctx.db
      .query("statusBroadcasts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc");

    if (!includeDelivered) {
      query = query.filter((q) => q.eq(q.field("delivered"), false));
    }

    const broadcasts = await query
      .take(limit + offset);

    return broadcasts.slice(offset);
  },
});

// Get broadcasts for a specific search
export const getSearchBroadcasts = query({
  args: {
    searchId: v.id("searches"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 50;

    // Get broadcasts related to this search
    const broadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("data.searchId"), args.searchId))
      .order("desc")
      .take(limit);

    return broadcasts;
  },
});

// Get latest pipeline status for a search
export const getSearchPipelineStatus = query({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get the most recent pipeline update for this search
    const latestBroadcast = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("data.searchId"), args.searchId))
      .filter((q) => q.eq(q.field("type"), "pipeline_update"))
      .order("desc")
      .first();

    return latestBroadcast || null;
  },
});

// Get urgent/high priority broadcasts
export const getUrgentBroadcasts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 20;

    const urgentBroadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.or(
          q.eq(q.field("priority"), "urgent"),
          q.eq(q.field("priority"), "critical")
        )
      )
      .filter((q) => q.eq(q.field("delivered"), false))
      .order("desc")
      .take(limit);

    return urgentBroadcasts;
  },
});

// Get broadcasts by type
export const getBroadcastsByType = query({
  args: {
    type: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 30;

    const broadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(limit);

    return broadcasts;
  },
});

// Get count of unread broadcasts (using acknowledged field since read doesn't exist)
// Returns null if not authenticated (allows query during auth hydration)
export const getUnreadBroadcastCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const unacknowledgedBroadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_acknowledged", (q) => q.eq("acknowledged", false))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();

    const urgentUnacknowledged = unacknowledgedBroadcasts.filter(
      (b) => b.priority === "urgent" || b.priority === "critical"
    );

    return { 
      total: unacknowledgedBroadcasts.length, 
      urgent: urgentUnacknowledged.length 
    };
  },
});

// Get credit-related broadcasts
export const getCreditBroadcasts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 20;

    const creditBroadcasts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_type", (q) => q.eq("type", "credit_update"))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(limit);

    return creditBroadcasts;
  },
});

// Get rate limit warnings
export const getRateLimitWarnings = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 10;

    const warnings = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_type", (q) => q.eq("type", "rate_limit_warning"))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(limit);

    return warnings;
  },
});

// Get system alerts and announcements
export const getSystemAlerts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 10;

    const alerts = await ctx.db
      .query("statusBroadcasts")
      .withIndex("by_type", (q) => q.eq("type", "system_alert"))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .take(limit);

    return alerts;
  },
});