import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { STATUS } from "../lib/constants";
import { broadcastSearchUpdate } from "../realtime/integration";
import { translateSearchStatus } from "./statusTranslation";

/**
 * Enhanced Error Recovery System
 * 
 * Provides intelligent error recovery with user-actionable guidance,
 * automatic retry strategies, and graceful fallback mechanisms.
 */

export interface RecoveryAction {
  type: 'retry' | 'modify_search' | 'contact_support' | 'upgrade_plan' | 'wait';
  title: string;
  description: string;
  estimatedTime?: number;
  creditCost?: number;
  automatic?: boolean;
}

// Main error recovery coordinator
export const handleSearchError = internalMutation({
  args: {
    searchId: v.id("searches"),
    errorType: v.string(),
    errorMessage: v.string(),
    attemptCount: v.optional(v.number()),
    context: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const attemptCount = args.attemptCount || 1;
    const recovery = determineRecoveryStrategy(args.errorType, args.errorMessage, attemptCount, search);

    // Log error with recovery plan
    console.log(`Error recovery for search ${args.searchId}: ${args.errorType} -> ${recovery.strategy}`);

    // Update search with recovery information
    await ctx.db.patch(args.searchId, {
      error: args.errorMessage,
      errorRecovery: {
        errorType: args.errorType,
        attemptCount,
        strategy: recovery.strategy,
        nextRetryAt: recovery.nextRetryAt,
        userActionRequired: recovery.userActionRequired,
        recoveryActions: recovery.actions,
      },
      updatedAt: Date.now(),
    });

    // Send user-friendly error notification with recovery options
    await broadcastErrorWithRecovery(ctx, args.searchId, recovery);

    // Execute automatic recovery if applicable
    if (recovery.shouldAutoRecover) {
      await scheduleAutoRecovery(ctx, args.searchId, recovery);
    }

    return {
      strategy: recovery.strategy,
      userActionRequired: recovery.userActionRequired,
      nextRetryAt: recovery.nextRetryAt,
      actions: recovery.actions,
    };
  },
});

// Determine optimal recovery strategy based on error type and context
function determineRecoveryStrategy(
  errorType: string, 
  errorMessage: string, 
  attemptCount: number, 
  search: any
) {
  const strategies = {
    // API and network errors
    API_TIMEOUT: {
      strategy: attemptCount < 3 ? 'auto_retry' : 'user_retry',
      shouldAutoRecover: attemptCount < 3,
      nextRetryAt: Date.now() + (Math.min(Math.pow(2, attemptCount) * 1000, 60000)), // Exponential backoff, max 1 min
      userActionRequired: attemptCount >= 3,
      actions: attemptCount < 3 ? [
        {
          type: 'retry' as const,
          title: 'We\'ll retry automatically',
          description: `Attempt ${attemptCount + 1} of 3 will start in ${Math.ceil(Math.min(Math.pow(2, attemptCount), 60) / 1000)} seconds`,
          automatic: true,
        }
      ] : [
        {
          type: 'retry' as const,
          title: 'Try again',
          description: 'The external service is having issues. Please try your search again in a few minutes.',
          estimatedTime: 300000, // 5 minutes
        },
        {
          type: 'modify_search' as const,
          title: 'Reduce search size',
          description: 'Try a smaller search area or fewer results to avoid timeouts.',
        }
      ]
    },

    RATE_LIMITED: {
      strategy: 'wait_and_retry',
      shouldAutoRecover: true,
      nextRetryAt: Date.now() + (15 * 60 * 1000), // 15 minutes
      userActionRequired: false,
      actions: [
        {
          type: 'wait' as const,
          title: 'Please wait',
          description: 'We\'ve hit the rate limit for external services. Your search will resume automatically in 15 minutes.',
          estimatedTime: 15 * 60 * 1000,
          automatic: true,
        },
        {
          type: 'upgrade_plan' as const,
          title: 'Upgrade for priority',
          description: 'Pro and Enterprise users get priority access and higher rate limits.',
        }
      ]
    },

    INSUFFICIENT_CREDITS: {
      strategy: 'user_action_required',
      shouldAutoRecover: false,
      userActionRequired: true,
      actions: [
        {
          type: 'upgrade_plan' as const,
          title: 'Add credits',
          description: 'Purchase more credits to complete this search.',
          creditCost: search.parameters?.maxResults || 50,
        },
        {
          type: 'modify_search' as const,
          title: 'Reduce search size',
          description: 'Try a smaller search to fit your current credit balance.',
        }
      ]
    },

    NO_RESULTS_FOUND: {
      strategy: 'user_guidance',
      shouldAutoRecover: false,
      userActionRequired: true,
      actions: [
        {
          type: 'modify_search' as const,
          title: 'Expand search area',
          description: 'Try increasing the radius or using different keywords.',
        },
        {
          type: 'modify_search' as const,
          title: 'Try different keywords',
          description: 'Use broader business categories or related industry terms.',
        }
      ]
    },

    ENRICHMENT_FAILED: {
      strategy: 'partial_success',
      shouldAutoRecover: false,
      userActionRequired: false,
      actions: [
        {
          type: 'retry' as const,
          title: 'Continue with basic info',
          description: 'We found the businesses but couldn\'t get all contact details. You can still view the results.',
        }
      ]
    },

    // Default fallback strategy
    UNKNOWN: {
      strategy: 'support_contact',
      shouldAutoRecover: false,
      userActionRequired: true,
      actions: [
        {
          type: 'contact_support' as const,
          title: 'Contact support',
          description: 'Something unexpected happened. Our team will help resolve this quickly.',
        },
        {
          type: 'retry' as const,
          title: 'Try again',
          description: 'Start a new search - this might have been a temporary issue.',
        }
      ]
    }
  };

  return strategies[errorType as keyof typeof strategies] || strategies.UNKNOWN;
}

