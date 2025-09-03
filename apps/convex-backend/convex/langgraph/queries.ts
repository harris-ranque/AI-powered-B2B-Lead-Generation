import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Get user LangGraph requests with pagination
export const getUserRequests = query({
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

    const requests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit + offset);

    return requests.slice(offset);
  },
});

// Get LangGraph request by ID
export const getRequestById = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const request = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
    
    if (!request || request.userId !== user._id) {
      throw new Error("Request not found or access denied");
    }

    return request;
  },
});

// Get request statistics for user
export const getRequestStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const requests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const completedRequests = requests.filter(r => r.status === "completed");
    const failedRequests = requests.filter(r => r.status === "failed");
    const pendingRequests = requests.filter(r => 
      r.status === "pending" || r.status === "in_progress"
    );

    // Group by request type
    const byType = requests.reduce((acc, request) => {
      acc[request.type] = (acc[request.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalRequests: requests.length,
      completedRequests: completedRequests.length,
      failedRequests: failedRequests.length,
      pendingRequests: pendingRequests.length,
      successRate: requests.length > 0 ? 
        Math.round((completedRequests.length / requests.length) * 100) : 0,
      byType,
      recentRequests: requests
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10)
        .map(request => ({
          _id: request._id,
          requestId: request.requestId,
          type: request.type,
          status: request.status,
          createdAt: request.createdAt,
          completedAt: request.completedAt,
        })),
    };
  },
});

// Get active requests (pending or in progress)
export const getActiveRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    return await ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "in_progress")
        )
      )
      .order("desc")
      .take(10);
  },
});

// Get requests by lead ID
export const getRequestsByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify lead belongs to user
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.userId !== user._id) {
      throw new Error("Lead not found or access denied");
    }

    return await ctx.db
      .query("langgraphRequests")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .order("desc")
      .collect();
  },
});