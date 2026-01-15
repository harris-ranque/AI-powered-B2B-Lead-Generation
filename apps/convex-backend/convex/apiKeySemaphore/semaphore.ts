/**
 * API Key Semaphore System for FindyMail Enrichment (v2 - Slot-Based)
 *
 * PROBLEM SOLVED: OCC (Optimistic Concurrency Control) failures
 * The previous implementation used a single counter document per API key,
 * causing hot-spot contention when many concurrent requests tried to
 * increment/decrement the same document.
 *
 * SOLUTION: Distributed slot-based approach
 * Instead of one counter document, we create 5 slot documents per API key.
 * Each request claims an individual slot, eliminating contention because
 * different requests target different documents.
 *
 * Flow:
 * 1. tryAcquireApiKeySlot: Tries to claim any available slot (0-4)
 * 2. releaseApiKeySlot: Releases the specific slot that was claimed
 * 3. Expired slots (>10 min) are auto-released to handle stuck requests
 *
 * Concurrency Model:
 * - Each unique API key gets 5 slots (indices 0-4)
 * - A slot is "available" if claimedBy is null or claimedAt is expired
 * - Claiming a slot = writing claimedBy + claimedAt to that slot's document
 * - Different requests will naturally distribute across different slots
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// FindyMail rate limit: 5 concurrent requests per API key
const MAX_SLOTS_PER_KEY = 5;
// Slot expiration time: 10 minutes (handles stuck requests)
const SLOT_EXPIRATION_MS = 10 * 60 * 1000;

/**
 * Initialize slots for an API key if they don't exist
 * Creates 5 slot documents (indices 0-4) for the given API key hash
 */
async function ensureSlotsExist(
  ctx: { db: any },
  apiKeyHash: string
): Promise<void> {
  // Check if slots already exist
  const existingSlots = await ctx.db
    .query("enrichmentApiKeySlots")
    .withIndex("by_key_hash", (q: any) => q.eq("apiKeyHash", apiKeyHash))
    .collect();

  if (existingSlots.length >= MAX_SLOTS_PER_KEY) {
    return; // Slots already initialized
  }

  // Create missing slots
  const existingIndices = new Set(existingSlots.map((s: any) => s.slotIndex));
  for (let i = 0; i < MAX_SLOTS_PER_KEY; i++) {
    if (!existingIndices.has(i)) {
      await ctx.db.insert("enrichmentApiKeySlots", {
        apiKeyHash,
        slotIndex: i,
        claimedBy: undefined,
        claimedAt: undefined,
        expiresAt: undefined,
      });
    }
  }
}

/**
 * Try to acquire a slot for an API key (non-blocking)
 * Returns true if slot acquired, false if at capacity
 *
 * IMPORTANT: The claimId should be unique per request (e.g., leadId or UUID)
 * This allows proper slot release and debugging.
 */
export const tryAcquireApiKeySlot = internalMutation({
  args: {
    apiKeyHash: v.string(),
    claimId: v.optional(v.string()), // Optional unique ID for the request
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const claimId = args.claimId || `claim_${now}_${Math.random().toString(36).slice(2)}`;

    // Ensure slots exist for this API key
    await ensureSlotsExist(ctx, args.apiKeyHash);

    // Get all slots for this API key
    const slots = await ctx.db
      .query("enrichmentApiKeySlots")
      .withIndex("by_key_hash", (q: any) => q.eq("apiKeyHash", args.apiKeyHash))
      .collect();

    // Sort by slot index for deterministic behavior
    slots.sort((a: any, b: any) => a.slotIndex - b.slotIndex);

    // Count active slots and find first available
    let activeCount = 0;
    let availableSlot: any = null;

    for (const slot of slots) {
      const isExpired = slot.expiresAt && slot.expiresAt < now;
      const isClaimed = slot.claimedBy && !isExpired;

      if (isClaimed) {
        activeCount++;
      } else if (!availableSlot) {
        availableSlot = slot;
      }
    }

    // If no slot available, return failure
    if (!availableSlot) {
      console.log(
        `[Semaphore] No slots available for API key ${args.apiKeyHash.substring(0, 8)}... ` +
        `(${activeCount}/${MAX_SLOTS_PER_KEY} active)`
      );
      return {
        acquired: false,
        currentActive: activeCount,
        slotIndex: undefined,
        claimId: undefined,
      };
    }

    // Claim the slot
    const expiresAt = now + SLOT_EXPIRATION_MS;
    await ctx.db.patch(availableSlot._id, {
      claimedBy: claimId,
      claimedAt: now,
      expiresAt,
    });

    console.log(
      `[Semaphore] Claimed slot ${availableSlot.slotIndex} for API key ${args.apiKeyHash.substring(0, 8)}... ` +
      `(claim: ${claimId.substring(0, 16)}..., active: ${activeCount + 1}/${MAX_SLOTS_PER_KEY})`
    );

    return {
      acquired: true,
      currentActive: activeCount + 1,
      slotIndex: availableSlot.slotIndex,
      claimId,
    };
  },
});

