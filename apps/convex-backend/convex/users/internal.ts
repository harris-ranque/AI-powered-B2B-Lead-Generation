import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Internal query to get user without auth check
export const getUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Internal mutation to deduct credits by userId (for scheduled/system actions)
export const deductCreditsInternal = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(v.object({
      type: v.string(),
      id: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found for credit deduction");
    }

    const currentBalance = user.credits || 0;
    if (currentBalance < args.amount) {
      throw new Error("Insufficient credits");
    }

    const newBalance = currentBalance - args.amount;

    await ctx.db.insert("creditTransactions", {
      userId: args.userId,
      type: "usage",
      amount: args.amount,
      description: args.description,
      balanceAfter: newBalance,
      relatedEntity: args.relatedEntity,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.userId, {
      credits: newBalance,
      updatedAt: Date.now(),
    });

    // Optional: low-balance notification could be added here if needed

    return { success: true, balance: newBalance };
  },
});
