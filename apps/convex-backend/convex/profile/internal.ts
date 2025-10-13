import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Internal query to get profile by ID
export const getProfileInternal = internalQuery({
  args: { profileId: v.id("businessProfiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.profileId);
  },
});

// Internal query to get profile by user ID
export const getProfileByUserIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});