/**
 * Release a slot for an API key
 * Called when enrichment completes (success, failure, or error)
 *
 * Can release by claimId (preferred) or slotIndex (fallback)
 *
 * IMPORTANT: After releasing, this automatically triggers the next queued lead!
 */
export const releaseApiKeySlot = internalMutation({
  args: {
    apiKeyHash: v.string(),
    claimId: v.optional(v.string()),
    slotIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Find the slot to release
    let slotToRelease: any = null;

    if (args.claimId) {
      // Find by claimId (preferred - more precise)
      const slots = await ctx.db
        .query("enrichmentApiKeySlots")
        .withIndex("by_key_hash", (q: any) => q.eq("apiKeyHash", args.apiKeyHash))
        .collect();

      slotToRelease = slots.find((s: any) => s.claimedBy === args.claimId);
    }

    if (!slotToRelease && args.slotIndex !== undefined) {
      // Fallback to slotIndex
      slotToRelease = await ctx.db
        .query("enrichmentApiKeySlots")
        .withIndex("by_key_and_slot", (q: any) =>
          q.eq("apiKeyHash", args.apiKeyHash).eq("slotIndex", args.slotIndex)
        )
        .first();
    }

    if (!slotToRelease) {
      console.error(
        `[Semaphore] No slot found to release for API key ${args.apiKeyHash.substring(0, 8)}... ` +
        `(claimId: ${args.claimId?.substring(0, 16) || "N/A"}, slotIndex: ${args.slotIndex ?? "N/A"})`
      );
      return { released: false, triggeredNext: false };
    }

    // Release the slot
    await ctx.db.patch(slotToRelease._id, {
      claimedBy: undefined,
      claimedAt: undefined,
      expiresAt: undefined,
    });

    // Count remaining active slots
    const allSlots = await ctx.db
      .query("enrichmentApiKeySlots")
      .withIndex("by_key_hash", (q: any) => q.eq("apiKeyHash", args.apiKeyHash))
      .collect();

    const now = Date.now();
    const activeCount = allSlots.filter((s: any) => {
      const isExpired = s.expiresAt && s.expiresAt < now;
      return s.claimedBy && !isExpired && s._id !== slotToRelease._id;
    }).length;

    console.log(
      `[Semaphore] Released slot ${slotToRelease.slotIndex} for API key ${args.apiKeyHash.substring(0, 8)}... ` +
      `(active: ${activeCount}/${MAX_SLOTS_PER_KEY})`
    );

    // Check if there are queued leads waiting for a slot
    const nextQueued = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_api_key_status", (q: any) =>
        q.eq("apiKeyHash", args.apiKeyHash).eq("status", "pending")
      )
      .first();

    let triggeredNext = false;
    if (nextQueued) {
      console.log(
        `[Semaphore] 🚀 Triggering next queued lead ${nextQueued.leadId} for API key ${args.apiKeyHash.substring(0, 8)}...`
      );

      // Mark as processing to prevent duplicate triggers
      await ctx.db.patch(nextQueued._id, {
        status: "processing",
        processedAt: now,
      });

      // Schedule the enrichment action to run immediately
      // Import is done via internal reference to avoid circular deps
      await ctx.scheduler.runAfter(0, internal.leads.asyncEnrichment.enrichSingleLeadWorkpool, {
        leadId: nextQueued.leadId,
        searchId: nextQueued.searchId,
        userId: nextQueued.userId,
        userApiKey: nextQueued.userApiKey,
        correlationId: nextQueued.correlationId,
        // Mark this as a retry from queue so it doesn't re-queue on failure
        _fromQueue: true,
      });

      triggeredNext = true;
    }

    return {
      released: true,
      currentActive: activeCount,
      releasedSlotIndex: slotToRelease.slotIndex,
      triggeredNext,
      nextLeadId: nextQueued?.leadId,
    };
  },
});

