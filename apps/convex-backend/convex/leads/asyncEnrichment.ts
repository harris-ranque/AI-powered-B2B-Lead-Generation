"use node";

/**
 * Async Lead Enrichment with Workpool (Enterprise-Grade Queue Management)
 *
 * ARCHITECTURE: Workpool + Semaphore Hybrid
 * ==========================================
 * - Workpool handles: Queue management, global parallelism (25), automatic retry
 * - Semaphore handles: Per-API-key rate limiting (5 concurrent per unique API key)
 *
 * KEY FEATURES:
 * - Supports 500+ lead searches sustainably
 * - Multiple users with their own API keys
 * - Automatic retry with exponential backoff (2s, 4s, 8s, 16s, 32s)
 * - Completion tracking via onComplete handlers
 * - Race-safe phase transition to AI analysis
 *
 * TWO ACTION TYPES:
 * 1. enrichSingleLeadWorkpool - NEW: Simplified action for Workpool
 *    - No manual retry logic (Workpool handles retries)
 *    - No phase transition (onComplete handler handles it)
 *    - Throws errors to trigger Workpool retry
 *
 * 2. enrichSingleLead - LEGACY: Original action with manual retry
 *    - Kept for backwards compatibility
 *    - Has manual slot retry logic
 *    - Handles phase transition itself
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import {
  createCorrelationContext,
  logWithCorrelation,
  startPerformanceTracking,
  endPerformanceTracking,
  OPERATION_TYPES,
} from "../lib/correlation";
import {
  trackEnrichmentCompleted,
  trackEnrichmentFailed,
} from "../lib/analytics";
import {
  createEnrichmentService,
  EnrichmentProviderFactory,
} from "./enrichment/provider";
import { EnrichmentResult, EnrichmentOptions } from "./enrichment/types";
import { createHash } from "crypto";
import {
  classifyFindyMailError,
  shouldBlockPipeline,
  type ApiError,
} from "../lib/apiErrors";

// Note: Workpool instance is created per-call in enrichLeads action
// This is because we need ctx.runMutation which is only available in action context

/**
 * Generate a consistent hash for an API key
 * Uses SHA256 to create a unique identifier for the API key without storing the key itself
 */
function getApiKeyHash(apiKey: string | undefined): string {
  // Default to system API key identifier if no user key provided
  const keyToHash = apiKey || "SYSTEM_FINDYMAIL_KEY";
  return createHash("sha256").update(keyToHash).digest("hex");
}

// Helper function to extract domain from URL
function extractDomain(url?: string): string {
  if (!url) return "";
  try {
    const parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsedUrl.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0] || "";
  }
}

// Sleep helper for backoff delays
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Result from tryProvider - includes pipeline-blocking error info if applicable
 */
interface TryProviderResult {
  result: (EnrichmentResult & { provider: "findymail" }) | null;
  pipelineBlockingError?: ApiError;
}

/**
 * Try enriching a domain with FindyMail
 * Includes retry logic with exponential backoff
 *
 * IMPORTANT: Detects pipeline-blocking errors (credits exhausted, subscription paused)
 * and propagates them for checkpoint handling rather than swallowing them.
 */
