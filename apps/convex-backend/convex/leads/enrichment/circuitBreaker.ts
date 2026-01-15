/**
 * Circuit Breaker for FindyMail Enrichment
 *
 * Implements circuit breaker pattern to prevent infinite retries and
 * cascading failures when rate limits are persistently hit.
 *
 * Features:
 * - Max retry count for rate-limited operations
 * - Exponential backoff with jitter
 * - Circuit state tracking (closed, open, half-open)
 * - Per-lead and per-search circuit breakers
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_BREAKER_CONFIG = {
  // Maximum rate limit retries per lead before giving up
  MAX_RATE_LIMIT_RETRIES: 5,

  // Maximum total enrichment attempts per lead
  MAX_ENRICHMENT_ATTEMPTS: 10,

  // Time window for rate limit tracking (1 hour)
  RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,

  // Circuit breaker thresholds
  FAILURE_THRESHOLD: 5, // Number of failures to trip circuit
  SUCCESS_THRESHOLD: 2, // Successes needed to close circuit

  // Backoff configuration
  INITIAL_BACKOFF_MS: 2000,
  MAX_BACKOFF_MS: 300000, // 5 minutes max
  BACKOFF_MULTIPLIER: 2,

  // Circuit open duration before half-open test
  CIRCUIT_OPEN_DURATION_MS: 60000, // 1 minute
} as const;

/**
 * Circuit breaker states
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Check if a lead should retry after rate limit
 * Returns retry decision with backoff time
 */
export const shouldRetryAfterRateLimit = internalQuery({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { shouldRetry: false, reason: "lead_not_found" };
    }

    const rateLimitRetries = lead.enrichmentRateLimitRetries ?? 0;
    const totalAttempts = lead.enrichmentAttempts ?? 0;

    // Check if we've exceeded rate limit retries
    if (rateLimitRetries >= CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES) {
      return {
        shouldRetry: false,
        reason: "max_rate_limit_retries_exceeded",
        retries: rateLimitRetries,
        maxRetries: CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES,
      };
    }

    // Check if we've exceeded total attempts
    if (totalAttempts >= CIRCUIT_BREAKER_CONFIG.MAX_ENRICHMENT_ATTEMPTS) {
      return {
        shouldRetry: false,
        reason: "max_enrichment_attempts_exceeded",
        attempts: totalAttempts,
        maxAttempts: CIRCUIT_BREAKER_CONFIG.MAX_ENRICHMENT_ATTEMPTS,
      };
    }

    // Calculate backoff with jitter
    const backoffMs = Math.min(
      CIRCUIT_BREAKER_CONFIG.INITIAL_BACKOFF_MS *
        Math.pow(CIRCUIT_BREAKER_CONFIG.BACKOFF_MULTIPLIER, rateLimitRetries),
      CIRCUIT_BREAKER_CONFIG.MAX_BACKOFF_MS
    );

    // Add jitter (±25%)
    const jitter = backoffMs * 0.25 * (Math.random() * 2 - 1);
    const finalBackoffMs = Math.round(backoffMs + jitter);

    return {
      shouldRetry: true,
      backoffMs: finalBackoffMs,
      retryNumber: rateLimitRetries + 1,
      maxRetries: CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES,
    };
  },
});

/**
 * Record a rate limit retry for a lead
 * Increments retry counter and updates timestamp
 */
export const recordRateLimitRetry = internalMutation({
  args: {
    leadId: v.id("leads"),
    retryAfterMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      console.warn(`[CircuitBreaker] Lead ${args.leadId} not found`);
      return { success: false, reason: "lead_not_found" };
    }

    const currentRetries = lead.enrichmentRateLimitRetries ?? 0;
    const currentAttempts = lead.enrichmentAttempts ?? 0;
    const newRetries = currentRetries + 1;
    const newAttempts = currentAttempts + 1;

    await ctx.db.patch(args.leadId, {
      enrichmentRateLimitRetries: newRetries,
      enrichmentAttempts: newAttempts,
      lastEnrichmentAttempt: Date.now(),
      enrichmentError: args.errorMessage || `Rate limited (retry ${newRetries}/${CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES})`,
      updatedAt: Date.now(),
    });

    // Check if we've exceeded max retries
    const maxReached = newRetries >= CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES;

    if (maxReached) {
      console.warn(
        `[CircuitBreaker] Lead ${args.leadId} exceeded max rate limit retries (${newRetries}/${CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES})`
      );

      // Mark lead as failed due to persistent rate limiting
      await ctx.db.patch(args.leadId, {
        enrichmentStatus: "failed",
        enrichmentError: `Exceeded maximum rate limit retries (${newRetries}). Please try again later or contact support.`,
        updatedAt: Date.now(),
      });
    }

    return {
      success: true,
      newRetryCount: newRetries,
      maxRetries: CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES,
      maxReached,
      retryAfterMs: args.retryAfterMs,
    };
  },
});

/**
 * Record a successful enrichment (resets retry counters)
 */
export const recordEnrichmentSuccess = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { success: false, reason: "lead_not_found" };
    }

    // Reset rate limit retries on success (but keep total attempts for analytics)
    await ctx.db.patch(args.leadId, {
      enrichmentRateLimitRetries: 0,
      enrichmentError: undefined,
      updatedAt: Date.now(),
    });

    console.log(
      `[CircuitBreaker] Lead ${args.leadId} enriched successfully, reset rate limit retries`
    );

    return { success: true };
  },
});