/**
 * Add a lead to the enrichment queue when slots are full
 * Called by enrichSingleLeadWorkpool when it can't acquire a slot
 */
export const queueLeadForSlot = internalMutation({
  args: {
    apiKeyHash: v.string(),
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    userApiKey: v.string(),
    correlationId: v.optional(v.string()),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if this lead is already queued (prevent duplicates)
    const existing = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_lead", (q: any) => q.eq("leadId", args.leadId))
      .filter((q: any) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "processing")
        )
      )
      .first();

    if (existing) {
      console.log(
        `[Semaphore] Lead ${args.leadId} already queued (status: ${existing.status})`
      );
      return { queued: false, reason: "already_queued", queueId: existing._id };
    }

    // Add to queue
    const queueId = await ctx.db.insert("enrichmentSlotQueue", {
      apiKeyHash: args.apiKeyHash,
      leadId: args.leadId,
      searchId: args.searchId,
      userId: args.userId,
      userApiKey: args.userApiKey,
      correlationId: args.correlationId,
      queuedAt: now,
      priority: args.priority ?? 0,
      status: "pending",
    });

    // Count queue depth for logging
    const queueDepth = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_api_key_status", (q: any) =>
        q.eq("apiKeyHash", args.apiKeyHash).eq("status", "pending")
      )
      .collect();

    console.log(
      `[Semaphore] 📥 Queued lead ${args.leadId} for API key ${args.apiKeyHash.substring(0, 8)}... ` +
      `(queue depth: ${queueDepth.length})`
    );

    return { queued: true, queueId, queueDepth: queueDepth.length };
  },
});

/**
 * Mark a queued lead as completed (called after successful enrichment)
 */
export const markQueuedLeadCompleted = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const queueEntry = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_lead", (q: any) => q.eq("leadId", args.leadId))
      .filter((q: any) => q.eq(q.field("status"), "processing"))
      .first();

    if (queueEntry) {
      await ctx.db.patch(queueEntry._id, {
        status: "completed",
      });
      return { updated: true };
    }

    return { updated: false };
  },
});

/**
 * Cancel all queued leads for a search (called when search is cancelled)
 */
export const cancelQueuedLeadsForSearch = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const queuedLeads = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_search", (q: any) =>
        q.eq("searchId", args.searchId).eq("status", "pending")
      )
      .collect();

    for (const entry of queuedLeads) {
      await ctx.db.patch(entry._id, {
        status: "cancelled",
      });
    }

    console.log(
      `[Semaphore] Cancelled ${queuedLeads.length} queued leads for search ${args.searchId}`
    );

    return { cancelled: queuedLeads.length };
  },
});

/**
 * Get queue status for an API key (for monitoring)
 */
export const getQueueStatus = internalQuery({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_api_key_status", (q: any) =>
        q.eq("apiKeyHash", args.apiKeyHash).eq("status", "pending")
      )
      .collect();

    const processing = await ctx.db
      .query("enrichmentSlotQueue")
      .withIndex("by_api_key_status", (q: any) =>
        q.eq("apiKeyHash", args.apiKeyHash).eq("status", "processing")
      )
      .collect();

    return {
      pendingCount: pending.length,
      processingCount: processing.length,
      pendingLeads: pending.map((p: any) => p.leadId),
      processingLeads: processing.map((p: any) => p.leadId),
    };
  },
});

/**
 * Clean up expired slots (can be called by cron or manually)
 * This ensures stuck requests don't permanently block slots
 */
