import { query } from "../_generated/server";
import { v } from "convex/values";
import { auth, requireAuth, requireAdmin } from "../auth";

// Get current user profile
export const getCurrentUserData = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    return user || null;
  },
});

// Get user by ID (admin only)
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  },
});

// Get user stats for dashboard
export const getUserStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get search count
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get lead count
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get email sequences count
    const emailSequences = await ctx.db
      .query("emailSequences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get recent searches
    const recentSearches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(5);

    // Calculate completion rate
    const completedSearches = searches.filter((s) => s.status === "completed");
    const completionRate =
      searches.length > 0
        ? (completedSearches.length / searches.length) * 100
        : 0;

    // Calculate average relevance score
    const leadsWithAnalysis = leads.filter((l) => l.aiAnalysis?.relevanceScore);
    const avgRelevanceScore =
      leadsWithAnalysis.length > 0
        ? leadsWithAnalysis.reduce(
            (sum, lead) => sum + (lead.aiAnalysis?.relevanceScore || 0),
            0,
          ) / leadsWithAnalysis.length
        : 0;

    return {
      totalSearches: searches.length,
      totalLeads: leads.length,
      totalEmailSequences: emailSequences.length,
      completionRate: Math.round(completionRate),
      avgRelevanceScore: Math.round(avgRelevanceScore * 100),
      recentSearches: recentSearches.map((search) => ({
        _id: search._id,
        name: search.name,
        status: search.status,
        createdAt: search.createdAt,
        results: search.results,
      })),
      credits: user.credits,
      plan: user.plan,
    };
  },
});

// Get user activity timeline
export const getUserActivity = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const limit = args.limit || 20;
    const offset = args.offset || 0;

    // Get credit transactions
    const creditTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    // Get recent searches
    const searches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    // Get notifications
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    // Combine and sort all activities
    const activities = [
      ...creditTransactions.map((tx) => ({
        type: "credit_transaction" as const,
        id: tx._id,
        timestamp: tx.createdAt,
        data: tx,
      })),
      ...searches.map((search) => ({
        type: "search" as const,
        id: search._id,
        timestamp: search.createdAt,
        data: search,
      })),
      ...notifications.map((notif) => ({
        type: "notification" as const,
        id: notif._id,
        timestamp: notif.createdAt,
        data: notif,
      })),
    ];

    // Sort by timestamp and apply pagination
    const sortedActivities = activities
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(offset, offset + limit);

    return sortedActivities;
  },
});

// Check if user exists by email
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    return user;
  },
});

// Get user preferences
export const getUserPreferences = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    return (
      user.preferences || {
        emailNotifications: true,
        language: "en",
        timezone: "UTC",
        theme: "neon-pulse",
        enablePlaceNameDedup: false,
        enableEmailDedup: true,
        enableAddressDedup: true,
        maxSearchExpansionIterations: 5,
        searchExpansionMultiplier: 1.5,
      }
    );
  },
});

// Get user credits (for useUserCredits hook)
export const getUserCredits = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }
    return user.credits || 0;
  },
});

// List users (admin only)
export const listUsers = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    const users = await ctx.db
      .query("users")
      .order("desc")
      .take(limit + offset);

    return users.slice(offset);
  },
});
