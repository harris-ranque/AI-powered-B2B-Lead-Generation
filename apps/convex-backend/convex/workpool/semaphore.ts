/**
 * API Key Semaphore System for FindyMail Enrichment
 *
 * Provides per-API-key concurrency limiting (5 concurrent requests per unique API key).
 * This allows multiple users with their own API keys to run concurrently,
 * while ensuring each individual API key respects the 5 concurrent limit.
 *
 * Example:
 * - User A (system key): max 5 concurrent
 * - User B (own key):   max 5 concurrent
 * - User C (own key):   max 5 concurrent
 * Total: up to 15 concurrent requests (5 per unique API key)
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { createHash } from "crypto";

// FindyMail rate limit: 5 concurrent requests per API key
const MAX_CONCURRENCY_PER_KEY = 5;

/**
 * Generate a consistent hash for an API key
 * Uses SHA256 to create a unique identifier for the API key without storing the key itself
 */
export function getApiKeyHash(apiKey: string | undefined): string {
  // Default to system API key identifier if no user key provided
  const keyToHash = apiKey || "SYSTEM_FINDYMAIL_KEY";
  return createHash("sha256").update(keyToHash).digest("hex");
}

/**
 * Try to acquire a slot for an API key (non-blocking)
 * Returns true if slot acquired, false if at capacity
 */
export const tryAcquireApiKeySlot = internalMutation({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    // Find or create semaphore record for this API key
    const existing = await ctx.db
      .query("enrichmentApiKeySemaphores")
      .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", args.apiKeyHash))
      .first();

    if (existing) {
      // Check if we can acquire a slot
      if (existing.activeRequests >= existing.maxConcurrency) {
        // At capacity, cannot acquire
        await ctx.db.patch(existing._id, {
          waitingRequests: existing.waitingRequests + 1,
          lastUpdated: Date.now(),
        });
        return { acquired: false, currentActive: existing.activeRequests };
      }

      // Acquire a slot
      await ctx.db.patch(existing._id, {
        activeRequests: existing.activeRequests + 1,
        lastUpdated: Date.now(),
      });
      return { acquired: true, currentActive: existing.activeRequests + 1 };
    } else {
      // Create new semaphore record and acquire first slot
      await ctx.db.insert("enrichmentApiKeySemaphores", {
        apiKeyHash: args.apiKeyHash,
        activeRequests: 1,
        maxConcurrency: MAX_CONCURRENCY_PER_KEY,
        waitingRequests: 0,
        lastUpdated: Date.now(),
      });
      return { acquired: true, currentActive: 1 };
    }
  },
});

/**
 * Acquire a slot for an API key (blocking with polling)
 * Waits until a slot becomes available, then acquires it
 * Max wait time: 5 minutes (300 seconds)
 */
export const acquireApiKeySlot = internalMutation({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const MAX_WAIT_TIME_MS = 300000; // 5 minutes

    while (true) {
      // Check if we've exceeded max wait time
      if (Date.now() - startTime > MAX_WAIT_TIME_MS) {
        throw new Error(
          `Timeout waiting for API key slot (waited ${MAX_WAIT_TIME_MS / 1000}s). ` +
          `The API key may be at maximum concurrency (${MAX_CONCURRENCY_PER_KEY} concurrent requests).`
        );
      }

      // Try to acquire a slot
      const existing = await ctx.db
        .query("enrichmentApiKeySemaphores")
        .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", args.apiKeyHash))
        .first();

      if (existing) {
        // Check if we can acquire a slot
        if (existing.activeRequests < existing.maxConcurrency) {
          // Acquire a slot
          await ctx.db.patch(existing._id, {
            activeRequests: existing.activeRequests + 1,
            waitingRequests: Math.max(0, existing.waitingRequests - 1),
            lastUpdated: Date.now(),
          });

          return {
            acquired: true,
            currentActive: existing.activeRequests + 1,
            waitedMs: Date.now() - startTime,
          };
        }

        // At capacity, increment waiting counter
        await ctx.db.patch(existing._id, {
          waitingRequests: existing.waitingRequests + 1,
          lastUpdated: Date.now(),
        });

        // Wait before retrying (exponential backoff with jitter)
        const waitTime = Math.min(1000 + Math.random() * 1000, 5000); // 1-2s, max 5s
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      } else {
        // Create new semaphore record and acquire first slot
        await ctx.db.insert("enrichmentApiKeySemaphores", {
          apiKeyHash: args.apiKeyHash,
          activeRequests: 1,
          maxConcurrency: MAX_CONCURRENCY_PER_KEY,
          waitingRequests: 0,
          lastUpdated: Date.now(),
        });

        return {
          acquired: true,
          currentActive: 1,
          waitedMs: Date.now() - startTime,
        };
      }
    }
  },
});

/**
 * Release a slot for an API key
 * Called when enrichment completes (success, failure, or error)
 */
export const releaseApiKeySlot = internalMutation({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const semaphore = await ctx.db
      .query("enrichmentApiKeySemaphores")
      .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", args.apiKeyHash))
      .first();

    if (!semaphore) {
      console.error(
        `[Semaphore] No semaphore record found for API key hash: ${args.apiKeyHash.substring(0, 8)}...`
      );
      return { released: false };
    }

    // Decrement active requests (ensure it doesn't go below 0)
    const newActiveRequests = Math.max(0, semaphore.activeRequests - 1);

    await ctx.db.patch(semaphore._id, {
      activeRequests: newActiveRequests,
      lastUpdated: Date.now(),
    });

    return {
      released: true,
      currentActive: newActiveRequests,
      waitingRequests: semaphore.waitingRequests,
    };
  },
});

/**
 * Get current semaphore status for an API key (for debugging/monitoring)
 */
export const getApiKeySlotStatus = internalQuery({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const semaphore = await ctx.db
      .query("enrichmentApiKeySemaphores")
      .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", args.apiKeyHash))
      .first();

    if (!semaphore) {
      return {
        exists: false,
        activeRequests: 0,
        maxConcurrency: MAX_CONCURRENCY_PER_KEY,
        waitingRequests: 0,
        availableSlots: MAX_CONCURRENCY_PER_KEY,
      };
    }

    return {
      exists: true,
      activeRequests: semaphore.activeRequests,
      maxConcurrency: semaphore.maxConcurrency,
      waitingRequests: semaphore.waitingRequests,
      availableSlots: semaphore.maxConcurrency - semaphore.activeRequests,
      lastUpdated: semaphore.lastUpdated,
    };
  },
});

/**
 * Get all active semaphores (for admin monitoring)
 */
export const getAllSemaphores = internalQuery({
  handler: async (ctx) => {
    const semaphores = await ctx.db
      .query("enrichmentApiKeySemaphores")
      .collect();

    return semaphores.map((s) => ({
      apiKeyHash: s.apiKeyHash.substring(0, 8) + "...", // Show first 8 chars for privacy
      activeRequests: s.activeRequests,
      maxConcurrency: s.maxConcurrency,
      waitingRequests: s.waitingRequests,
      availableSlots: s.maxConcurrency - s.activeRequests,
      lastUpdated: s.lastUpdated,
    }));
  },
});