export const cleanupExpiredSlots = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Find all expired slots
    const expiredSlots = await ctx.db
      .query("enrichmentApiKeySlots")
      .withIndex("by_expires")
      .filter((q: any) =>
        q.and(
          q.neq(q.field("expiresAt"), undefined),
          q.lt(q.field("expiresAt"), now)
        )
      )
      .collect();

    if (expiredSlots.length === 0) {
      return { cleaned: 0 };
    }

    // Release each expired slot
    for (const slot of expiredSlots) {
      console.log(
        `[Semaphore] Auto-releasing expired slot ${slot.slotIndex} for API key ${slot.apiKeyHash.substring(0, 8)}... ` +
        `(claimed by: ${slot.claimedBy?.substring(0, 16) || "N/A"}, ` +
        `expired: ${Math.round((now - (slot.expiresAt || 0)) / 1000)}s ago)`
      );

      await ctx.db.patch(slot._id, {
        claimedBy: undefined,
        claimedAt: undefined,
        expiresAt: undefined,
      });
    }

    return { cleaned: expiredSlots.length };
  },
});

/**
 * Get current slot status for an API key (for debugging/monitoring)
 */
export const getApiKeySlotStatus = internalQuery({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const slots = await ctx.db
      .query("enrichmentApiKeySlots")
      .withIndex("by_key_hash", (q: any) => q.eq("apiKeyHash", args.apiKeyHash))
      .collect();

    if (slots.length === 0) {
      return {
        exists: false,
        slots: [],
        activeCount: 0,
        maxSlots: MAX_SLOTS_PER_KEY,
        availableSlots: MAX_SLOTS_PER_KEY,
      };
    }

    const now = Date.now();
    const slotDetails = slots.map((s: any) => {
      const isExpired = s.expiresAt && s.expiresAt < now;
      return {
        slotIndex: s.slotIndex,
        isClaimed: !!s.claimedBy && !isExpired,
        isExpired,
        claimedBy: s.claimedBy?.substring(0, 16),
        claimedAt: s.claimedAt,
        expiresAt: s.expiresAt,
        remainingMs: s.expiresAt ? Math.max(0, s.expiresAt - now) : null,
      };
    });

    slotDetails.sort((a: any, b: any) => a.slotIndex - b.slotIndex);

    const activeCount = slotDetails.filter((s: any) => s.isClaimed).length;

    return {
      exists: true,
      slots: slotDetails,
      activeCount,
      maxSlots: MAX_SLOTS_PER_KEY,
      availableSlots: MAX_SLOTS_PER_KEY - activeCount,
    };
  },
});

/**
 * Get all active slots across all API keys (for admin monitoring)
 */
export const getAllSemaphores = internalQuery({
  handler: async (ctx) => {
    const allSlots = await ctx.db.query("enrichmentApiKeySlots").collect();

    // Group by API key hash
    const byApiKey = new Map<string, any[]>();
    for (const slot of allSlots) {
      const existing = byApiKey.get(slot.apiKeyHash) || [];
      existing.push(slot);
      byApiKey.set(slot.apiKeyHash, existing);
    }

    const now = Date.now();
    const results = [];

    for (const [apiKeyHash, slots] of byApiKey) {
      const activeSlots = slots.filter((s: any) => {
        const isExpired = s.expiresAt && s.expiresAt < now;
        return s.claimedBy && !isExpired;
      });

      results.push({
        apiKeyHash: apiKeyHash.substring(0, 8) + "...",
        activeRequests: activeSlots.length,
        maxConcurrency: MAX_SLOTS_PER_KEY,
        availableSlots: MAX_SLOTS_PER_KEY - activeSlots.length,
        slots: slots.map((s: any) => ({
          index: s.slotIndex,
          claimed: !!s.claimedBy,
          claimedBy: s.claimedBy?.substring(0, 8),
        })),
      });
    }

    return results;
  },
});

/**
 * Force release all slots for an API key (emergency/admin use)
 */
export const forceReleaseAllSlots = internalMutation({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const slots = await ctx.db
      .query("enrichmentApiKeySlots")
      .withIndex("by_key_hash", (q: any) => q.eq("apiKeyHash", args.apiKeyHash))
      .collect();

    let released = 0;
    for (const slot of slots) {
      if (slot.claimedBy) {
        await ctx.db.patch(slot._id, {
          claimedBy: undefined,
          claimedAt: undefined,
          expiresAt: undefined,
        });
        released++;
      }
    }

    console.log(
      `[Semaphore] Force-released ${released} slots for API key ${args.apiKeyHash.substring(0, 8)}...`
    );

    return { released, totalSlots: slots.length };
  },
});
