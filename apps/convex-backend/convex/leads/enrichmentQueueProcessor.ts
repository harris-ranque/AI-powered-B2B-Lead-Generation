/**
 * Enrichment Queue Processor (OCC-Safe Single-Consumer Cron)
 *
 * PROBLEM SOLVED: OCC (Optimistic Concurrency Control) failures in enrichment queue
 *
 * The previous implementation had OCC failures when:
 * 1. Multiple `releaseApiKeySlot` calls raced to grab the same next queued lead
 * 2. Multiple leads queued simultaneously causing contention on the queue table
 *
 * SOLUTION: Single-consumer cron pattern
 * 1. Queue state is stored in lead documents (not a separate queue table)
 * 2. A single cron job (every 2s) processes the queue
 * 3. Cron lock prevents overlapping executions
 * 4. releaseApiKeySlot only releases slots (no trigger-on-release)
 *
 * TWO-LEVEL PRIORITY MODEL:
 * - Level 1: API Key (tenant isolation) - each tenant has independent 5 slots
 * - Level 2: Search FIFO within tenant - complete Search 1 before starting Search 2
 *
 * Algorithm:
 * 1. Acquire cron lock (skip if held)
 * 2. Query leads WHERE enrichmentStatus = "pending" AND enrichmentQueuedAt IS NOT NULL
 * 3. Group by enrichmentApiKeyHash (tenant isolation)
 * 4. For each tenant:
 *    a. Sort by enrichmentSearchQueuedAt (FIFO by search)
 *    b. Select leads from OLDEST search only
 *    c. Check available slots via getApiKeySlotStatus
 *    d. Claim slots with tryAcquireApiKeySlot
 *    e. Mark leads as "in_progress", schedule enrichSingleLeadWorkpool
 * 5. Release cron lock
 */

import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

// Cron lock timeout: 30 seconds (should be longer than one cron execution)
const CRON_LOCK_TIMEOUT_MS = 30 * 1000;
const CRON_LOCK_KEY = "enrichment_queue_processor";

// Maximum leads to process per cron tick (prevents long execution times)
const MAX_LEADS_PER_TICK = 25;

// ============================================================================
// CRON LOCK MANAGEMENT
// ============================================================================

/**
 * Try to acquire the cron lock (mutex for cron execution)
 * Returns true if lock acquired, false if another cron is running
 */
export const tryAcquireCronLock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Check if lock exists and is still valid
    const existingLock = await ctx.db
      .query("cronLocks")
      .withIndex("by_key", (q) => q.eq("key", CRON_LOCK_KEY))
      .first();

    if (existingLock) {
      // Check if lock is expired
      if (existingLock.expiresAt > now) {
        // Lock is still held by another execution
        console.log(
          `[EnrichmentQueueProcessor] Lock held - skipping (expires in ${Math.round((existingLock.expiresAt - now) / 1000)}s)`
        );
        return { acquired: false, reason: "lock_held" };
      }

      // Lock is expired - update it to claim
      await ctx.db.patch(existingLock._id, {
        acquiredAt: now,
        expiresAt: now + CRON_LOCK_TIMEOUT_MS,
      });

      console.log(`[EnrichmentQueueProcessor] Acquired expired lock`);
      return { acquired: true, lockId: existingLock._id };
    }

    // No lock exists - create one
    const lockId = await ctx.db.insert("cronLocks", {
      key: CRON_LOCK_KEY,
      acquiredAt: now,
      expiresAt: now + CRON_LOCK_TIMEOUT_MS,
    });

    console.log(`[EnrichmentQueueProcessor] Created new lock`);
    return { acquired: true, lockId };
  },
});

/**
 * Release the cron lock after processing
 */
export const releaseCronLock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lock = await ctx.db
      .query("cronLocks")
      .withIndex("by_key", (q) => q.eq("key", CRON_LOCK_KEY))
      .first();

    if (lock) {
      await ctx.db.delete(lock._id);
      console.log(`[EnrichmentQueueProcessor] Released lock`);
      return { released: true };
    }

    return { released: false, reason: "no_lock_found" };
  },
});

// ============================================================================
// QUEUE QUERIES
// ============================================================================

