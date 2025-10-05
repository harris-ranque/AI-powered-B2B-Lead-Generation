import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";

export const getUserEmailGenerationRequests = internalQuery({
  args: {
    userId: v.id("users"),
    leadIds: v.optional(v.array(v.id("leads"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<Doc<"langgraphRequests">>> => {
    const baseQuery = ctx.db
      .query("langgraphRequests")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("type"), "email_generation"));

    const requests = await baseQuery.collect();

    if (!args.leadIds || args.leadIds.length === 0) {
      return requests;
    }

    const leadIdSet = new Set<Id<"leads">>(args.leadIds);
    return requests.filter(
      (request) => request.leadId !== undefined && leadIdSet.has(request.leadId),
    );
  },
});
