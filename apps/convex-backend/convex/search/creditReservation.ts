import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { CREDIT_COSTS } from "../lib/constants";
import { calculateSearchCost } from "../lib/helpers";

/**
 * Credit Reservation System for Search Operations
 * 
 * Implements two-phase commit pattern for credit management:
 * 1. Reserve credits before starting operation
 * 2. Commit actual usage when complete, or rollback on failure
 */

// Reserve credits for a search operation
export const reserveSearchCredits = internalMutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
    estimatedLeads: v.number(),
    includeEnrichment: v.boolean(),
    includeAI: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Calculate estimated credit cost
    const estimatedCost = calculateSearchCost(
      args.estimatedLeads,
      args.includeEnrichment,
      args.includeAI
    );

    console.log(`Reserving ${estimatedCost} credits for search ${args.searchId}`);

    try {
      // Reserve credits using two-phase commit
      const reservation = await ctx.runMutation(internal.credits.transactions.reserveCredits, {
        userId: args.userId,
        amount: estimatedCost,
        operationType: "search_pipeline",
        operationId: args.searchId,
        description: `Search operation: estimated ${args.estimatedLeads} leads`,
      });

      // Update search with reservation info
      await ctx.db.patch(args.searchId, {
        creditsReserved: estimatedCost,
        reservationId: reservation.reservationId,
      });

      return {
        reservationId: reservation.reservationId,
        reservedAmount: estimatedCost,
        userBalance: reservation.newBalance,
      };

    } catch (error) {
      console.error(`Failed to reserve credits for search ${args.searchId}:`, error);
      
      // Update search status to failed due to insufficient credits
      await ctx.db.patch(args.searchId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Credit reservation failed",
        completedAt: Date.now(),
      });

      throw error;
    }
  },
});

// Commit actual credit usage for search operation
export const commitSearchCredits = internalMutation({
  args: {
    searchId: v.id("searches"),
    actualCosts: v.object({
      discovery: v.number(),
      enrichment: v.number(),
      analysis: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search || !search.reservationId) {
      throw new Error("Search or reservation not found");
    }

    const actualTotal = args.actualCosts.discovery + args.actualCosts.enrichment + args.actualCosts.analysis;

    console.log(`Committing ${actualTotal} actual credits for search ${args.searchId}`);

    try {
      // Commit the reservation with actual usage
      const commitResult = await ctx.runMutation(internal.credits.transactions.commitReservation, {
        reservationId: search.reservationId,
        actualAmount: actualTotal,
      });

      // Update search with actual credit usage
      await ctx.db.patch(args.searchId, {
        creditsUsed: actualTotal,
        actualCosts: args.actualCosts,
        creditsRefunded: commitResult.refunded,
      });

      return {
        actualUsed: actualTotal,
        refunded: commitResult.refunded,
        transactionId: commitResult.transactionId,
      };

    } catch (error) {
      console.error(`Failed to commit credits for search ${args.searchId}:`, error);
      
      // If commit fails, try to rollback the reservation
      await ctx.runMutation(internal.search.creditReservation.rollbackSearchCredits, {
        searchId: args.searchId,
        reason: `Commit failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });

      throw error;
    }
  },
});

// Rollback credit reservation for failed search
export const rollbackSearchCredits = internalMutation({
  args: {
    searchId: v.id("searches"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search || !search.reservationId) {
      console.log(`No reservation to rollback for search ${args.searchId}`);
      return { rolledBack: false };
    }

    console.log(`Rolling back credit reservation for search ${args.searchId}: ${args.reason}`);

    try {
      // Rollback the reservation
      const rollbackResult = await ctx.runMutation(internal.credits.transactions.rollbackReservation, {
        reservationId: search.reservationId,
        reason: args.reason,
      });

      // Update search to remove reservation info
      const updateData: any = {
        creditsReserved: 0,
        creditsRefunded: rollbackResult.refundedAmount,
      };
      
      // Remove reservationId field by not including it in the update
      await ctx.db.patch(args.searchId, updateData);

      return {
        rolledBack: true,
        refundedAmount: rollbackResult.refundedAmount,
        transactionId: rollbackResult.transactionId,
      };

    } catch (error) {
      console.error(`Failed to rollback credits for search ${args.searchId}:`, error);
      throw error;
    }
  },
});

// Enhanced search pipeline with credit reservation
export const createSearchWithReservation = internalAction({
  args: {
    userId: v.id("users"),
    searchParams: v.object({
      name: v.string(),
      location: v.string(),
      radius: v.number(),
      keywords: v.array(v.string()),
      maxResults: v.number(),
    }),
    options: v.object({
      includeEnrichment: v.boolean(),
      includeAI: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    console.log(`Creating search with credit reservation for user ${args.userId}`);

    try {
      // 1. Create the search record
      const searchId = await ctx.runMutation(internal.search.mutations.createSearch, {
        name: args.searchParams.name,
        parameters: {
          location: args.searchParams.location,
          radius: args.searchParams.radius,
          keywords: args.searchParams.keywords,
          maxResults: args.searchParams.maxResults,
        },
      });

      // 2. Reserve credits upfront
      const reservation = await ctx.runMutation(internal.search.creditReservation.reserveSearchCredits, {
        userId: args.userId,
        searchId,
        estimatedLeads: args.searchParams.maxResults,
        includeEnrichment: args.options.includeEnrichment,
        includeAI: args.options.includeAI,
      });

      // 3. Start the search pipeline
      await ctx.scheduler.runAfter(0, internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId,
      });

      return {
        searchId,
        reservationId: reservation.reservationId,
        estimatedCost: reservation.reservedAmount,
        remainingBalance: reservation.userBalance,
      };

    } catch (error) {
      console.error(`Failed to create search with reservation:`, error);
      throw error;
    }
  },
});

// Batch credit operations for multiple search stages
export const batchCommitSearchStages = internalMutation({
  args: {
    operations: v.array(v.object({
      searchId: v.id("searches"),
      stage: v.union(v.literal("discovery"), v.literal("enrichment"), v.literal("analysis")),
      actualCost: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    console.log(`Batch committing ${args.operations.length} search stage operations`);

    const results = [];
    const errors = [];

    for (const operation of args.operations) {
      try {
        // Record stage-specific credit usage
        await ctx.runMutation(internal.search.internal.recordSearchCredits, {
          searchId: operation.searchId,
          creditsUsed: operation.actualCost,
        });

        results.push({
          searchId: operation.searchId,
          stage: operation.stage,
          success: true,
          creditsUsed: operation.actualCost,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({
          searchId: operation.searchId,
          stage: operation.stage,
          error: errorMessage,
        });

        console.error(`Failed to commit stage ${operation.stage} for search ${operation.searchId}:`, errorMessage);
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