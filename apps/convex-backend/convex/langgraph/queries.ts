import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";

// Get user's CrewAI requests
export const getUserRequests = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    let requestsQuery = ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id));

    if (args.status) {
      requestsQuery = requestsQuery.filter((q) => q.eq(q.field("status"), args.status));
    }

    const requests = await requestsQuery
      .order("desc")
      .paginate({ numItems: limit, cursor: null });

    return requests;
  },
});

// Get a specific CrewAI request
export const getRequest = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const request = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (!request) {
      throw createError("Request not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    if (request.userId !== user._id) {
      throw createError("Access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    return request;
  },
});

// Get email generation statistics
export const getEmailGenerationStats = query({
  args: {
    timeframe: v.optional(v.union(
      v.literal("day"),
      v.literal("week"),
      v.literal("month"),
      v.literal("year")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const timeframe = args.timeframe || "month";
    const now = Date.now();
    
    // Calculate time range
    let startDate: number;
    switch (timeframe) {
      case "day":
        startDate = now - 24 * 60 * 60 * 1000;
        break;
      case "week":
        startDate = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "month":
        startDate = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "year":
        startDate = now - 365 * 24 * 60 * 60 * 1000;
        break;
    }

    // Get email generation requests in the timeframe
    const emailRequests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => 
        q.and(
          q.eq(q.field("type"), "email_generation"),
          q.gte(q.field("_creationTime"), startDate)
        )
      )
      .collect();

    const totalRequests = emailRequests.length;
    const completedRequests = emailRequests.filter(req => req.status === "completed").length;
    const failedRequests = emailRequests.filter(req => req.status === "failed").length;
    const pendingRequests = emailRequests.filter(req => req.status === "pending" || req.status === "processing").length;

    const successRate = totalRequests > 0 ? (completedRequests / totalRequests) * 100 : 0;

    return {
      timeframe,
      totalRequests,
      completedRequests,
      failedRequests,
      pendingRequests,
      successRate,
    };
  },
});

// Get recent CrewAI requests for dashboard
export const getRecentRequests = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const limit = args.limit || 10;

    const requests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return requests;
  },
});