async function tryProvider(
  provider: "findymail",
  domain: string,
  options: {
    retries: number;
    roles?: string[];
    userApiKey?: string;
  }
): Promise<TryProviderResult> {
  const service = createEnrichmentService(options.userApiKey, provider);

  for (let attempt = 1; attempt <= options.retries; attempt++) {
    try {
      console.log(`[${provider}] Attempt ${attempt}/${options.retries} for domain: ${domain}`);

      const result = await service.enrichSingle(domain, { roles: options.roles });

      // Check if we got valid emails
      if (result && result.emails && result.emails.length > 0) {
        console.log(`[${provider}] ✅ Success for ${domain}: found ${result.emails.length} emails`);
        return { result: { ...result, provider } }; // Tag with provider that worked
      }

      // API succeeded but no emails found - don't retry (wastes credits)
      // The domain simply doesn't have discoverable contacts
      console.log(`[${provider}] ⚠️ No emails found for ${domain} - API succeeded but domain has no discoverable contacts`);
      return { result: null }; // Exit immediately, no point retrying
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${provider}] ❌ Error on attempt ${attempt}/${options.retries} for ${domain}: ${errorMsg}`);

      // Check if this is a pipeline-blocking error (credits exhausted, subscription paused, auth failed)
      // These errors should NOT be retried - they require user action
      const apiError = (error as any)?.apiError as ApiError | undefined;
      if (apiError && shouldBlockPipeline(apiError)) {
        console.error(`[${provider}] 🚨 Pipeline-blocking error for ${domain}:`, {
          errorCode: apiError.errorCode,
          category: apiError.category,
          userMessage: apiError.userMessage,
          retryable: apiError.retryable,
        });
        return { result: null, pipelineBlockingError: apiError };
      }

      // If this is the last attempt, break and return null
      if (attempt === options.retries) {
        break;
      }

      // Only retry on actual API errors (network, timeout, 500 errors)
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s (max 15s)
      const backoffDelay = Math.min(Math.pow(2, attempt) * 1000, 15000);
      console.log(`[${provider}] ⏳ Backing off ${backoffDelay}ms before retry...`);
      await sleep(backoffDelay);
    }
  }

  return { result: null };
}

/**
 * WORKPOOL-COMPATIBLE: Enrich a single lead using FindyMail
 *
 * This is the simplified action designed for Workpool orchestration:
 * - NO manual retry logic - Workpool handles retries with exponential backoff
 * - NO phase transition - onComplete handler in workpool.ts handles it
 * - THROWS errors to trigger Workpool retry mechanism
 *
 * The semaphore slot acquisition throws an error if no slot available,
 * which causes Workpool to retry with exponential backoff.
 */
export const enrichSingleLeadWorkpool = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    roles: v.optional(v.array(v.string())),
    userApiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create correlation context for this lead
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LEAD_ENRICHMENT,
      args.userId,
      {
        searchId: args.searchId,
        leadId: args.leadId,
        metadata: {
          stage: "workpool_enrichment",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    // Try to acquire API key slot for rate limiting (5 concurrent per unique API key)
    const apiKeyHash = getApiKeyHash(args.userApiKey);
    const claimId = args.leadId; // Use leadId as claimId for precise slot tracking

    logWithCorrelation(
      "info",
      correlation,
      "🔐 [Workpool] Trying to acquire API key slot",
      {
        leadId: args.leadId,
        apiKeyHash: apiKeyHash.substring(0, 8) + "...",
        maxConcurrency: 5,
      },
    );

    // Try to acquire slot - if not available, throw error to trigger Workpool retry
    const slotResult = await ctx.runMutation(
      internal.apiKeySemaphore.semaphore.tryAcquireApiKeySlot,
      { apiKeyHash, claimId },
    );

    if (!slotResult.acquired) {
      // Throw error to trigger Workpool retry with exponential backoff
      logWithCorrelation(
        "warn",
        correlation,
        "⏳ [Workpool] API key at capacity - Workpool will retry",
        {
          leadId: args.leadId,
          currentActive: slotResult.currentActive,
        },
      );
      throw new Error(`API_KEY_AT_CAPACITY: ${slotResult.currentActive}/5 slots in use`);
    }

    const acquiredClaimId = slotResult.claimId;
    const acquiredSlotIndex = slotResult.slotIndex;

    logWithCorrelation(
      "info",
      correlation,
      "✅ [Workpool] API key slot acquired",
      {
        leadId: args.leadId,
        slotIndex: acquiredSlotIndex,
      },
    );

    // Check circuit breaker status for this search
    const circuitStatus = await ctx.runQuery(
      internal.leads.enrichment.circuitBreaker.getSearchCircuitStatus,
      { searchId: args.searchId }
    );

    if (circuitStatus.circuitState === "open") {
      // Circuit is open - too many failures, skip this lead for now
      logWithCorrelation(
        "warn",
        correlation,
        "🔴 [Workpool] Circuit breaker OPEN - skipping enrichment",
        {
          leadId: args.leadId,
          searchId: args.searchId,
          failureRate: circuitStatus.failureRate,
          failed: circuitStatus.failed,
          total: circuitStatus.total,
        },
      );

      // Release slot
      await ctx.runMutation(
        internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
        { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
      );

      // Don't mark as failed - keep as pending for later retry when circuit closes
      return {
        success: false,
        skipped: true,
        reason: "circuit_breaker_open",
        failureRate: circuitStatus.failureRate,
      };
    }

    // Mark lead as in_progress with timestamp for stuck detection
    await ctx.runMutation(
      internal.leads.internal.updateEnrichmentStatus,
      {
        leadId: args.leadId,
        status: "in_progress",
        enrichmentStartedAt: Date.now(),
      },
    );

    try {
      // Check if enrichment is paused for this search
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        { searchId: args.searchId },
      );

      if (!search) {
        throw new Error(`Search ${args.searchId} not found`);
      }

      if (search.enrichmentPaused) {
        // Release slot and skip
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );
        return { success: false, skipped: true, reason: "enrichment_paused" };
      }

      // Get lead details
      const lead: any = await ctx.runQuery(
        internal.leads.internal.getLeadInternal,
        { leadId: args.leadId },
      );

      if (!lead) {
        throw new Error(`Lead ${args.leadId} not found`);
      }

      // CHECK: Skip enrichment if lead already has emails (e.g., from CSV upload)
      if (
        lead.contactInfo?.emails &&
        Array.isArray(lead.contactInfo.emails) &&
        lead.contactInfo.emails.length > 0 &&
        lead.enrichmentStatus === "completed" &&
        lead.dataSource === "csv_upload"
      ) {
        logWithCorrelation(
          "info",
          correlation,
          "⏭️ [Workpool] Skipping - Lead Already Has Emails",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            emailCount: lead.contactInfo.emails.length,
          },
        );

        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentProvider,
          { leadId: args.leadId, provider: "csv_import" }
        );

        await ctx.runMutation(
          internal.leads.internal.checkEmailDuplication,
          { leadId: args.leadId, userId: args.userId, searchId: args.searchId },
        );

        // Release slot before returning
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        return { success: true, provider: "csv_import", emailsFound: lead.contactInfo.emails.length };
      }

      const domain = extractDomain(lead.website);

      if (!domain) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ [Workpool] No valid domain for lead",
          { leadId: args.leadId, businessName: lead.businessName },
        );

        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          { leadId: args.leadId, status: "completed_fallback", error: "No valid domain available" },
        );

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        return { success: false, provider: "none", reason: "no_domain" };
      }

      logWithCorrelation(
        "info",
        correlation,
        "🔍 [Workpool] Starting Lead Enrichment",
        { leadId: args.leadId, businessName: lead.businessName, domain },
      );

      // CHECK RATE LIMIT
      const rateLimitResult: { ok: boolean; retryAfter?: number; reason?: string } = await ctx.runMutation(
        internal.leads.enrichment.rateLimitMutations.checkFindyMailRateLimit,
        { userId: args.userId, apiKey: args.userApiKey, count: 1 },
      );

      if (!rateLimitResult.ok) {
        // Release slot and throw to trigger Workpool retry
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );
        throw new Error(`RATE_LIMIT_EXCEEDED: Retry after ${rateLimitResult.retryAfter}ms`);
      }

      // PRIMARY PROVIDER: FindyMail (3 retries with internal backoff)
      const { result, pipelineBlockingError } = await tryProvider("findymail", domain, {
        retries: 3,
        roles: args.roles,
        userApiKey: args.userApiKey,
      });

      // PIPELINE-BLOCKING ERROR: Credits exhausted, subscription paused, or auth failed
      // Save checkpoint and propagate error for user action
      if (pipelineBlockingError) {
        logWithCorrelation(
          "error",
          correlation,
          "🚨 [Workpool] Pipeline-blocking error - Saving checkpoint",
          {
            leadId: args.leadId,
            searchId: args.searchId,
            errorCode: pipelineBlockingError.errorCode,
            category: pipelineBlockingError.category,
            userMessage: pipelineBlockingError.userMessage,
          },
        );

        // Save checkpoint for resume capability
        await ctx.runMutation(
          internal.leads.enrichment.checkpoint.createCheckpointFromCurrentState,
          {
            searchId: args.searchId,
            errorCode: pipelineBlockingError.errorCode,
            errorMessage: pipelineBlockingError.userMessage,
          },
        );

        // Mark lead as failed with specific error
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "failed",
            error: `Pipeline blocked: ${pipelineBlockingError.userMessage}`,
          },
        );

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        // Return with error info for workpool to handle
        return {
          success: false,
          provider: "findymail",
          reason: "pipeline_blocked",
          errorCode: pipelineBlockingError.errorCode,
          errorMessage: pipelineBlockingError.userMessage,
          checkpointSaved: true,
        };
      }

      // RESULT HANDLING
      if (result && result.emails.length > 0) {
        // SUCCESS
        await ctx.runMutation(
          internal.leads.internal.updateLeadEnrichment,
          {
            leadId: args.leadId,
            enrichmentData: result,
            status: "completed",
            enrichmentProvider: result.provider,
          },
        );

        await ctx.runMutation(
          internal.leads.internal.checkEmailDuplication,
          { leadId: args.leadId, userId: args.userId, searchId: args.searchId },
        );

        const perfData = endPerformanceTracking(performanceTracker);

        logWithCorrelation(
          "info",
          correlation,
          "✅ [Workpool] Lead Enrichment Successful",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            provider: result.provider,
            emailsFound: result.emails.length,
            durationMs: perfData?.duration || 0,
          },
        );

        trackEnrichmentCompleted({
          searchId: args.searchId,
          leadId: args.leadId,
          provider: result.provider,
          durationMs: perfData?.duration || 0,
          rolesFound: result.contacts?.length || 0,
          emailFound: true,
          retryAttempt: 0,
          apiKeyHash: args.userApiKey ? apiKeyHash : undefined,
        });

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        return { success: true, provider: result.provider, emailsFound: result.emails.length };
      } else {
        // NO EMAILS FOUND - Preserve lead with "no_contacts_found" status
        // This distinguishes between "API succeeded but no results" vs "API error"
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "no_contacts_found",
            error: "FindyMail API succeeded but no discoverable email contacts found for this domain",
          },
        );

        // Update enrichment provider to track that we attempted FindyMail
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentProvider,
          { leadId: args.leadId, provider: "findymail" },
        );

        const perfData = endPerformanceTracking(performanceTracker);

        logWithCorrelation(
          "info",
          correlation,
          "📭 [Workpool] Lead Preserved - No Contacts Found",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            domain,
            durationMs: perfData?.duration || 0,
            note: "Lead preserved with 'no_contacts_found' status for user visibility",
          },
        );

        trackEnrichmentFailed({
          searchId: args.searchId,
          leadId: args.leadId,
          provider: "findymail",
          durationMs: perfData?.duration || 0,
          errorType: "no_emails_found",
          retryAttempt: 0,
        });

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        return { success: true, provider: "findymail", reason: "no_contacts_found", emailsFound: 0 };
      }
    } catch (error) {
      const perfData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "error",
        correlation,
        "💥 [Workpool] Lead Enrichment Error",
        { leadId: args.leadId, durationMs: perfData?.duration || 0 },
        error as Error,
      );

      // Mark lead as failed
      await ctx.runMutation(
        internal.leads.internal.updateEnrichmentStatus,
        { leadId: args.leadId, status: "failed", error: error instanceof Error ? error.message : "Enrichment failed" },
      );

      trackEnrichmentFailed({
        searchId: args.searchId,
        leadId: args.leadId,
        provider: "findymail",
        durationMs: perfData?.duration || 0,
        errorType: error instanceof Error ? error.message : "enrichment_error",
        retryAttempt: 0,
      });

      // Release slot with DLQ fallback for failed releases
      try {
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );
      } catch (releaseError) {
        const releaseErrorMsg = releaseError instanceof Error ? releaseError.message : String(releaseError);
        console.error("Failed to release API key slot:", releaseErrorMsg);

        // Record to DLQ for retry - ensures slot doesn't leak forever
        // Note: Slots auto-expire after 10 min, but DLQ provides faster recovery
        try {
          await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
            operationType: "slot_release",
            searchId: args.searchId,
            leadId: args.leadId,
            error: `Slot release failed: ${releaseErrorMsg}`,
            context: { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
            maxRetries: 3, // Limited retries - slots auto-expire anyway
          });
        } catch (dlqError) {
          // DLQ recording also failed - slot will auto-expire in 10 min
          console.error("Failed to record slot release to DLQ:", dlqError);
        }
      }

      // Re-throw to trigger Workpool retry (unless it's a permanent failure)
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      if (errorMsg.includes("not found") || errorMsg.includes("No valid domain")) {
        // Permanent failure - don't retry
        return { success: false, provider: "none", reason: errorMsg };
      }

      throw error;
    }
  },
});

/**
 * Resume enrichment from checkpoint
 *
 * Called by the enrichment monitoring cron when stuck leads are detected
 * and need to be re-processed. This function re-triggers the enrichment
 * pipeline for any remaining pending leads in the search.
 *
 * Flow:
 * 1. Get all pending leads for the search
 * 2. If pending leads exist, trigger enrichLeads action
 * 3. The enrichLeads action will only process unprocessed leads
 */
export const resumeEnrichmentFromCheckpoint = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const { searchId } = args;

    console.log(`[Resume Enrichment] Starting resume for search ${searchId}`);

    // Get checkpoint info if available
    const checkpoint = await ctx.runQuery(
      internal.leads.enrichment.checkpoint.getCheckpoint,
      { searchId }
    );

    if (checkpoint) {
      console.log(`[Resume Enrichment] Found checkpoint:`, {
        lastProcessedIndex: checkpoint.lastProcessedIndex,
        totalLeads: checkpoint.totalLeads,
        enrichedCount: checkpoint.enrichedCount,
        errorCode: checkpoint.errorCode,
      });

      // Clear checkpoint before resuming
      await ctx.runMutation(
        internal.leads.enrichment.checkpoint.clearCheckpoint,
        { searchId }
      );
    }

    // Get current search status
    const searchStatus = await ctx.runQuery(
      internal.leads.internal.getSearchEnrichmentStatus,
      { searchId }
    );

    if (!searchStatus) {
      console.log(`[Resume Enrichment] Search ${searchId} not found`);
      return { success: false, reason: "search_not_found" };
    }

    const pendingCount = searchStatus.statusCounts.pending;
    const inProgressCount = searchStatus.statusCounts.in_progress;

    console.log(`[Resume Enrichment] Search status:`, {
      totalLeads: searchStatus.totalLeads,
      pending: pendingCount,
      inProgress: inProgressCount,
      enriched: searchStatus.enrichedCount,
    });

    // If no pending leads, nothing to resume
    if (pendingCount === 0 && inProgressCount === 0) {
      console.log(`[Resume Enrichment] No pending leads to process for search ${searchId}`);

      // Check if we should trigger analysis instead
      if (searchStatus.allLeadsEnriched) {
        console.log(`[Resume Enrichment] All leads enriched, triggering analysis`);
        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId }
        );

        if (shouldTriggerAnalysis) {
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId }
          );
        }
      }

      return { success: true, resumed: false, reason: "no_pending_leads" };
    }

    // Trigger enrichment for remaining leads
    console.log(`[Resume Enrichment] Triggering enrichment for ${pendingCount} pending leads`);

    await ctx.scheduler.runAfter(
      0,
      (internal as any)["leads/actions"].enrichLeads,
      { searchId }
    );

    return {
      success: true,
      resumed: true,
      pendingLeads: pendingCount,
      message: `Enrichment resumed for ${pendingCount} pending leads`,
    };
  },
});

/**
 * LEGACY: Enrich a single lead using FindyMail (Original action with manual retry)
 *
 * Flow:
 * 1. Try FindyMail (3 retries with exponential backoff)
 * 2. If no emails found, mark as completed_fallback with no emails
 *
 * Each lead has its own 10-minute action timeout
 */
// Maximum retries for slot acquisition to prevent infinite retry loops
const MAX_SLOT_RETRIES = 30; // With exponential backoff, this gives ~5 minutes of total wait time
// Base delay for slot retry backoff (exponential: 2s, 4s, 8s... capped at 30s)
const SLOT_RETRY_BASE_DELAY_MS = 2000;
const SLOT_RETRY_MAX_DELAY_MS = 30000;

export const enrichSingleLead = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    roles: v.optional(v.array(v.string())),
    userApiKey: v.optional(v.string()),
    slotRetryAttempt: v.optional(v.number()), // Track slot acquisition retries
  },
  handler: async (ctx, args) => {
    const slotRetryAttempt = args.slotRetryAttempt ?? 0;
    // Create correlation context for this lead
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LEAD_ENRICHMENT,
      args.userId,
      {
        searchId: args.searchId,
        leadId: args.leadId,
        metadata: {
          stage: "single_lead_enrichment",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    // Try to acquire API key slot for rate limiting (5 concurrent per unique API key)
    const apiKeyHash = getApiKeyHash(args.userApiKey);
    // Use leadId as claimId for precise slot tracking and release
    const claimId = args.leadId;

    logWithCorrelation(
      "info",
      correlation,
      "🔐 Trying to acquire API key slot for enrichment",
      {
        leadId: args.leadId,
        apiKeyHash: apiKeyHash.substring(0, 8) + "...", // Show first 8 chars only
        maxConcurrency: 5,
        claimId,
      },
    );

    // Try to acquire slot (non-blocking) - now uses slot-based system to avoid OCC failures
    const slotResult = await ctx.runMutation(
      internal.apiKeySemaphore.semaphore.tryAcquireApiKeySlot,
      { apiKeyHash, claimId },
    );

    // If slot not available, reschedule this action for later retry
    if (!slotResult.acquired) {
      // Check if we've exceeded maximum retries
      if (slotRetryAttempt >= MAX_SLOT_RETRIES) {
        logWithCorrelation(
          "error",
          correlation,
          "❌ Max slot retries exceeded - marking lead as failed",
          {
            leadId: args.leadId,
            currentActive: slotResult.currentActive,
            retryAttempt: slotRetryAttempt,
            maxRetries: MAX_SLOT_RETRIES,
          },
        );

        // Mark lead as failed
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "failed",
            error: `Failed to acquire API slot after ${MAX_SLOT_RETRIES} attempts`,
          },
        );

        // Check if we should trigger analysis phase (even with this failure)
        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId: args.searchId }
        );

        if (shouldTriggerAnalysis) {
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: args.searchId }
          );
        }

        return {
          success: false,
          skipped: false,
          retrying: false,
          reason: "max_slot_retries_exceeded",
        };
      }

      // Calculate exponential backoff with jitter (2s, 4s, 8s, 16s... capped at 30s)
      const baseDelay = Math.min(
        SLOT_RETRY_BASE_DELAY_MS * Math.pow(2, slotRetryAttempt),
        SLOT_RETRY_MAX_DELAY_MS
      );
      const jitter = Math.random() * 1000; // 0-1 second jitter
      const retryDelay = baseDelay + jitter;

      logWithCorrelation(
        "info",
        correlation,
        "⏳ API key at capacity - Rescheduling enrichment with backoff",
        {
          leadId: args.leadId,
          currentActive: slotResult.currentActive,
          retryAttempt: slotRetryAttempt + 1,
          maxRetries: MAX_SLOT_RETRIES,
          retryDelayMs: Math.round(retryDelay),
        },
      );

      // Schedule retry with incremented attempt counter
      await ctx.scheduler.runAfter(
        retryDelay,
        internal.leads.asyncEnrichment.enrichSingleLead,
        {
          leadId: args.leadId,
          searchId: args.searchId,
          userId: args.userId,
          roles: args.roles,
          userApiKey: args.userApiKey,
          slotRetryAttempt: slotRetryAttempt + 1,
        }
      );

      return {
        success: false,
        skipped: false,
        retrying: true,
        reason: "api_key_at_capacity",
        retryAttempt: slotRetryAttempt + 1,
      };
    }

    // Store the claimId and slotIndex for release later
    const acquiredClaimId = slotResult.claimId;
    const acquiredSlotIndex = slotResult.slotIndex;

    logWithCorrelation(
      "info",
      correlation,
      "✅ API key slot acquired",
      {
        leadId: args.leadId,
        currentActive: slotResult.currentActive,
        slotIndex: acquiredSlotIndex,
        claimId: acquiredClaimId,
      },
    );

    try {
      // Check if enrichment is paused for this search
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        { searchId: args.searchId },
      );

      if (!search) {
        throw new Error(`Search ${args.searchId} not found`);
      }

      if (search.enrichmentPaused) {
        // Release API key slot before exiting
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "⏸️ Enrichment Paused - Skipping Lead",
          {
            leadId: args.leadId,
            searchId: args.searchId,
            pausedBy: search.pausedBy,
            pausedAt: search.pausedAt,
          },
        );

        return { success: false, skipped: true, reason: "enrichment_paused" };
      }

      // Get lead details
      const lead: any = await ctx.runQuery(
        internal.leads.internal.getLeadInternal,
        { leadId: args.leadId },
      );

      if (!lead) {
        throw new Error(`Lead ${args.leadId} not found`);
      }

      // CHECK: Skip enrichment if lead already has emails (e.g., from CSV upload)
      if (
        lead.contactInfo?.emails &&
        Array.isArray(lead.contactInfo.emails) &&
        lead.contactInfo.emails.length > 0 &&
        lead.enrichmentStatus === "completed" &&
        lead.dataSource === "csv_upload"
      ) {
        logWithCorrelation(
          "info",
          correlation,
          "⏭️  Skipping Enrichment - Lead Already Has Emails",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            emailCount: lead.contactInfo.emails.length,
            source: lead.dataSource || "unknown",
            reason: "Lead already has contact emails (likely from CSV import)",
          },
        );

        // Mark as completed (already enriched from CSV)
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "completed",
          },
        );

        // Update enrichment provider separately using internal mutation
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentProvider,
          { leadId: args.leadId, provider: "csv_import" }
        );

        // Check for email duplicates even for CSV imports
        await ctx.runMutation(
          internal.leads.internal.checkEmailDuplication,
          {
            leadId: args.leadId,
            userId: args.userId,
            searchId: args.searchId,
          },
        );

        const perfData = endPerformanceTracking(performanceTracker);

        logWithCorrelation(
          "info",
          correlation,
          "✅ Lead Marked as Enriched (CSV Import)",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            emailsFound: lead.contactInfo.emails.length,
            durationMs: perfData?.duration || 0,
            creditsUsed: 0, // No enrichment credits used
          },
        );

        // CHECK: Atomically try to trigger AI analysis phase
        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId: args.searchId }
        );

        if (shouldTriggerAnalysis) {
          logWithCorrelation(
            "info",
            correlation,
            "🎉 All Enrichment Complete - Triggering AI Analysis Phase (won race)",
            {
              searchId: args.searchId,
              nextPhase: "ai_analysis",
              triggeredBy: "csv_import_completion",
              note: "This action won the race to trigger analysis",
            },
          );

          // Trigger AI analysis phase (fire-and-forget)
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: args.searchId }
          );
        }

        return {
          success: true,
          provider: "csv_import" as any,
          emailsFound: lead.contactInfo.emails.length,
          skipped: true,
        };
      }

      const domain = extractDomain(lead.website);

      if (!domain) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ No valid domain for lead",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            website: lead.website,
          },
        );

        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "completed_fallback",
            error: "No valid domain available",
          },
        );

        // Release API key slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "🔓 Released API key slot (no domain)",
          { leadId: args.leadId, slotIndex: acquiredSlotIndex },
        );

        return { success: false, provider: "none", reason: "no_domain" };
      }

      logWithCorrelation(
        "info",
        correlation,
        "🔍 Starting Lead Enrichment",
        {
          leadId: args.leadId,
          businessName: lead.businessName,
          domain,
          roles: args.roles,
        },
      );

      // CHECK RATE LIMIT: Ensure user hasn't exceeded their quota
      const rateLimitResult: { ok: boolean; retryAfter?: number; reason?: string } = await ctx.runMutation(
        internal.leads.enrichment.rateLimitMutations.checkFindyMailRateLimit,
        {
          userId: args.userId,
          apiKey: args.userApiKey,
          count: 1,
        },
      );

      if (!rateLimitResult.ok) {
        const retryAfterMs = rateLimitResult.retryAfter || 60000; // Default to 60s if not provided
        const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ Rate Limit Exceeded - Scheduling Retry",
          {
            leadId: args.leadId,
            reason: rateLimitResult.reason,
            retryAfter: rateLimitResult.retryAfter,
            retryAfterSeconds,
          },
        );

        // Release API key slot before scheduling retry
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "🔓 Released API key slot (rate limited)",
          { leadId: args.leadId, slotIndex: acquiredSlotIndex },
        );

        // Schedule retry after rate limit window expires
        await ctx.scheduler.runAfter(
          retryAfterMs,
          internal.leads.asyncEnrichment.enrichSingleLead,
          args
        );

        return {
          success: false,
          provider: "none",
          reason: "rate_limit_exceeded",
          retrying: true,
          retryAfter: retryAfterMs,
        };
      }

      // PRIMARY PROVIDER: FindyMail (3 retries)
      const { result, pipelineBlockingError } = await tryProvider("findymail", domain, {
        retries: 3,
        roles: args.roles,
        userApiKey: args.userApiKey,
      });

      // PIPELINE-BLOCKING ERROR: Credits exhausted, subscription paused, or auth failed
      // Save checkpoint and propagate error for user action
      if (pipelineBlockingError) {
        logWithCorrelation(
          "error",
          correlation,
          "🚨 [Legacy] Pipeline-blocking error - Saving checkpoint",
          {
            leadId: args.leadId,
            searchId: args.searchId,
            errorCode: pipelineBlockingError.errorCode,
            category: pipelineBlockingError.category,
            userMessage: pipelineBlockingError.userMessage,
          },
        );

        // Save checkpoint for resume capability
        await ctx.runMutation(
          internal.leads.enrichment.checkpoint.createCheckpointFromCurrentState,
          {
            searchId: args.searchId,
            errorCode: pipelineBlockingError.errorCode,
            errorMessage: pipelineBlockingError.userMessage,
          },
        );

        // Mark lead as failed with specific error
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "failed",
            error: `Pipeline blocked: ${pipelineBlockingError.userMessage}`,
          },
        );

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "🔓 Released API key slot (pipeline blocked)",
          { leadId: args.leadId, slotIndex: acquiredSlotIndex },
        );

        // Return with error info
        return {
          success: false,
          provider: "findymail",
          reason: "pipeline_blocked",
          errorCode: pipelineBlockingError.errorCode,
          errorMessage: pipelineBlockingError.userMessage,
          checkpointSaved: true,
        };
      }

      // FINAL RESULT: Update lead based on enrichment outcome
      if (result && result.emails.length > 0) {
        // SUCCESS: Update lead with enrichment data
        await ctx.runMutation(
          internal.leads.internal.updateLeadEnrichment,
          {
            leadId: args.leadId,
            enrichmentData: result,
            status: "completed",
            enrichmentProvider: result.provider,
          },
        );

        // Check for email duplicates
        await ctx.runMutation(
          internal.leads.internal.checkEmailDuplication,
          {
            leadId: args.leadId,
            userId: args.userId,
            searchId: args.searchId,
          },
        );

        const perfData = endPerformanceTracking(performanceTracker);

        logWithCorrelation(
          "info",
          correlation,
          "✅ Lead Enrichment Successful",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            provider: result.provider,
            emailsFound: result.emails.length,
            contactsFound: result.contacts?.length || 0,
            durationMs: perfData?.duration || 0,
          },
        );

        // Track enrichment completion for analytics
        trackEnrichmentCompleted({
          searchId: args.searchId,
          leadId: args.leadId,
          provider: result.provider,
          durationMs: perfData?.duration || 0,
          rolesFound: result.contacts?.length || 0,
          emailFound: result.emails.length > 0,
          retryAttempt: 0,
          apiKeyHash: args.userApiKey ? apiKeyHash : undefined,
        });

        // Update overall search progress
        const allLeads: any = await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          { searchId: args.searchId },
        );

        const enrichedLeads = allLeads.filter(
          (l: any) =>
            l.enrichmentStatus === "completed" ||
            l.enrichmentStatus === "completed_fallback",
        );

        const progressPercent = (enrichedLeads.length / allLeads.length) * 100;

        // Broadcast real-time progress update
        const pendingLeads = allLeads.filter((l: any) => l.enrichmentStatus === "pending");
        const inProgressLeads = allLeads.filter((l: any) => l.enrichmentStatus === "in_progress");
        const failedLeads = allLeads.filter((l: any) => l.enrichmentStatus === "failed");

        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: args.userId,
            searchId: args.searchId,
            stage: "enrichment",
            progress: progressPercent,
            message: `Enriched ${enrichedLeads.length} of ${allLeads.length} leads (${Math.round(progressPercent)}% complete)`,
            data: {
              progress: {
                discovered: allLeads.length,
                enriched: enrichedLeads.length,
                analyzed: 0,
                total: allLeads.length,
              },
              enrichmentBreakdown: {
                pending: pendingLeads.length,
                inProgress: inProgressLeads.length,
                completed: enrichedLeads.filter((l: any) => l.enrichmentStatus === "completed").length,
                completedFallback: enrichedLeads.filter((l: any) => l.enrichmentStatus === "completed_fallback").length,
                failed: failedLeads.length,
                percentComplete: Math.round(progressPercent),
              },
              lastEnrichedLead: {
                businessName: lead.businessName,
                provider: result.provider,
                emailCount: result.emails.length,
                contactCount: result.contacts?.length || 0,
              },
            },
          },
        );

        // CHECK: Atomically try to trigger AI analysis phase (prevents race conditions)
        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId: args.searchId }
        );

        if (shouldTriggerAnalysis) {
          logWithCorrelation(
            "info",
            correlation,
            "🎉 All Enrichment Complete - Triggering AI Analysis Phase (won race)",
            {
              searchId: args.searchId,
              totalLeads: allLeads.length,
              enrichedSuccessfully: enrichedLeads.length,
              enrichedWithFallback: allLeads.filter((l: any) => l.enrichmentStatus === "completed_fallback").length,
              failed: allLeads.filter((l: any) => l.enrichmentStatus === "failed").length,
              nextPhase: "ai_analysis",
              note: "This action won the race to trigger analysis",
            },
          );

          // Trigger AI analysis phase (fire-and-forget)
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: args.searchId }
          );
        } else {
          logWithCorrelation(
            "info",
            correlation,
            "ℹ️ Analysis already triggered by another action",
            {
              searchId: args.searchId,
              note: "Another enrichment action won the race",
            },
          );
        }

        // Release API key slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "🔓 Released API key slot (success)",
          {
            leadId: args.leadId,
            emailsFound: result.emails.length,
            slotIndex: acquiredSlotIndex,
          },
        );

        return {
          success: true,
          provider: result.provider,
          emailsFound: result.emails.length,
        };
      } else {
        // NO EMAILS FOUND - Preserve lead with "no_contacts_found" status
        // This distinguishes between "API succeeded but no results" vs "API error"
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "no_contacts_found",
            error: "FindyMail API succeeded but no discoverable email contacts found for this domain",
          },
        );

        // Update enrichment provider to track that we attempted FindyMail
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentProvider,
          { leadId: args.leadId, provider: "findymail" },
        );

        const perfData = endPerformanceTracking(performanceTracker);

        logWithCorrelation(
          "info",
          correlation,
          "📭 Lead Preserved - No Contacts Found",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            domain,
            triedProviders: ["findymail"],
            durationMs: perfData?.duration || 0,
            note: "Lead preserved with 'no_contacts_found' status for user visibility",
          },
        );

        // Track enrichment completion (not failure - API succeeded)
        trackEnrichmentFailed({
          searchId: args.searchId,
          leadId: args.leadId,
          provider: "findymail",
          durationMs: perfData?.duration || 0,
          errorType: "no_emails_found",
          retryAttempt: 0,
        });

        // Update overall search progress
        const allLeadsForNoContacts: any = await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          { searchId: args.searchId },
        );

        const processedLeadsForNoContacts = allLeadsForNoContacts.filter(
          (l: any) =>
            l.enrichmentStatus === "completed" ||
            l.enrichmentStatus === "completed_fallback" ||
            l.enrichmentStatus === "no_contacts_found",
        );

        const progressPercentNoContacts = (processedLeadsForNoContacts.length / allLeadsForNoContacts.length) * 100;

        // Broadcast real-time progress update
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: args.userId,
            searchId: args.searchId,
            stage: "enrichment",
            progress: progressPercentNoContacts,
            message: `Processed ${processedLeadsForNoContacts.length} of ${allLeadsForNoContacts.length} leads (${Math.round(progressPercentNoContacts)}% complete)`,
            data: {
              progress: {
                discovered: allLeadsForNoContacts.length,
                enriched: processedLeadsForNoContacts.length,
                analyzed: 0,
                total: allLeadsForNoContacts.length,
              },
              lastProcessedLead: {
                businessName: lead.businessName,
                status: "no_contacts_found",
                domain,
              },
            },
          },
        );

        // CHECK: Atomically try to trigger AI analysis phase (prevents race conditions)
        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId: args.searchId }
        );

        if (shouldTriggerAnalysis) {
          logWithCorrelation(
            "info",
            correlation,
            "🎉 All Enrichment Complete - Triggering AI Analysis Phase (won race)",
            {
              searchId: args.searchId,
              nextPhase: "ai_analysis",
              triggeredBy: "no_contacts_found_completion",
              note: "This action won the race to trigger analysis",
            },
          );

          // Trigger AI analysis phase (fire-and-forget)
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: args.searchId }
          );
        } else {
          logWithCorrelation(
            "info",
            correlation,
            "ℹ️ Analysis already triggered by another action",
            {
              searchId: args.searchId,
              note: "Another enrichment action won the race",
            },
          );
        }

        // Release API key slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "🔓 Released API key slot (no contacts found)",
          { leadId: args.leadId, slotIndex: acquiredSlotIndex },
        );

        return {
          success: true,
          provider: "findymail",
          reason: "no_contacts_found",
          emailsFound: 0,
        };
      }
    } catch (error) {
      const perfData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "error",
        correlation,
        "💥 Lead Enrichment Error",
        {
          leadId: args.leadId,
          durationMs: perfData?.duration || 0,
        },
        error as Error,
      );

      // Mark lead as failed
      await ctx.runMutation(
        internal.leads.internal.updateEnrichmentStatus,
        {
          leadId: args.leadId,
          status: "failed",
          error: error instanceof Error ? error.message : "Enrichment failed",
        },
      );

      // Track enrichment failure for analytics
      trackEnrichmentFailed({
        searchId: args.searchId,
        leadId: args.leadId,
        provider: "findymail",
        durationMs: perfData?.duration || 0,
        errorType: error instanceof Error ? error.message : "enrichment_error",
        retryAttempt: 0,
      });

      // CHECK: Atomically try to trigger AI analysis phase (prevents race conditions)
      // (Even if this lead failed, we need to progress the pipeline)
      try {
        const shouldTriggerAnalysis = await ctx.runMutation(
          internal.leads.internal.tryTriggerAnalysisPhase,
          { searchId: args.searchId }
        );

        if (shouldTriggerAnalysis) {
          logWithCorrelation(
            "info",
            correlation,
            "🎉 All Enrichment Complete - Triggering AI Analysis Phase (won race)",
            {
              searchId: args.searchId,
              nextPhase: "ai_analysis",
              triggeredBy: "error_enrichment_completion",
              note: "This action won the race to trigger analysis",
            },
          );

          // Trigger AI analysis phase (fire-and-forget)
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: args.searchId }
          );
        } else {
          logWithCorrelation(
            "info",
            correlation,
            "ℹ️ Analysis already triggered by another action",
            {
              searchId: args.searchId,
              note: "Another enrichment action won the race",
            },
          );
        }
      } catch (checkError) {
        // Don't let analysis trigger failure break the original error handling
        console.error("Failed to check/trigger analysis after enrichment error:", checkError);
      }

      // Release API key slot before throwing error with DLQ fallback
      try {
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        logWithCorrelation(
          "info",
          correlation,
          "🔓 Released API key slot (error)",
          { leadId: args.leadId, slotIndex: acquiredSlotIndex },
        );
      } catch (releaseError) {
        // Don't let slot release failure break error handling
        const releaseErrorMsg = releaseError instanceof Error ? releaseError.message : String(releaseError);
        console.error("Failed to release API key slot after enrichment error:", releaseErrorMsg);

        // Record to DLQ for retry - ensures slot doesn't leak forever
        try {
          await ctx.runMutation(internal.leads.deadLetterQueue.recordFailedOperation, {
            operationType: "slot_release",
            searchId: args.searchId,
            leadId: args.leadId,
            error: `Slot release failed (legacy action): ${releaseErrorMsg}`,
            context: { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
            maxRetries: 3,
          });
        } catch (dlqError) {
          console.error("Failed to record slot release to DLQ:", dlqError);
        }
      }

      throw error;
    }
  },
});
