import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Update/Create user Instantly settings
export const updateSettings = mutation({
  args: {
    autoPushEnabled: v.boolean(),
    defaultSenderEmail: v.optional(v.string()),
    defaultSenderAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const existing = await ctx.db
      .query("instantlySettings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        autoPushEnabled: args.autoPushEnabled,
        defaultSenderEmail: args.defaultSenderEmail,
        defaultSenderAccountId: args.defaultSenderAccountId,
        updatedAt: Date.now(),
      });
      return { success: true, action: "updated" as const };
    } else {
      await ctx.db.insert("instantlySettings", {
        userId: user._id,
        autoPushEnabled: args.autoPushEnabled,
        defaultSenderEmail: args.defaultSenderEmail,
        defaultSenderAccountId: args.defaultSenderAccountId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { success: true, action: "created" as const };
    }
  },
});
