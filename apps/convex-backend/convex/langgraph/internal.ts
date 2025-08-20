import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { STATUS, CREDIT_COSTS } from "../lib/constants";

// Create LangGraph request record
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
    const requestData: any = {
      userId: args.userId,
      requestId: args.requestId,
      type: args.type,
      status: "pending",
      inputData: args.inputData,
      creditsUsed: args.creditsUsed,
      createdAt: Date.now(),
    };

    // Add leadId only if it exists
    if (args.leadId) {
      requestData.leadId = args.leadId;
    }

    const requestId = await ctx.db.insert("langgraphRequests", requestData);

    return requestId;
  },
});

// Process analysis queue - scheduled function
export const processAnalysisQueue = internalMutation({
  args: {},
  handler: async (ctx) => {
    console.log("Processing LangGraph analysis queue");
    
    const pendingRequests = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.eq(q.field("type"), "lead_analysis"))
      .order("asc")
      .take(10); // Process 10 at a time

    for (const request of pendingRequests) {
      try {
        // Mark as processing
        await ctx.db.patch(request._id, {
          status: "processing",
          startedAt: Date.now(),
        });

        // Schedule the actual analysis action
        if (request.leadId) {
          await ctx.scheduler.runAfter(0, internal.langgraph.actions.analyzeLead, {
            leadId: request.leadId,
          });
        }

        console.log(`Queued analysis for request: ${request.requestId}`);

      } catch (error) {
        console.error(`Error processing analysis request ${request.requestId}:`, error);
        
        await ctx.db.patch(request._id, {
          status: "failed",
          error: error instanceof Error ? error.message : "Queue processing failed",
          completedAt: Date.now(),
        });
      }
    }

    if (pendingRequests.length > 0) {
      console.log(`Processed ${pendingRequests.length} LangGraph analysis requests`);
    }
  },
});

// Update request status
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
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("langgraphRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (!request) {
      throw new Error(`Request ${args.requestId} not found`);
    }

    const updateData: any = {
      status: args.status,
    };

    if (args.outputData !== undefined) {
      updateData.outputData = args.outputData;
    }

    if (args.error !== undefined) {
      updateData.error = args.error;
    }

    if (args.status === "completed" || args.status === "failed") {
      updateData.completedAt = Date.now();
    }

    await ctx.db.patch(request._id, updateData);

    return request._id;
  },
});