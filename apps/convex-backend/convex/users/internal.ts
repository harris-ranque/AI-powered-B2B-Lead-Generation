import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Internal query to get user without auth check
export const getUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});