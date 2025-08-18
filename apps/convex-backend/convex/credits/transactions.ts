import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { CREDIT_COSTS } from "../lib/constants";

// Enhanced credit transaction system with atomic operations and rollback support

export interface CreditTransaction {
  userId: string;
  type: "purchase" | "usage" | "refund" | "bonus" | "rollback";
  amount: number;
  description: string;
  relatedEntity?: {
    type: string;
    id: string;
  };
  stripePaymentId?: string;
  parentTransactionId?: string; // For rollbacks
}

// Create a credit transaction with atomic balance update
export const createCreditTransaction = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.union(
      v.literal("purchase"),
      v.literal("usage"), 
      v.literal("refund"),
      v.literal("bonus"),
      v.literal("rollback")
    ),
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(v.object({
      type: v.string(),
      id: v.string(),
    })),
    stripePaymentId: v.optional(v.string()),
    parentTransactionId: v.optional(v.id("creditTransactions")),
    requireMinimumBalance: v.optional(v.boolean()), // For usage transactions
  },
  handler: async (ctx, args) => {
    // Get current user and lock for update
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Calculate new balance
    const currentBalance = user.credits;
    const newBalance = currentBalance + args.amount;

    // Validate transaction
    if (args.type === "usage") {
      if (args.amount > 0) {
        throw new Error("Usage transactions must have negative amounts");
      }
      
      if (args.requireMinimumBalance !== false && newBalance < 0) {
        throw new Error(`Insufficient credits. Required: ${Math.abs(args.amount)}, Available: ${currentBalance}`);
      }
    }

    if (args.type === "refund" && args.amount > 0) {
      throw new Error("Refund transactions must have negative amounts");
    }

    if ((args.type === "purchase" || args.type === "bonus") && args.amount < 0) {
      throw new Error("Purchase and bonus transactions must have positive amounts");
    }

    // Create transaction record first
    const transactionData: any = {
      userId: args.userId,
      type: args.type,
      amount: args.amount,
      description: args.description,
      parentTransactionId: args.parentTransactionId,
      balanceAfter: newBalance,
      createdAt: Date.now(),
    };

    // Add optional fields only if they exist
    if (args.relatedEntity) {
      transactionData.relatedEntity = args.relatedEntity;
    }
    if (args.stripePaymentId) {
      transactionData.stripePaymentId = args.stripePaymentId;
    }

    const transactionId = await ctx.db.insert("creditTransactions", transactionData);

    // Update user balance atomically
    await ctx.db.patch(args.userId, {
      credits: Math.max(0, newBalance), // Ensure never negative
      updatedAt: Date.now(),
    });

    // Log transaction for audit
    console.log(`Credit transaction created: ${args.type} ${args.amount} for user ${args.userId}, new balance: ${newBalance}`);

    return {
      transactionId,
      previousBalance: currentBalance,
      newBalance: Math.max(0, newBalance),
      success: true,
    };
  },
});

// Reserve credits for an operation (two-phase commit pattern)
export const reserveCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    operationType: v.string(),
    operationId: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.credits < args.amount) {
      throw new Error(`Insufficient credits. Required: ${args.amount}, Available: ${user.credits}`);
    }

    // Create a pending reservation
    const reservationId = await ctx.db.insert("creditReservations", {
      userId: args.userId,
      amount: args.amount,
      operationType: args.operationType,
      operationId: args.operationId,
      description: args.description,
      status: "pending",
      expiresAt: Date.now() + (30 * 60 * 1000), // 30 minutes
      createdAt: Date.now(),
    });

    // Reduce available credits
    await ctx.db.patch(args.userId, {
      credits: user.credits - args.amount,
      updatedAt: Date.now(),
    });

    console.log(`Reserved ${args.amount} credits for operation ${args.operationId}`);

    return {
      reservationId,
      previousBalance: user.credits,
      newBalance: user.credits - args.amount,
    };
  },
});