/**
 * Query for leads that are queued for enrichment
 * Returns leads grouped by API key hash, sorted by search creation time (FIFO)
 */
export const getPendingLeadsForProcessing = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? MAX_LEADS_PER_TICK * 2; // Query more than needed to group

    // Query leads that are queued for enrichment
    // Note: We can't use the full composite index efficiently for "pending" + "not null queuedAt"
    // So we query by enrichmentStatus and filter in memory
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_enrichment_status", (q) => q.eq("enrichmentStatus", "pending"))
      .filter((q) =>
        q.and(
          q.neq(q.field("enrichmentQueuedAt"), undefined),
          q.neq(q.field("enrichmentApiKeyHash"), undefined)
        )
      )
      .take(limit);

    // Group leads by API key hash
    const leadsByApiKey = new Map<string, typeof leads>();
    for (const lead of leads) {
      const apiKeyHash = lead.enrichmentApiKeyHash!;
      if (!leadsByApiKey.has(apiKeyHash)) {
        leadsByApiKey.set(apiKeyHash, []);
      }
      leadsByApiKey.get(apiKeyHash)!.push(lead);
    }

    // For each API key, sort leads by search creation time (FIFO)
    // and group by search to process oldest search first
    const result: Array<{
      apiKeyHash: string;
      leads: typeof leads;
      oldestSearchQueuedAt: number;
    }> = [];

    for (const [apiKeyHash, apiKeyLeads] of leadsByApiKey) {
      // Sort by enrichmentSearchQueuedAt (oldest search first), then enrichmentQueuedAt
      apiKeyLeads.sort((a, b) => {
        const searchDiff = (a.enrichmentSearchQueuedAt ?? 0) - (b.enrichmentSearchQueuedAt ?? 0);
        if (searchDiff !== 0) return searchDiff;
        return (a.enrichmentQueuedAt ?? 0) - (b.enrichmentQueuedAt ?? 0);
      });

      // Get oldest search's queuedAt
      const oldestSearchQueuedAt = apiKeyLeads[0]?.enrichmentSearchQueuedAt ?? 0;

      // Filter to only leads from the oldest search (FIFO by search)
      const oldestSearchLeads = apiKeyLeads.filter(
        (lead) => lead.enrichmentSearchQueuedAt === oldestSearchQueuedAt
      );

      result.push({
        apiKeyHash,
        leads: oldestSearchLeads,
        oldestSearchQueuedAt,
      });
    }

    return result;
  },
});

// ============================================================================
// LEAD PROCESSING
// ============================================================================

/**
 * Mark a lead as in_progress and clear queue fields
 * Called by the cron before scheduling enrichment
 */
export const claimLeadForEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      return { claimed: false, reason: "lead_not_found" };
    }

    // Verify lead is still in pending state with queue fields set
    if (lead.enrichmentStatus !== "pending") {
      return { claimed: false, reason: "not_pending", currentStatus: lead.enrichmentStatus };
    }

    if (!lead.enrichmentQueuedAt || !lead.enrichmentApiKeyHash) {
      return { claimed: false, reason: "not_queued" };
    }

    // Update lead to in_progress and clear queue fields
    await ctx.db.patch(args.leadId, {
      enrichmentStatus: "in_progress",
      enrichmentStartedAt: Date.now(),
      // Keep enrichmentApiKeyHash for slot release but clear queue position
      enrichmentQueuedAt: undefined,
      enrichmentSearchQueuedAt: undefined,
      updatedAt: Date.now(),
    });

    return {
      claimed: true,
      searchId: lead.searchId,
      userId: lead.userId,
      apiKeyHash: lead.enrichmentApiKeyHash,
    };
  },
});

// ============================================================================
// MAIN CRON HANDLER
// ============================================================================

// Return type for processEnrichmentQueue
type ProcessEnrichmentQueueResult = {
  processed: number;
  skipped: boolean;
  reason?: string;
  groups?: Array<{
    apiKeyHash: string;
    processed: number;
    slots: number;
  }>;
};

// Type for cron lock acquisition result
type CronLockResult = {
  acquired: boolean;
  lockId?: Id<"cronLocks">;
  reason?: string;
};