// Broadcast error with recovery options to user
async function broadcastErrorWithRecovery(ctx: any, searchId: string, recovery: any) {
  const search = await ctx.db.get(searchId);
  if (!search) return;

  const isAutoRecovering = recovery.shouldAutoRecover;
  const title = isAutoRecovering ? "Temporary Issue - We're fixing it" : "Action Needed";
  
  // Create user-friendly error message
  let message = recovery.actions[0]?.description || "Please check the details below.";
  
  if (isAutoRecovering && recovery.nextRetryAt) {
    const retryIn = Math.ceil((recovery.nextRetryAt - Date.now()) / 1000);
    message += ` Retrying in ${retryIn} seconds.`;
  }

  await broadcastSearchUpdate(ctx, searchId, "error_recovery", message, {
    priority: recovery.userActionRequired ? 4 : 2,
    data: {
      recovery: {
        strategy: recovery.strategy,
        actions: recovery.actions,
        userActionRequired: recovery.userActionRequired,
        nextRetryAt: recovery.nextRetryAt,
      }
    }
  });
}

// Schedule automatic recovery
async function scheduleAutoRecovery(ctx: any, searchId: string, recovery: any) {
  if (!recovery.nextRetryAt) return;

  const delayMs = recovery.nextRetryAt - Date.now();
  
  await ctx.scheduler.runAfter(delayMs, internal.search.errorRecovery.executeAutoRecovery, {
    searchId,
    strategy: recovery.strategy,
  });

  console.log(`Scheduled auto-recovery for search ${searchId} in ${Math.ceil(delayMs / 1000)} seconds`);
}

// Execute automatic recovery
export const executeAutoRecovery = internalAction({
  args: {
    searchId: v.id("searches"),
    strategy: v.string(),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.internal.getSearchById, {
      searchId: args.searchId,
    });

    if (!search) {
      console.error(`Auto-recovery failed: search ${args.searchId} not found`);
      return;
    }

    // Don't recover if search is already completed/cancelled
    if (search.status === STATUS.SEARCH.COMPLETED || search.status === STATUS.SEARCH.CANCELLED) {
      console.log(`Auto-recovery skipped: search ${args.searchId} is ${search.status}`);
      return;
    }

    try {
      console.log(`Executing auto-recovery for search ${args.searchId}: ${args.strategy}`);

      // Reset search to pending status for retry
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: STATUS.SEARCH.PENDING,
      });

      // Clear error state
      await ctx.runMutation(internal.search.internal.clearSearchError, {
        searchId: args.searchId,
      });

      // Restart orchestration
      await ctx.scheduler.runAfter(1000, internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId: args.searchId,
      });

      // Notify user of recovery attempt
      await broadcastSearchUpdate(ctx, args.searchId, "auto_recovering", 
        "We've resolved the issue and your search is resuming automatically."
      );

    } catch (error) {
      console.error(`Auto-recovery failed for search ${args.searchId}:`, error);
      
      // Notify user that auto-recovery failed
      await broadcastSearchUpdate(ctx, args.searchId, "recovery_failed", 
        "Automatic recovery didn't work. Please try starting a new search.", {
          priority: 4,
          requiresAck: true
        }
      );
    }
  },
});

// Provide recovery suggestions based on search parameters and error
export const getRecoverySuggestions = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const suggestions = [];
    const params = search.parameters;

    // Analyze search parameters for optimization suggestions
    if (params.maxResults > 100) {
      suggestions.push({
        type: 'reduce_scope',
        title: 'Try a smaller search',
        description: `Your search for ${params.maxResults} results is quite large. Try 50 results first.`,
        newParameters: { ...params, maxResults: 50 }
      });
    }

    if (params.radius > 25) {
      suggestions.push({
        type: 'reduce_radius',
        title: 'Search a smaller area',
        description: `Searching within ${params.radius} miles is very broad. Try 10-15 miles first.`,
        newParameters: { ...params, radius: Math.min(15, Math.floor(params.radius / 2)) }
      });
    }

    if (params.keywords.length > 5) {
      suggestions.push({
        type: 'fewer_keywords',
        title: 'Use fewer keywords',
        description: `${params.keywords.length} keywords might be too specific. Try 2-3 main keywords.`,
        newParameters: { ...params, keywords: params.keywords.slice(0, 3) }
      });
    }

    // Add fallback suggestions
    suggestions.push({
      type: 'basic_retry',
      title: 'Try again',
      description: 'This might have been a temporary issue. The same search could work now.',
    });

    return {
      searchId: args.searchId,
      currentParameters: params,
      suggestions,
      canRetryAutomatically: search.errorRecovery?.attemptCount < 3,
    };
  },
});

// Clear search error state for recovery
export const clearSearchError = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.searchId, {
      error: undefined,
      errorRecovery: undefined,
    });
  },
});