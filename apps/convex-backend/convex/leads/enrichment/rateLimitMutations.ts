/**
 * Rate Limiting Mutations for Lead Enrichment.
 *
 * IMPORTANT: FindyMail's only rate limit is 5 concurrent requests per API key.
 * This is enforced by the semaphore system in apiKeySemaphore/semaphore.ts.
 *
 * This file provides a simplified rate limit check that always passes,
 * since the real concurrency limit is handled by the semaphore slots.
 * Kept for backwards compatibility and potential future abuse prevention.
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { getApiKeyHash } from "../../lib/rateLimiter";

/**
 * Check if a FindyMail API request is allowed.
 *
 * NOTE: This always returns ok: true because FindyMail's only limit
 * (5 concurrent per API key) is handled by the semaphore system.
 * The semaphore slot acquisition happens before this check in the
 * enrichment action, so if we get here, we already have a slot.
 *
 * This function is kept for:
 * 1. Backwards compatibility with existing code
 * 2. Potential future abuse prevention
 * 3. Logging/monitoring purposes
 *
 * @returns { ok: true } - Always allows the request (semaphore is the real gate)
 */
export const checkFindyMailRateLimit = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // FindyMail's only limit is 5 concurrent requests per API key.
    // This is handled by the semaphore system (apiKeySemaphore/semaphore.ts).
    // If we get here, we already have a semaphore slot, so always allow.
    return { ok: true };
  },
});

/**
 * Check rate limit without consuming tokens (preview mode).
 *
 * NOTE: Since FindyMail's only limit is 5 concurrent (handled by semaphore),
 * this always returns ok: true. Kept for backwards compatibility.
 */
export const checkFindyMailRateLimitPreview = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Semaphore handles the real limit (5 concurrent per API key)
    return { ok: true };
  },
});

/**
 * Record a 429 error from FindyMail API.
 * This helps track API behavior for monitoring and debugging.
 */
export const recordFindyMail429 = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Log the 429 for analytics/debugging
    console.warn(`[RateLimit] FindyMail 429 error for user ${args.userId}`, {
      retryAfter: args.retryAfter,
      errorMessage: args.errorMessage,
      apiKeyHash: getApiKeyHash(args.apiKey),
    });

    return { recorded: true };
  },
});

/**
 * Reset rate limits for a user (admin function).
 *
 * NOTE: Since we removed hourly/daily limits and only use the semaphore,
 * this function is now a no-op. Kept for backwards compatibility.
 * To reset semaphore slots, use forceReleaseAllSlots in apiKeySemaphore.
 */
export const resetFindyMailRateLimits = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Rate limits removed - semaphore handles concurrency.
    // Use apiKeySemaphore.forceReleaseAllSlots to reset semaphore slots.
    console.log(`[RateLimit] Reset requested for user ${args.userId} - no-op (semaphore handles limits)`);
    return { reset: true };
  },
});