/**
 * Main enrichment queue processor (runs every 2 seconds)
 *
 * This is the ONLY entry point for processing queued leads.
 * It implements the single-consumer pattern to avoid OCC failures.
 */
export const processEnrichmentQueue = internalAction({
  handler: async (ctx): Promise<ProcessEnrichmentQueueResult> => {
    // Step 1: Try to acquire cron lock
    const lockResult: CronLockResult = await ctx.runMutation(
      internal.leads.enrichmentQueueProcessor.tryAcquireCronLock,
      {}
    );

    if (!lockResult.acquired) {
      // Another cron is running - skip this tick
      return { processed: 0, skipped: true, reason: lockResult.reason };
    }

    try {
      // Step 2: Query pending leads grouped by API key
      const pendingGroups = await ctx.runQuery(
        internal.leads.enrichmentQueueProcessor.getPendingLeadsForProcessing,
        { limit: MAX_LEADS_PER_TICK * 3 }
      );

      if (pendingGroups.length === 0) {
        // No leads to process
        return { processed: 0, skipped: false, reason: "no_pending_leads" };
      }

      // Step 3: Process each API key group
      let totalProcessed = 0;
      const results: Array<{
        apiKeyHash: string;
        processed: number;
        slots: number;
      }> = [];

      for (const group of pendingGroups) {
        if (totalProcessed >= MAX_LEADS_PER_TICK) {
          break; // Limit total processing per tick
        }

        // Get available slots for this API key
        const slotStatus = await ctx.runQuery(
          internal.apiKeySemaphore.semaphore.getApiKeySlotStatus,
          { apiKeyHash: group.apiKeyHash }
        );

        const availableSlots = slotStatus.availableSlots;
        if (availableSlots <= 0) {
          // No slots available for this API key
          results.push({
            apiKeyHash: group.apiKeyHash.substring(0, 8),
            processed: 0,
            slots: 0,
          });
          continue;
        }

        // Process leads up to available slots (slots are claimed inside async enrichment)
        const leadsToProcess = group.leads.slice(
          0,
          Math.min(availableSlots, MAX_LEADS_PER_TICK - totalProcessed)
        );
        let processed = 0;

        for (const lead of leadsToProcess) {
          // Claim the lead (mark as in_progress)
          const claimResult = await ctx.runMutation(
            internal.leads.enrichmentQueueProcessor.claimLeadForEnrichment,
            { leadId: lead._id }
          );

          if (!claimResult.claimed || !claimResult.searchId || !claimResult.userId) {
            continue;
          }

          // Schedule enrichment action
          await ctx.scheduler.runAfter(0, internal.leads.asyncEnrichment.enrichSingleLeadWorkpool, {
            leadId: lead._id,
            searchId: claimResult.searchId,
            userId: claimResult.userId,
            // Note: We don't have userApiKey stored in leads, so the action will use system key
            // This is a limitation we may want to address in future iterations
            _fromQueue: true,
          });

          processed++;
          totalProcessed++;
        }

        results.push({
          apiKeyHash: group.apiKeyHash.substring(0, 8),
          processed,
          slots: availableSlots,
        });
      }

      console.log(
        `[EnrichmentQueueProcessor] Processed ${totalProcessed} leads across ${results.length} API keys`,
        results
      );

      return {
        processed: totalProcessed,
        skipped: false,
        groups: results,
      };
    } finally {
      // Step 4: Always release cron lock
      await ctx.runMutation(
        internal.leads.enrichmentQueueProcessor.releaseCronLock,
        {}
      );
    }
  },
});

/**
 * Clean up expired cron locks (safety measure)
 * Can be called manually if cron gets stuck
 */
export const cleanupExpiredCronLocks = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    const expiredLocks = await ctx.db
      .query("cronLocks")
      .withIndex("by_expires")
      .filter((q) =>
        q.and(
          q.neq(q.field("expiresAt"), undefined),
          q.lt(q.field("expiresAt"), now)
        )
      )
      .collect();

    for (const lock of expiredLocks) {
      console.log(
        `[EnrichmentQueueProcessor] Cleaning up expired lock: ${lock.key}`
      );
      await ctx.db.delete(lock._id);
    }

    return { cleaned: expiredLocks.length };
  },
});
