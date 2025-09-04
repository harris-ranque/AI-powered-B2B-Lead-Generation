import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get user broadcasts/notifications
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

    const limit = args.limit || 20;
    const offset = args.offset || 0;
    const includeDelivered = args.includeDelivered ?? true;

    // Check if statusBroadcasts table exists
    try {
      let query = ctx.db
        .query("statusBroadcasts")
        .withIndex("by_user", (q) => q.eq("userId", user._id));

      // Filter by delivery status if specified
      if (!includeDelivered) {
        query = query.filter((q) => q.neq(q.field("status"), "delivered"));
      }

      const broadcasts = await query
        .order("desc")
        .take(limit + offset);

      return broadcasts.slice(offset);
    } catch (error) {
      // If table doesn't exist, return empty array
      return [];
    }
  },
});

// Get real-time status updates for searches
export const getSearchStatusUpdates = query({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify user owns the search
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== user._id) {
      throw new Error("Search not found or access denied");
    }

    // Get status broadcasts for this search
    try {
      const broadcasts = await ctx.db
        .query("statusBroadcasts")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .filter((q) => 
          q.and(
            q.eq(q.field("entityId"), args.searchId),
            q.eq(q.field("entityType"), "search")
          )
        )
        .order("desc")
        .take(50);

      return broadcasts;
    } catch (error) {
      // If table doesn't exist, return basic search status
      return [{
        _id: `status_${args.searchId}` as any,
        _creationTime: Date.now(),
        userId: user._id,
        entityType: "search" as const,
        entityId: args.searchId,
        message: `Search status: ${search.status}`,
        priority: "normal" as const,
        category: "search_update" as const,
        status: "active" as const,
        createdAt: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
        metadata: {
          searchStatus: search.status,
          progress: search.progress,
        }
      }];
    }
  },
});

// Get active notifications count
export const getActiveNotificationsCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    try {
      const activeCount = await ctx.db
        .query("statusBroadcasts")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .filter((q) => 
          q.and(
            q.eq(q.field("status"), "active"),
            q.gt(q.field("expiresAt"), Date.now())
          )
        )
        .collect()
        .then(broadcasts => broadcasts.length);

      return { count: activeCount };
    } catch (error) {
      // If table doesn't exist, return 0
      return { count: 0 };
    }
  },
});

// Get system-wide announcements
export const getSystemAnnouncements = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    try {
      // Get broadcasts that are system-wide (no specific user)
      const announcements = await ctx.db
        .query("statusBroadcasts")
        .filter((q) => 
          q.and(
            q.eq(q.field("entityType"), "system"),
            q.eq(q.field("status"), "active"),
            q.gt(q.field("expiresAt"), Date.now())
          )
        )
        .order("desc")
        .take(10);

      return announcements;
    } catch (error) {
      // If table doesn't exist, return empty array
      return [];
    }
  },
});