/**
 * Rate Limiting Mutations for Lead Enrichment.
 *
 * Uses @convex-dev/rate-limiter to provide transactional rate limiting
 * for FindyMail API calls with per-user quota enforcement.
 *
 * The rate limiter is designed to:
 * 1. Enforce per-user quotas (prevent single user from exhausting system credits)
 * 2. Limit concurrent requests (respect FindyMail's 5 concurrent limit)
 * 3. Learn from 429 errors and adapt limits
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { rateLimiter, getApiKeyHash } from "../../lib/rateLimiter";

/**
 * Check if a FindyMail API request is allowed.
 *
 * This mutation is called before making each API request to:
 * 1. Check per-user hourly/daily quotas
 * 2. Check concurrent request limits
 * 3. Return wait time if rate limited
 *
 * @returns { ok: boolean, retryAfter?: number }
 */
export const checkFindyMailRateLimit = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const key = args.userId;  // Per-user isolation
    const count = args.count ?? 1;

    // Check hourly limit first (most likely to be hit)
    const hourlyResult = await rateLimiter.limit(ctx, "findymailHourlyPerUser", {
      key,
      count,
    });

    if (!hourlyResult.ok) {
      console.log(`[RateLimit] User ${args.userId} hit hourly limit, retry after ${hourlyResult.retryAfter}ms`);
      return {
        ok: false,
        retryAfter: hourlyResult.retryAfter,
        reason: "hourly_limit_exceeded",
      };
    }

    // Check daily limit
    const dailyResult = await rateLimiter.limit(ctx, "findymailDailyPerUser", {
      key,
      count,
    });

    if (!dailyResult.ok) {
      console.log(`[RateLimit] User ${args.userId} hit daily limit, retry after ${dailyResult.retryAfter}ms`);
      return {
        ok: false,
        retryAfter: dailyResult.retryAfter,
        reason: "daily_limit_exceeded",
      };
    }

    // Check global API rate limit
    const apiKeyHash = getApiKeyHash(args.apiKey);
    const apiResult = await rateLimiter.limit(ctx, "findymailApi", {
      key: apiKeyHash,
      count,
    });

    if (!apiResult.ok) {
      console.log(`[RateLimit] FindyMail API limit hit for key ${apiKeyHash}, retry after ${apiResult.retryAfter}ms`);
      return {
        ok: false,
        retryAfter: apiResult.retryAfter,
        reason: "api_limit_exceeded",
      };
    }

    return { ok: true };
  },
});

/**
 * Check rate limit without consuming tokens.
 * Use this for pre-flight checks before starting batch operations.
 */
export const checkFindyMailRateLimitPreview = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const key = args.userId;
    const count = args.count ?? 1;

    // Check all limits without consuming
    const hourlyCheck = await rateLimiter.check(ctx, "findymailHourlyPerUser", {
      key,
      count,
    });

    const dailyCheck = await rateLimiter.check(ctx, "findymailDailyPerUser", {
      key,
      count,
    });

    const apiKeyHash = getApiKeyHash(args.apiKey);
    const apiCheck = await rateLimiter.check(ctx, "findymailApi", {
      key: apiKeyHash,
      count,
    });

    // Return combined status
    if (!hourlyCheck.ok) {
      return {
        ok: false,
        retryAfter: hourlyCheck.retryAfter,
        reason: "hourly_limit_exceeded",
      };
    }

    if (!dailyCheck.ok) {
      return {
        ok: false,
        retryAfter: dailyCheck.retryAfter,
        reason: "daily_limit_exceeded",
      };
    }

    if (!apiCheck.ok) {
      return {
        ok: false,
        retryAfter: apiCheck.retryAfter,
        reason: "api_limit_exceeded",
      };
    }

    return {
      ok: true,
    };
  },
});

/**
 * Record a 429 error from FindyMail API.
 * This helps track API behavior for future optimization.
 */
export const recordFindyMail429 = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Log the 429 for analytics
    console.warn(`[RateLimit] FindyMail 429 error for user ${args.userId}`, {
      retryAfter: args.retryAfter,
      errorMessage: args.errorMessage,
      apiKeyHash: getApiKeyHash(args.apiKey),
    });

    // Future: Store in a table for adaptive learning
    // For now, just log for monitoring

    return { recorded: true };
  },
});

/**
 * Reset rate limits for a user (admin function).
 */
export const resetFindyMailRateLimits = internalMutation({
  args: {
    userId: v.id("users"),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const key = args.userId;

    // Reset hourly limit
    await rateLimiter.reset(ctx, "findymailHourlyPerUser", { key });

    // Reset daily limit
    await rateLimiter.reset(ctx, "findymailDailyPerUser", { key });

    // Reset API limit if BYOK
    if (args.apiKey) {
      const apiKeyHash = getApiKeyHash(args.apiKey);
      await rateLimiter.reset(ctx, "findymailApi", { key: apiKeyHash });
    }

    console.log(`[RateLimit] Reset all FindyMail limits for user ${args.userId}`);

    return { reset: true };
  },
});
