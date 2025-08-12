import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { STATUS } from "../lib/constants";
import { internal } from "../_generated/api";

// Create a new CrewAI request
export const createRequest = internalMutation({
  args: {
    userId: v.id("users"),
    leadId: v.optional(v.id("leads")),
    requestId: v.string(),
    type: v.union(
      v.literal("email_generation"),
      v.literal("lead_analysis"),
      v.literal("bulk_analysis")
    ),
    inputData: v.any(),
    creditsUsed: v.number(),
  },
  handler: async (ctx, args) => {
    const insertData: any = {
      userId: args.userId,
      requestId: args.requestId,
      type: args.type,
      status: STATUS.CREWAI.PENDING,
      inputData: args.inputData,
      creditsUsed: args.creditsUsed,
      createdAt: Date.now(),
    };

    if (args.leadId !== undefined) {
      insertData.leadId = args.leadId;
    }

    const requestId = await ctx.db.insert("crewaiRequests", insertData);

    return requestId;
  },
});

// Update CrewAI request status
export const updateRequestStatus = internalMutation({
  args: {
    requestId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    outputData: v.optional(v.any()),
    error: v.optional(v.string()),
    processingTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("crewaiRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (!request) {
      throw new Error(`CrewAI request not found: ${args.requestId}`);
    }

    const updateData: any = {
      status: args.status,
    };

    if (args.status === "processing" && !request.startedAt) {
      updateData.startedAt = Date.now();
    }

    if (args.status === "completed" || args.status === "failed") {
      updateData.completedAt = Date.now();
    }

    if (args.outputData !== undefined) {
      updateData.outputData = args.outputData;
    }

    if (args.error) {
      updateData.error = args.error;
    }

    if (args.processingTime !== undefined) {
      updateData.processingTime = args.processingTime;
    }

    await ctx.db.patch(request._id, updateData);
  },
});

// Get pending analysis requests for processing
export const getPendingAnalysisRequests = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    
    return await ctx.db
      .query("crewaiRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.eq(q.field("type"), "lead_analysis"))
      .order("asc")
      .take(limit);
  },
});

// Get requests by user for status tracking
export const getUserRequests = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    )),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    
    let query = ctx.db
      .query("crewaiRequests")
      .withIndex("by_user", (q) => q.eq("userId", args.userId));

    if (args.status !== undefined) {
      const status = args.status; // TypeScript will narrow the type here
      query = ctx.db
        .query("crewaiRequests")
        .withIndex("by_status", (q) => q.eq("status", status))
        .filter((q) => q.eq(q.field("userId"), args.userId));
    }

    return await query
      .order("desc")
      .take(limit);
  },
});

// Get request by ID for processing
export const getRequestById = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crewaiRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
  },
});

// Process analysis queue (called by cron job)
export const processAnalysisQueue = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get pending analysis requests
    const pendingRequests = await ctx.runQuery(internal.crewai.internal.getPendingAnalysisRequests, {
      limit: 10,
    });

    if (pendingRequests.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;
    const crewaiUrl = process.env.CREWAI_URL;
    const apiKey = process.env.CREWAI_API_KEY;

    if (!crewaiUrl || !apiKey) {
      console.error("CrewAI configuration missing");
      return { processed: 0, error: "Configuration missing" };
    }

    for (const request of pendingRequests) {
      try {
        // Mark as processing
        await ctx.runMutation(internal.crewai.internal.updateRequestStatus, {
          requestId: request.requestId,
          status: "processing",
        });

        // Get lead data for analysis
        if (request.leadId) {
          const lead = await ctx.runQuery(internal.leads.internal.getLeadForProcessing, {
            leadId: request.leadId,
          });

          if (lead && request.inputData?.businessProfile) {
            // Prepare payload for CrewAI
            const payload = {
              request_id: request.requestId,
              lead: {
                id: lead._id,
                company_name: lead.businessName,
                industry: lead.category,
                location: lead.location.formattedAddress,
                description: `${lead.businessName} - ${lead.category || 'Business'}`,
                website: lead.website,
                rating: lead.rating,
                review_count: lead.reviewCount,
              },
              business_profile: request.inputData.businessProfile,
            };

            // Send to CrewAI (this would typically be done via a queue or webhook)
            // For now, we'll mark it as processing and let the webhook handle completion
            console.log(`Processing analysis request ${request.requestId} for lead ${lead._id}`);
            processed++;
          }
        }

      } catch (error) {
        console.error(`Error processing request ${request.requestId}:`, error);
        
        // Mark as failed
        await ctx.runMutation(internal.crewai.internal.updateRequestStatus, {
          requestId: request.requestId,
          status: "failed",
          error: error instanceof Error ? error.message : "Processing error",
        });
      }
    }

    return { processed };
  },
});

// Clean up old completed requests
export const cleanupOldRequests = internalMutation({
  args: { olderThanDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const daysAgo = args.olderThanDays || 30;
    const cutoffTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);

    // Get old completed requests
    const oldRequests = await ctx.db
      .query("crewaiRequests")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .filter((q) => q.lt(q.field("completedAt"), cutoffTime))
      .collect();

    let deleted = 0;
    for (const request of oldRequests) {
      await ctx.db.delete(request._id);
      deleted++;
    }

    // Also clean up failed requests older than 7 days
    const failedCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const oldFailedRequests = await ctx.db
      .query("crewaiRequests")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .filter((q) => q.lt(q.field("createdAt"), failedCutoff))
      .collect();

    for (const request of oldFailedRequests) {
      await ctx.db.delete(request._id);
      deleted++;
    }

    return { deleted };
  },
});

// Get CrewAI usage statistics
export const getUsageStatistics = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = args.days || 30;
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);

    let query;
    
    if (args.userId !== undefined) {
      const userId = args.userId; // TypeScript will narrow the type here
      query = ctx.db.query("crewaiRequests").withIndex("by_user", (q) => q.eq("userId", userId));
    } else {
      query = ctx.db.query("crewaiRequests").fullTableScan();
    }

    const requests = await query
      .filter((q) => q.gt(q.field("createdAt"), since))
      .collect();

    const stats = {
      totalRequests: requests.length,
      emailGeneration: requests.filter(r => r.type === "email_generation").length,
      leadAnalysis: requests.filter(r => r.type === "lead_analysis").length,
      bulkAnalysis: requests.filter(r => r.type === "bulk_analysis").length,
      completed: requests.filter(r => r.status === "completed").length,
      failed: requests.filter(r => r.status === "failed").length,
      pending: requests.filter(r => r.status === "pending").length,
      processing: requests.filter(r => r.status === "processing").length,
      totalCreditsUsed: requests.reduce((sum, r) => sum + r.creditsUsed, 0),
      avgProcessingTime: requests
        .filter(r => r.processingTime)
        .reduce((sum, r, _, arr) => sum + (r.processingTime || 0) / arr.length, 0),
    };

    return stats;
  },
});