/**
 * Record an enrichment failure (non-rate-limit)
 */
export const recordEnrichmentFailure = internalMutation({
  args: {
    leadId: v.id("leads"),
    errorMessage: v.string(),
    errorType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { success: false, reason: "lead_not_found" };
    }

    const currentAttempts = lead.enrichmentAttempts ?? 0;
    const newAttempts = currentAttempts + 1;

    await ctx.db.patch(args.leadId, {
      enrichmentAttempts: newAttempts,
      lastEnrichmentAttempt: Date.now(),
      enrichmentError: args.errorMessage,
      updatedAt: Date.now(),
    });

    // Check if we've exceeded max attempts
    if (newAttempts >= CIRCUIT_BREAKER_CONFIG.MAX_ENRICHMENT_ATTEMPTS) {
      console.warn(
        `[CircuitBreaker] Lead ${args.leadId} exceeded max enrichment attempts (${newAttempts}/${CIRCUIT_BREAKER_CONFIG.MAX_ENRICHMENT_ATTEMPTS})`
      );

      await ctx.db.patch(args.leadId, {
        enrichmentStatus: "failed",
        enrichmentError: `Exceeded maximum enrichment attempts (${newAttempts}). Error: ${args.errorMessage}`,
        updatedAt: Date.now(),
      });

      return {
        success: true,
        newAttemptCount: newAttempts,
        maxReached: true,
      };
    }

    return {
      success: true,
      newAttemptCount: newAttempts,
      maxReached: false,
    };
  },
});

/**
 * Get circuit breaker status for a search
 * Aggregates failure rates across all leads in the search
 */
export const getSearchCircuitStatus = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const stats = {
      total: leads.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      completedFallback: 0,
      noContactsFound: 0,
      failed: 0,
      rateLimited: 0,
      maxRetriesExceeded: 0,
    };

    for (const lead of leads) {
      switch (lead.enrichmentStatus) {
        case "pending":
          stats.pending++;
          break;
        case "in_progress":
          stats.inProgress++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "completed_fallback":
          stats.completedFallback++;
          break;
        case "no_contacts_found":
          stats.noContactsFound++;
          break;
        case "failed":
          stats.failed++;
          break;
      }

      // Count rate-limited leads
      if ((lead.enrichmentRateLimitRetries ?? 0) > 0) {
        stats.rateLimited++;
      }

      // Count max retries exceeded
      if (
        (lead.enrichmentRateLimitRetries ?? 0) >=
        CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES
      ) {
        stats.maxRetriesExceeded++;
      }
    }

    // Calculate circuit state based on failure rate
    const failureRate =
      stats.total > 0 ? (stats.failed + stats.maxRetriesExceeded) / stats.total : 0;

    let circuitState: CircuitState = "closed";
    if (failureRate > 0.5) {
      circuitState = "open";
    } else if (failureRate > 0.2) {
      circuitState = "half-open";
    }

    return {
      ...stats,
      failureRate: Math.round(failureRate * 100),
      circuitState,
      config: {
        maxRateLimitRetries: CIRCUIT_BREAKER_CONFIG.MAX_RATE_LIMIT_RETRIES,
        maxEnrichmentAttempts: CIRCUIT_BREAKER_CONFIG.MAX_ENRICHMENT_ATTEMPTS,
      },
    };
  },
});

/**
 * Check if enrichment should proceed for a search
 * Returns false if circuit is open (too many failures)
 */
export const shouldProceedWithEnrichment = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    if (leads.length === 0) {
      return { shouldProceed: true, reason: "no_leads" };
    }

    // Count recent failures
    const oneHourAgo = Date.now() - CIRCUIT_BREAKER_CONFIG.RATE_LIMIT_WINDOW_MS;
    let recentFailures = 0;
    let rateLimitedInWindow = 0;

    for (const lead of leads) {
      if (
        lead.enrichmentStatus === "failed" &&
        (lead.lastEnrichmentAttempt ?? 0) > oneHourAgo
      ) {
        recentFailures++;
      }

      if (
        (lead.enrichmentRateLimitRetries ?? 0) > 0 &&
        (lead.lastEnrichmentAttempt ?? 0) > oneHourAgo
      ) {
        rateLimitedInWindow++;
      }
    }

    // Trip circuit if too many recent failures
    if (recentFailures >= CIRCUIT_BREAKER_CONFIG.FAILURE_THRESHOLD) {
      return {
        shouldProceed: false,
        reason: "circuit_open",
        recentFailures,
        threshold: CIRCUIT_BREAKER_CONFIG.FAILURE_THRESHOLD,
        message: `Too many failures in the last hour (${recentFailures}). Please wait before retrying.`,
      };
    }

    // Warn if many rate limits
    if (rateLimitedInWindow > leads.length * 0.3) {
      return {
        shouldProceed: true,
        warning: "high_rate_limit_rate",
        rateLimitedInWindow,
        message: `High rate limiting detected (${rateLimitedInWindow}/${leads.length} leads). Processing may be slow.`,
      };
    }

    return { shouldProceed: true };
  },
});
