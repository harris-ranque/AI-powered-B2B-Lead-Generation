import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Create a new LangGraph request
export const createRequest = mutation({
  args: {
    leadId: v.optional(v.id("leads")),
    requestId: v.string(),
    type: v.union(
      v.literal("email_generation"),
      v.literal("lead_analysis"),
      v.literal("bulk_analysis"),
    ),
    inputData: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const requestId = await ctx.db.insert("langgraphRequests", {
      userId: user._id,
      leadId: args.leadId,
      requestId: args.requestId,
      type: args.type,
      status: "pending",
      inputData: args.inputData,
      creditsUsed: 0, // Will be updated when processing completes
      createdAt: Date.now(),
    });

    return {
      _id: requestId,
      requestId: args.requestId,
      inputData: args.inputData,
    };
  },
});

// Update request status
export const updateRequestStatus = mutation({
  args: {
    requestId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    outputData: v.optional(v.any()),
  },
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

    const updates: any = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.error) {
      updates.error = args.error;
    }

    if (args.outputData) {
      updates.outputData = args.outputData;
    }

    if (args.status === "completed") {
      updates.completedAt = Date.now();
    }

    if (args.status === "processing" && !request.startedAt) {
      updates.startedAt = Date.now();
    }

    await ctx.db.patch(request._id, updates);

    return { success: true };
  },
});
