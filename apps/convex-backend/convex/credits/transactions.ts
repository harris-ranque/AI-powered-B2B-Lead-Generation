import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { shouldBypassCredits } from "../lib/creditHelpers";
import {
  calculateNewBalance,
  isReservationExpired,
  canCommitReservation,
} from "../lib/creditLogic";

// Record credit transaction
export const recordTransaction = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    operation: v.union(
      v.literal("usage"),
      v.literal("purchase"),
      v.literal("refund"),
      v.literal("bonus"),
      v.literal("rollback"),
    ),
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

      // BYOK: Skip credit operations for enterprise users with own API keys
      if (args.operation === "usage") {
        const bypassCredits = await shouldBypassCredits(ctx, args.userId);
        if (bypassCredits) {
          console.log(
            `BYOK: Skipping credit deduction for enterprise user ${args.userId} - ${args.description}`
          );

          // Log the credit bypass for audit trail
          await ctx.runMutation(internal.lib.auditLog.logCreditBypass, {
            userId: args.userId,
            operation: args.description,
            creditsSkipped: args.amount,
            providers: [], // Will be populated with actual providers in future enhancement
            relatedEntityType: args.relatedEntityType,
            relatedEntityId: args.relatedEntityId,
          });

          return {
            success: true,
            bypassed: true,
            reason: "Enterprise BYOK - credits not charged",
            operation: args.operation,
            amount: args.amount,
            newBalance: user.credits || 0,
          };
        }
      }

      // Calculate new balance using extracted pure function
      const balanceResult = calculateNewBalance(
        user.credits || 0,
        args.operation,
        args.amount
      );
      const newBalance = balanceResult.newBalance;

      if (balanceResult.wasAdjusted) {
        console.warn(
          `Credit balance would go negative for user ${args.userId}: ${balanceResult.originalCalculation}`,
        );
      }

      // Create the transaction record
      const transactionId = await ctx.db.insert("creditTransactions", {
        userId: args.userId,
        type: args.operation,
        amount: args.amount,
        description: args.description,
        balanceAfter: newBalance,
        relatedEntity:
          args.relatedEntityType && args.relatedEntityId
            ? {
                type: args.relatedEntityType,
                id: args.relatedEntityId,
              }
            : undefined,
        createdAt: Date.now(),
      });

      // Update user's credit balance
      await ctx.db.patch(args.userId, {
        credits: newBalance,
        updatedAt: Date.now(),
      });

      console.log(
        `Credit transaction recorded: ${args.operation} ${args.amount} for user ${args.userId} (balance: ${newBalance})`,
      );
      return {
        success: true,
        transactionId,
        newBalance,
        operation: args.operation,
        amount: args.amount,
      };
    } catch (error) {
      console.error(
        `Error recording credit transaction for user ${args.userId}:`,
        error,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
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

      // BYOK: Skip credit reservation for enterprise users with own API keys
      const bypassCredits = await shouldBypassCredits(ctx, args.userId);
      if (bypassCredits) {
        console.log(
          `BYOK: Skipping credit reservation for enterprise user ${args.userId} - ${args.operation}`
        );
        return {
          success: true,
          bypassed: true,
          reservationId: "bypassed" as any, // Dummy ID for compatibility
          amount: 0,
          expiresAt: Date.now() + 30 * 60 * 1000,
        };
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
      const expiresAt = Date.now() + expireMinutes * 60 * 1000;

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

      console.log(
        `Credits reserved: ${args.amount} for user ${args.userId} (${args.operation})`,
      );
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
      // BYOK: Handle bypassed reservations (when reservationId is "bypassed")
      if (args.reservationId === "bypassed" as any) {
        console.log("BYOK: Skipping reservation commit for bypassed enterprise reservation");
        return {
          success: true,
          bypassed: true,
          message: "Enterprise BYOK - no credits committed",
          newBalance: 0,
        };
      }

      const reservation = await ctx.db.get(args.reservationId);
      if (!reservation) {
        throw new Error("Reservation not found");
      }

      // BYOK: Check if user should bypass (in case reservation was created before BYOK)
      const bypassCredits = await shouldBypassCredits(ctx, reservation.userId);
      if (bypassCredits) {
        console.log(
          `BYOK: Skipping credit commit for enterprise user ${reservation.userId}`
        );
        await ctx.db.patch(args.reservationId, {
          status: "committed",
          completedAt: Date.now(),
        });
        return {
          success: true,
          bypassed: true,
          newBalance: 0,
        };
      }

      // Check if reservation can be committed using extracted pure function
      const commitCheck = canCommitReservation({
        amount: reservation.amount,
        status: reservation.status as "pending" | "committed" | "rolled_back",
        expiresAt: reservation.expiresAt,
        createdAt: reservation.createdAt || Date.now(),
      });

      if (!commitCheck.canCommit) {
        if (isReservationExpired(reservation.expiresAt)) {
          // Mark as rolled back (closest to expired)
          await ctx.db.patch(args.reservationId, {
            status: "rolled_back",
          });
        }
        throw new Error(commitCheck.reason || "Cannot commit reservation");
      }

      // Record the usage transaction (direct handler call for same-file function)
      const transactionResult: {
        success: boolean;
        transactionId: any;
        newBalance: number;
        operation: "usage";
        amount: number;
        error?: string;
      } = {
        success: true,
        transactionId: null as any,
        newBalance: 0,
        operation: "usage" as const,
        amount: reservation.amount,
      };

      try {
        // Get the user to update credits directly since we're in the same module
        const user = await ctx.db.get(reservation.userId);
        if (!user) {
          throw new Error("User not found during commit");
        }

        // Calculate new balance using extracted pure function
        const balanceResult = calculateNewBalance(
          user.credits || 0,
          "usage",
          reservation.amount
        );
        const newBalance = balanceResult.newBalance;

        // Create the transaction record
        const transactionId = await ctx.db.insert("creditTransactions", {
          userId: reservation.userId,
          type: "usage",
          amount: reservation.amount,
          description: args.description,
          balanceAfter: newBalance,
          relatedEntity:
            args.relatedEntityType && args.relatedEntityId
              ? {
                  type: args.relatedEntityType,
                  id: args.relatedEntityId,
                }
              : undefined,
          createdAt: Date.now(),
        });

        // Update user's credit balance
        await ctx.db.patch(reservation.userId, {
          credits: newBalance,
          updatedAt: Date.now(),
        });

        transactionResult.transactionId = transactionId;
        transactionResult.newBalance = newBalance;

        console.log(
          `Credit transaction recorded during commit: usage ${reservation.amount} for user ${reservation.userId} (balance: ${newBalance})`,
        );
      } catch (error) {
        console.error(`Error recording transaction during commit:`, error);
        transactionResult.success = false;
        transactionResult.error =
          error instanceof Error ? error.message : "Unknown error";
      }

      if (!transactionResult.success) {
        throw new Error(
          transactionResult.error || "Failed to record transaction",
        );
      }

      // Mark reservation as committed
      await ctx.db.patch(args.reservationId, {
        status: "committed",
        completedAt: Date.now(),
      });

      console.log(
        `Reservation committed: ${reservation.amount} credits for user ${reservation.userId}`,
      );
      return {
        success: true,
        transactionId: transactionResult.transactionId,
        newBalance: transactionResult.newBalance,
      };
    } catch (error) {
      console.error(
        `Error committing reservation ${args.reservationId}:`,
        error,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Refund credits to a user
export const refundCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: v.string(),
    relatedEntityType: v.optional(v.string()),
    relatedEntityId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Validate inputs
      if (args.amount <= 0) {
        throw new Error("Refund amount must be positive");
      }

      // Call the recordTransaction mutation
      const result: {
        success: boolean;
        error?: string;
        transactionId?: string;
        newBalance?: number;
      } = await ctx.runMutation(
        internal.credits.transactions.recordTransaction,
        {
          userId: args.userId,
          amount: args.amount,
          operation: "refund",
          description: `Refund: ${args.reason}`,
          relatedEntityType: args.relatedEntityType,
          relatedEntityId: args.relatedEntityId,
        },
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to record refund transaction");
      }

      console.log(
        `Credits refunded: ${args.amount} to user ${args.userId} (${args.reason})`,
      );
      return {
        success: true,
        transactionId: result.transactionId,
        newBalance: result.newBalance,
        amountRefunded: args.amount,
      };
    } catch (error) {
      console.error(`Error refunding credits to user ${args.userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