// Commit a credit reservation (convert to actual usage)
export const commitReservation: any = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    actualAmount: v.optional(v.number()), // May be different from reserved amount
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) {
      throw new Error("Reservation not found");
    }

    if (reservation.status !== "pending") {
      throw new Error(`Reservation already ${reservation.status}`);
    }

    const actualAmount = args.actualAmount || reservation.amount;
    
    // Create the actual usage transaction
    const transactionResult: any = await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
      userId: reservation.userId,
      type: "usage",
      amount: -actualAmount,
      description: reservation.description,
      relatedEntity: {
        type: reservation.operationType,
        id: reservation.operationId,
      },
      requireMinimumBalance: false, // Already reserved
    });

    // If actual amount is less than reserved, refund the difference
    if (actualAmount < reservation.amount) {
      const refundAmount = reservation.amount - actualAmount;
      await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
        userId: reservation.userId,
        type: "bonus",
        amount: refundAmount,
        description: `Refund from reservation: ${reservation.description}`,
        parentTransactionId: transactionResult.transactionId,
      });
    }

    // Mark reservation as committed
    await ctx.db.patch(args.reservationId, {
      status: "committed",
      actualAmount,
      completedAt: Date.now(),
    });

    console.log(`Committed reservation ${args.reservationId} for ${actualAmount} credits`);

    return {
      transactionId: transactionResult.transactionId,
      actualAmount,
      refunded: reservation.amount - actualAmount,
    };
  },
});

// Rollback a credit reservation (refund reserved credits)
export const rollbackReservation: any = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) {
      throw new Error("Reservation not found");
    }

    if (reservation.status !== "pending") {
      throw new Error(`Reservation already ${reservation.status}`);
    }

    // Refund the reserved credits
    const transactionResult = await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
      userId: reservation.userId,
      type: "bonus",
      amount: reservation.amount,
      description: `Rollback: ${args.reason} (${reservation.description})`,
      relatedEntity: {
        type: reservation.operationType,
        id: reservation.operationId,
      },
    });

    // Mark reservation as rolled back
    await ctx.db.patch(args.reservationId, {
      status: "rolled_back",
      completedAt: Date.now(),
    });

    console.log(`Rolled back reservation ${args.reservationId} for ${reservation.amount} credits: ${args.reason}`);

    return {
      transactionId: transactionResult.transactionId,
      refundedAmount: reservation.amount,
    };
  },
});

// Batch credit operations (for bulk operations)
export const batchCreditOperations: any = internalMutation({
  args: {
    operations: v.array(v.object({
      userId: v.id("users"),
      type: v.union(v.literal("usage"), v.literal("bonus")),
      amount: v.number(),
      description: v.string(),
      relatedEntity: v.optional(v.object({
        type: v.string(),
        id: v.string(),
      })),
    })),
  },
  handler: async (ctx, args) => {
    const results = [];
    const errors = [];

    // Process operations in sequence to maintain consistency
    for (let i = 0; i < args.operations.length; i++) {
      const operation = args.operations[i];
      
      if (!operation) {
        errors.push({ index: i, error: "Operation is undefined", operation: null });
        continue;
      }

      try {
        const result = await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
          userId: operation.userId,
          type: operation.type,
          amount: operation.amount,
          description: operation.description,
          relatedEntity: operation.relatedEntity,
          requireMinimumBalance: true,
        });
        
        results.push({ index: i, success: true, ...result });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({ index: i, error: errorMessage, operation });
        
        // For batch operations, we might want to continue or abort based on policy
        // For now, we'll continue and report all errors
        console.error(`Batch operation ${i} failed:`, errorMessage);
      }
    }

    return {
      successful: results.length,
      failed: errors.length,
      results,
      errors,
    };
  },
});

// Get user's current credit balance with pending reservations
export const getUserCreditSummary = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get pending reservations
    const pendingReservations = await ctx.db
      .query("creditReservations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const reservedAmount = pendingReservations.reduce((sum, r) => sum + r.amount, 0);

    // Get recent transactions for context
    const recentTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(5);

    return {
      currentBalance: user.credits,
      reservedAmount,
      availableBalance: user.credits, // Available = current (reservations already deducted)
      totalReservations: pendingReservations.length,
      recentTransactions,
      pendingReservations,
    };
  },
});

// Cleanup expired reservations
export const cleanupExpiredReservations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    const expiredReservations = await ctx.db
      .query("creditReservations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    let cleaned = 0;

    for (const reservation of expiredReservations) {
      try {
        await ctx.runMutation(internal.credits.transactions.rollbackReservation, {
          reservationId: reservation._id,
          reason: "Reservation expired",
        });
        cleaned++;
      } catch (error) {
        console.error(`Failed to cleanup expired reservation ${reservation._id}:`, error);
      }
    }

    console.log(`Cleaned up ${cleaned} expired credit reservations`);
    return { cleaned };
  },
});