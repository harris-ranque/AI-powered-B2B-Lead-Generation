import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// Update user credits (stub implementation)
export const updateUserCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    operation: v.union(v.literal("usage"), v.literal("purchase"), v.literal("refund"), v.literal("bonus"), v.literal("rollback")),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Use the credit transaction system for consistency
      const result: any = await ctx.runMutation(internal.credits.transactions.recordTransaction, {
        userId: args.userId,
        amount: args.amount,
        operation: args.operation,
        description: args.description,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to update credits");
      }

      console.log(`Credits updated for user ${args.userId}: ${args.operation} ${args.amount} (balance: ${result.newBalance})`);
      return { 
        success: true, 
        newBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      console.error(`Error updating credits for user ${args.userId}:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  },
});