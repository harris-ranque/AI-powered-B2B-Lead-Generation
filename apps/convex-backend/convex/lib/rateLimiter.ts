/**
 * Rate Limiter Configuration for External API Calls.
 *
 * Uses @convex-dev/rate-limiter to provide:
 * - Token bucket algorithm for smooth rate limiting with burst capacity
 * - Per-API-key isolation for BYOK support
 * - Transactional safety with automatic rollback
 *
 * IMPORTANT: FindyMail's only limit is 5 concurrent requests per API key.
 * This is handled by the semaphore system in apiKeySemaphore/semaphore.ts.
 * The rate limiter here is kept minimal for potential future use cases.
 */

import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Global rate limiter instance for all external API calls.
 *
 * NOTE: FindyMail only enforces 5 concurrent requests per API key.
 * This is handled by the slot-based semaphore system, NOT this rate limiter.
 * The rate limiter is kept for potential future APIs or abuse prevention.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  /**
   * FindyMail API rate limit - DISABLED/GENEROUS.
   * The real limit (5 concurrent) is handled by the semaphore system.
   * This is kept as a safety net with very generous limits.
   */
  findymailApi: {
    kind: "token bucket",
    rate: 1000,        // Very generous - semaphore is the real limiter
    period: MINUTE,
    capacity: 100,     // Large burst capacity
  },
});

/**
 * Rate limit configuration for adaptive learning.
 *
 * When a 429 error is detected, the system can:
 * 1. Record the actual limit from the error
 * 2. Adjust future rate limit configurations
 * 3. Gradually recover after successful requests
 */
export const FINDYMAIL_RATE_LIMITS = {
  // Default limits (conservative starting point)
  defaultRpm: 60,
  minRpm: 10,
  maxRpm: 300,

  // Concurrent request limits
  maxConcurrent: 5,

  // Retry configuration
  maxRetries: 4,
  baseDelayMs: 800,
  maxDelayMs: 15000,

  // Recovery settings
  halveOn429: true,
  recoveryIncrement: 0.1, // 10% increase after success streak
  successThreshold: 20, // Successes before rate increase attempt
} as const;

/**
 * Create a hash key for BYOK rate limiting.
 * Uses first 8 chars of API key to isolate rate limits per key.
 */
export function getApiKeyHash(apiKey: string | undefined): string {
  if (!apiKey) {
    return "system";
  }
  // Use first 8 chars for isolation (enough for uniqueness, safe to log)
  return `byok_${apiKey.substring(0, 8)}`;
}

/**
 * Check if an error is a rate limit error (429).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes("429") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("quota exceeded")
  );
}

/**
 * Extract retry-after value from error if available.
 */
export function extractRetryAfter(error: unknown): number | undefined {
  if (!error) return undefined;

  const message = error instanceof Error ? error.message : String(error);

  // Try to parse retry-after from error message
  const patterns = [
    /retry.?after[:\s]+(\d+)/i,
    /wait[:\s]+(\d+)\s*seconds?/i,
    /(\d+)\s*seconds?\s*(?:before|until|to)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return parseInt(match[1]!, 10);
    }
  }

  return undefined;
}
