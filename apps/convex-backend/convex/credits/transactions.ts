import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// Record credit transaction
export const recordTransaction = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    operation: v.union(v.literal("usage"), v.literal("purchase"), v.literal("refund"), v.literal("bonus"), v.literal("rollback")),
    description: v.string(),
    relatedEntityType: v.optional(v.string()),
    relatedEntityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Get the user to verify they exist and get current balance
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Calculate new balance first
      let newBalance = user.credits || 0;
      if (args.operation === "purchase" || args.operation === "refund" || args.operation === "bonus") {
        newBalance += args.amount;
      } else if (args.operation === "usage") {
        newBalance -= args.amount;
      } else if (args.operation === "rollback") {
        newBalance += args.amount; // Rollback adds credits back
      }

      // Ensure balance doesn't go negative
      if (newBalance < 0) {
        console.warn(`Credit balance would go negative for user ${args.userId}: ${newBalance}`);
        newBalance = 0;
      }

      // Create the transaction record
      const transactionId = await ctx.db.insert("creditTransactions", {
        userId: args.userId,
        type: args.operation,
        amount: args.amount,
        description: args.description,
        balanceAfter: newBalance,
        relatedEntity: args.relatedEntityType && args.relatedEntityId ? {
          type: args.relatedEntityType,
          id: args.relatedEntityId,
        } : undefined,
        createdAt: Date.now(),
      });

      // Update user's credit balance
      await ctx.db.patch(args.userId, {
        credits: newBalance,
        updatedAt: Date.now(),
      });

      console.log(`Credit transaction recorded: ${args.operation} ${args.amount} for user ${args.userId} (balance: ${newBalance})`);
      return { 
        success: true, 
        transactionId,
        newBalance,
        operation: args.operation,
        amount: args.amount
      };
    } catch (error) {
      console.error(`Error recording credit transaction for user ${args.userId}:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  },
});

// Reserve credits for an operation (atomic transaction)
export const reserveCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    operation: v.string(),
    expireMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      const currentBalance = user.credits || 0;
      if (currentBalance < args.amount) {
        return {
          success: false,
          error: "Insufficient credits",
          required: args.amount,
          available: currentBalance,
        };
      }

      // Create reservation record
      const expireMinutes = args.expireMinutes || 30; // Default 30 minutes
      const expiresAt = Date.now() + (expireMinutes * 60 * 1000);

      const reservationId = await ctx.db.insert("creditReservations", {
        userId: args.userId,
        amount: args.amount,
        operationType: "credit_operation",
        operationId: args.operation,
        description: `Reserve for ${args.operation}`,
        status: "pending",
        createdAt: Date.now(),
        expiresAt,
      });

      console.log(`Credits reserved: ${args.amount} for user ${args.userId} (${args.operation})`);
      return {
        success: true,
        reservationId,
        amount: args.amount,
        expiresAt,
      };
    } catch (error) {
      console.error(`Error reserving credits for user ${args.userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Commit reserved credits (complete the transaction)
export const commitReservation = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    description: v.string(),
    relatedEntityType: v.optional(v.string()),
    relatedEntityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const reservation = await ctx.db.get(args.reservationId);
      if (!reservation) {
        throw new Error("Reservation not found");
      }

      if (reservation.status !== "pending") {
        throw new Error(`Reservation already ${reservation.status}`);
      }

      if (Date.now() > reservation.expiresAt) {
        // Mark as rolled back (closest to expired)
        await ctx.db.patch(args.reservationId, {
          status: "rolled_back",
        });
        throw new Error("Reservation has expired");
      }

      // Record the usage transaction
      const transactionResult: any = await ctx.runMutation(internal.credits.transactions.recordTransaction, {
        userId: reservation.userId,
        amount: reservation.amount,
        operation: "usage",
        description: args.description,
        relatedEntityType: args.relatedEntityType,
        relatedEntityId: args.relatedEntityId,
      });

      if (!transactionResult.success) {
        throw new Error(transactionResult.error || "Failed to record transaction");
      }

      // Mark reservation as committed
      await ctx.db.patch(args.reservationId, {
        status: "committed",
        completedAt: Date.now(),
      });

      console.log(`Reservation committed: ${reservation.amount} credits for user ${reservation.userId}`);
      return {
        success: true,
        transactionId: transactionResult.transactionId,
        newBalance: transactionResult.newBalance,
      };
    } catch (error) {
      console.error(`Error committing reservation ${args.reservationId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});