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

import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
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
  API_ERROR_CODES,
  type ApiError,
} from "../lib/apiErrors";
import {
  isMultiContactPipelineEnabled,
  isPeopleDiscoveryEnabled,
} from "../lib/featureFlags";
import { resolveEnrichmentRoles } from "../lib/enrichmentRoles";
import {
  resolveEnrichmentRolePatterns,
  resolveExpandedPatternsByRole,
  resolveTitleMatchPatterns,
} from "../lib/roleExpansion";
import {
  collectTitlesNeedingSemanticReview,
} from "../lib/contactAcceptance";
import { normalizeRoleText } from "../lib/roleFamilies";

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

// Helper to detect raw provider candidates before acceptance filtering
function hasRawEnrichmentCandidates(
  result: EnrichmentResult | null | undefined,
): boolean {
  return Boolean(
    result &&
      ((result.emails?.length ?? 0) > 0 || (result.contacts?.length ?? 0) > 0),
  );
}

async function resolveSemanticTitleAcceptance(
  ctx: { runAction: (action: any, args: any) => Promise<any> },
  userId: string,
  requestedRoles: string[],
  enrichmentResult: EnrichmentResult,
  titleMatchPatterns: string[],
): Promise<Set<string>> {
  const rawTitles = (enrichmentResult.contacts ?? [])
    .map((contact) => contact.title?.trim())
    .filter((title): title is string => Boolean(title));

  const needsReview = collectTitlesNeedingSemanticReview(
    rawTitles,
    requestedRoles,
    titleMatchPatterns,
    true,
  );
  if (needsReview.length === 0) {
    return new Set();
  }

  const aiResult = (await ctx.runAction(
    internal.search.roleSemanticMatchActions.batchEvaluateSemanticTitles,
    {
      userId,
      requestedRoles,
      titles: needsReview,
    },
  )) as { acceptedTitles?: string[] };

  return new Set(
    (aiResult.acceptedTitles ?? []).map((title) => normalizeRoleText(title)),
  );
}

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
 * Helper function to check for email duplicates using paginated queries.
 * This avoids the Convex "multiple paginated queries" limitation in mutations.
 *
 * @param ctx - Action context with runQuery and runMutation
 * @param leadId - The lead to check
 * @param userId - The user who owns the lead
 * @param searchId - The search the lead belongs to
 * @returns Object indicating if duplicate was found and handled
 */
async function checkEmailDuplicateWithPagination(
  ctx: {
    runQuery: (fn: any, args: any) => Promise<any>;
    runMutation: (fn: any, args: any) => Promise<any>;
  },
  leadId: string,
  userId: string,
  searchId: string,
): Promise<{ isDuplicate: boolean; duplicateEmail?: string }> {
  // Step 1: Get lead info and check if email dedup is enabled
  const dedupInfo = await ctx.runQuery(
    internal.leads.internal.getLeadEmailDedupInfo,
    { leadId, userId, searchId },
  );

  if (!dedupInfo.shouldCheck || !dedupInfo.primaryEmail) {
    return { isDuplicate: false };
  }

  const primaryEmail = dedupInfo.primaryEmail;

  // Step 2: Paginate through all user leads to find duplicates
  let cursor: string | null = null;
  let isDone = false;
  let duplicateLeadId: string | null = null;

  while (!isDone && !duplicateLeadId) {
    const result: {
      found: boolean;
      duplicateId: string | null;
      continueCursor: string | null;
      isDone: boolean;
    } = await ctx.runQuery(
      internal.leads.internal.checkEmailDuplicatePage,
      {
        userId,
        email: primaryEmail,
        excludeLeadId: leadId,
        cursor: cursor ?? undefined,
        batchSize: 1000,
      },
    );

    if (result.found && result.duplicateId) {
      duplicateLeadId = result.duplicateId;
    } else if (result.isDone) {
      isDone = true;
    } else {
      cursor = result.continueCursor;
    }
  }

  // Step 3: If duplicate found, mark the lead
  if (duplicateLeadId) {
    await ctx.runMutation(
      internal.leads.internal.markLeadAsEmailDuplicate,
      {
        leadId,
        userId,
        searchId,
        duplicateEmail: primaryEmail,
        duplicateLeadId,
      },
    );
    return { isDuplicate: true, duplicateEmail: primaryEmail };
  }

  return { isDuplicate: false };
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
    rolePatterns?: string[];
    rolePatternsByRole?: Record<string, string[]>;
    userApiKey?: string;
  }
): Promise<TryProviderResult> {
  const service = createEnrichmentService(options.userApiKey, provider);
  const multiContact = isMultiContactPipelineEnabled();
  const enrichOptions: EnrichmentOptions = {
    roles: options.roles,
    rolePatterns: options.rolePatterns,
    rolePatternsByRole: options.rolePatternsByRole,
    perRole: multiContact,
    enableRoleExpansion: multiContact,
    limit: multiContact ? 3 : undefined,
  };

  for (let attempt = 1; attempt <= options.retries; attempt++) {
    try {
      console.log(`[${provider}] Attempt ${attempt}/${options.retries} for domain: ${domain}`);

      const result = await service.enrichSingle(domain, enrichOptions);

      const hasCandidates =
        result &&
        ((result.emails && result.emails.length > 0) ||
          (result.contacts && result.contacts.length > 0));

      if (hasCandidates) {
        console.log(
          `[${provider}] ✅ Success for ${domain}: found ${result!.emails?.length ?? 0} emails, ${result!.contacts?.length ?? 0} contacts`,
        );
        return { result: { ...result!, provider } };
      }

      console.log(`[${provider}] ⚠️ No emails found for ${domain} - API succeeded but domain has no discoverable contacts`);
      return { result: null };
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

      let backoffDelay = Math.min(Math.pow(2, attempt) * 1000, 15000);
      if (apiError?.errorCode === API_ERROR_CODES.FINDYMAIL_RATE_LIMITED) {
        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs ??
          apiError.retryAfterMs;
        backoffDelay = retryAfterMs ??
          Math.min(Math.pow(2, attempt) * 3000, 30_000);
      }

      console.log(`[${provider}] ⏳ Backing off ${backoffDelay}ms before retry...`);
      await sleep(backoffDelay);
    }
  }

  return { result: null };
}

type ProspectEmailDiscoveryResult = {
  acceptedCount: number;
  candidateCount: number;
  hadProspects: boolean;
  pipelineBlockingError?: ApiError;
};

/**
 * Email lookup for people-discovery prospects via FindyMail /search/name.
 * Returns null when people discovery is disabled or no prospects exist.
 */
async function tryProspectEmailDiscovery(
  ctx: ActionCtx,
  args: {
    leadId: Id<"leads">;
    searchId: Id<"searches">;
    userId: Id<"users">;
    domain: string;
    requestedRoles: string[];
    companyWebsite?: string;
    userApiKey?: string;
  },
): Promise<ProspectEmailDiscoveryResult | null> {
  if (!isPeopleDiscoveryEnabled()) {
    return null;
  }

  const prospects = await ctx.runQuery(
    internal.leads.peopleDiscoveryInternal.getProspectsForLead,
    { leadId: args.leadId, searchId: args.searchId },
  );

  const pending = prospects.filter(
    (prospect) =>
      prospect.status === "discovered" ||
      prospect.status === "email_pending" ||
      prospect.emailDiscoveryStatus === "pending",
  );

  if (pending.length === 0) {
    return null;
  }

  const service = createEnrichmentService(args.userApiKey, "findymail");
  const prospectPayloads: Array<{
    prospectId: Id<"leadProspects">;
    name: string;
    title: string;
    matchedRole?: string;
    enrichmentResult: EnrichmentResult | { emails: []; contacts: [] };
  }> = [];

  for (const prospect of pending) {
    await ctx.runMutation(
      internal.leads.peopleDiscoveryInternal.updateProspectEmailDiscoveryStatus,
      {
        prospectId: prospect._id,
        emailDiscoveryStatus: "in_progress",
        status: "email_pending",
      },
    );

    try {
      const nameResult = await service.enrichByName(args.domain, prospect.name);
      prospectPayloads.push({
        prospectId: prospect._id,
        name: prospect.name,
        title: prospect.title,
        matchedRole: prospect.matchedRole,
        enrichmentResult: nameResult ?? { emails: [], contacts: [] },
      });
    } catch (error) {
      const apiError = (error as { apiError?: ApiError }).apiError;
      if (apiError && shouldBlockPipeline(apiError)) {
        return {
          acceptedCount: 0,
          candidateCount: pending.length,
          hadProspects: true,
          pipelineBlockingError: apiError,
        };
      }
      prospectPayloads.push({
        prospectId: prospect._id,
        name: prospect.name,
        title: prospect.title,
        matchedRole: prospect.matchedRole,
        enrichmentResult: { emails: [], contacts: [] },
      });
    }

    await sleep(500);
  }

  const processResult = await ctx.runMutation(
    internal.leads.contactInternal.processProspectEmailEnrichment,
    {
      leadId: args.leadId,
      searchId: args.searchId,
      userId: args.userId,
      requestedRoles: args.requestedRoles,
      companyWebsite: args.companyWebsite,
      prospects: prospectPayloads,
    },
  );

  return {
    acceptedCount: processResult.acceptedCount,
    candidateCount: processResult.candidateCount,
    hadProspects: true,
  };
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
// Return type for enrichSingleLeadWorkpool - breaks TypeScript circular reference
type EnrichmentWorkpoolResult = {
  success: boolean;
  skipped?: boolean;
  provider?: string;
  reason?: string;
  errorCode?: string;
  errorMessage?: string;
  checkpointSaved?: boolean;
  emailsFound?: number;
  queueDepth?: number; // Present when lead was queued for later processing
};

// Enrichment checkpoint type - matches schema definition
type EnrichmentCheckpoint = {
  lastProcessedIndex: number;
  totalLeads: number;
  enrichedCount: number;
  noContactsCount: number;
  failedCount: number;
  errorCode?: string;
  errorMessage?: string;
  checkpointedAt: number;
  resumable: boolean;
} | null;

export const enrichSingleLeadWorkpool = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    roles: v.optional(v.array(v.string())),
    userApiKey: v.optional(v.string()),
    reenrichForSearch: v.optional(v.boolean()),
    // Queue-based retry fields (set when triggered from slot queue)
    _fromQueue: v.optional(v.boolean()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EnrichmentWorkpoolResult> => {
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

    const completeReenrichLink = async (failed = false) => {
      if (!args.reenrichForSearch) {
        return;
      }
      await ctx.runMutation(
        internal.leads.searchLinkedLeads.markSearchLinkedLeadEnriched,
        {
          searchId: args.searchId,
          leadId: args.leadId,
          failed,
        },
      );
    };

    const updateLeadEnrichmentStatus = async (params: {
      status: string;
      error?: string;
      enrichmentStartedAt?: number;
    }) => {
      if (args.reenrichForSearch) {
        return;
      }
      await ctx.runMutation(
        internal.leads.internal.updateEnrichmentStatus,
        {
          leadId: args.leadId,
          ...params,
        },
      );
    };

    // CHECK: Skip if search is already paused due to pipeline-blocking error
    // This prevents all workpool items from hitting the same error (e.g., credits exhausted)
    const existingCheckpoint: EnrichmentCheckpoint = await ctx.runQuery(
      internal.leads.enrichment.checkpoint.getCheckpoint,
      { searchId: args.searchId }
    );

    if (existingCheckpoint?.errorCode && existingCheckpoint.resumable) {
      // Search is paused with a pipeline-blocking error - skip this lead
      // IMPORTANT: Do NOT mark lead as "failed" - leave as "pending" so resume logic works
      // The checkpoint already captures the error state; marking as failed would prevent
      // proper resume since monitoring/resume queries check for pending leads
      logWithCorrelation(
        "info",
        correlation,
        "⏸️ [Workpool] Search paused - skipping lead (user action required)",
        {
          leadId: args.leadId,
          searchId: args.searchId,
          errorCode: existingCheckpoint.errorCode,
          errorMessage: existingCheckpoint.errorMessage,
        },
      );

      // Return early without changing status - lead stays "pending" for resume
      return {
        success: false,
        skipped: true,
        reason: "search_paused",
        errorCode: existingCheckpoint.errorCode,
      };
    }

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

    // Try to acquire slot - if not available, queue for later processing
    const slotResult = await ctx.runMutation(
      internal.apiKeySemaphore.semaphore.tryAcquireApiKeySlot,
      { apiKeyHash, claimId },
    );

    if (!slotResult.acquired) {
      // API key at capacity - queue lead using OCC-safe lead-based queue
      // The single-consumer cron (enrichmentQueueProcessor) will process queued leads
      logWithCorrelation(
        "info",
        correlation,
        "📥 [Workpool] API key at capacity - queuing lead for cron processing",
        {
          leadId: args.leadId,
          currentActive: slotResult.currentActive,
          fromQueue: args._fromQueue,
        },
      );

      // Get search createdAt for FIFO ordering
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        { searchId: args.searchId },
      );
      const searchQueuedAt = search?.createdAt || Date.now();

      if (args._fromQueue || args.reenrichForSearch) {
        const lead = await ctx.runQuery(
          internal.leads.internal.getLeadInternal,
          { leadId: args.leadId },
        );

        const queuedApiKeyHash = lead?.enrichmentApiKeyHash || apiKeyHash;

        await ctx.runMutation(
          internal.leads.internal.requeueLeadForEnrichment,
          {
            leadId: args.leadId,
            searchId: args.searchId,
            apiKeyHash: queuedApiKeyHash,
            searchQueuedAt,
            reenrichForSearch: args.reenrichForSearch,
          },
        );

        return {
          success: true,
          skipped: true,
          reason: "requeued",
        };
      }

      const queueResult = await ctx.runMutation(
        internal.leads.internal.queueLeadForEnrichment,
        {
          leadId: args.leadId,
          searchId: args.searchId,
          apiKeyHash,
          searchQueuedAt,
          reenrichForSearch: false,
        },
      );

      if (!queueResult.queued) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ [Workpool] Failed to queue lead for enrichment — will retry via workpool",
          {
            leadId: args.leadId,
            reason: queueResult.reason,
          },
        );
        return {
          success: false,
          retrying: true,
          reason: "queue_failed",
          queueReason: queueResult.reason,
        };
      }

      // Return success with queued flag - tells Workpool this job is "done"
      // The single-consumer cron (enrichmentQueueProcessor) will process it
      return {
        success: true,
        skipped: true,
        reason: "queued",
      };
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

    // NOTE: Circuit breaker disabled - all leads will attempt enrichment regardless of failure rate
    // The circuit breaker was causing pipeline stalls when failure rates were high but expected
    // (e.g., many domains without discoverable emails). If re-enabling, ensure failed leads
    // are marked with a terminal status so the pipeline can advance to analysis.

    // Mark lead as in_progress with timestamp for stuck detection
    await updateLeadEnrichmentStatus({
      status: "in_progress",
      enrichmentStartedAt: Date.now(),
    });

    try {
      // Check if enrichment is paused for this search
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        { searchId: args.searchId },
      );

      if (!search) {
        throw new Error(`Search ${args.searchId} not found`);
      }

      const requestedRoles = resolveEnrichmentRoles(args.roles, search.parameters);
      const enrichmentRolePatterns = resolveEnrichmentRolePatterns(
        requestedRoles,
        search.parameters,
      );
      const enrichmentRolePatternsByRole = resolveExpandedPatternsByRole(
        requestedRoles,
        search.parameters,
      );
      const titleMatchPatterns = resolveTitleMatchPatterns(
        requestedRoles,
        search.parameters,
      );

      if (search.enrichmentPaused) {
        // Release slot and skip
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        // If this lead came from the queue, report completion to batch tracker
        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: false },
          );
        }

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
        !args.reenrichForSearch &&
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

        // Check for email duplicates using paginated queries (handles >5000 leads)
        await checkEmailDuplicateWithPagination(
          ctx,
          args.leadId,
          args.userId,
          args.searchId,
        );

        // Release slot before returning
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        // If this lead came from the queue, report completion to batch tracker
        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: true },
          );
        }

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

        await updateLeadEnrichmentStatus({
          status: "completed_fallback",
          error: "No valid domain available",
        });
        await completeReenrichLink(true);

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        // If this lead came from the queue, report completion to batch tracker
        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: false },
          );
        }

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

      let pipelineBlockingError: ApiError | undefined;

      const prospectAttempt = await tryProspectEmailDiscovery(ctx, {
        leadId: args.leadId,
        searchId: args.searchId,
        userId: args.userId,
        domain,
        requestedRoles,
        companyWebsite: lead.website,
        userApiKey: args.userApiKey,
      });

      if (prospectAttempt?.pipelineBlockingError) {
        pipelineBlockingError = prospectAttempt.pipelineBlockingError;
      } else if (prospectAttempt?.hadProspects) {
        if (prospectAttempt.acceptedCount > 0) {
          await checkEmailDuplicateWithPagination(
            ctx,
            args.leadId,
            args.userId,
            args.searchId,
          );

          const perfData = endPerformanceTracking(performanceTracker);
          logWithCorrelation(
            "info",
            correlation,
            "✅ [Workpool] Prospect email discovery successful",
            {
              leadId: args.leadId,
              acceptedCount: prospectAttempt.acceptedCount,
            },
          );

          trackEnrichmentCompleted({
            searchId: args.searchId,
            leadId: args.leadId,
            provider: "findymail",
            durationMs: perfData?.duration || 0,
            rolesFound: prospectAttempt.acceptedCount,
            emailFound: true,
            retryAttempt: 0,
            apiKeyHash: args.userApiKey ? apiKeyHash : undefined,
          });

          await ctx.runMutation(
            internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
            { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
          );

          if (args._fromQueue) {
            await ctx.runMutation(
              internal.leads.workpool.reportQueuedLeadCompletion,
              { searchId: args.searchId, leadId: args.leadId, success: true },
            );
          }

          await completeReenrichLink(false);

          return {
            success: true,
            provider: "findymail",
            emailsFound: prospectAttempt.acceptedCount,
            acceptedCount: prospectAttempt.acceptedCount,
            source: "prospect_name_search",
          };
        }

        logWithCorrelation(
          "info",
          correlation,
          "[Workpool] Prospect name search found no accepted emails — falling back to role/domain search",
          {
            leadId: args.leadId,
            candidateCount: prospectAttempt.candidateCount,
          },
        );
      }

      // FindyMail role/domain search (no prospects, or hybrid fallback after prospect name search)
      let result: (EnrichmentResult & { provider: "findymail" }) | null = null;

      if (isMultiContactPipelineEnabled()) {
        const cacheEntry = await ctx.runQuery(
          internal.leads.contactInternal.getEnrichmentCacheEntry,
          { searchId: args.searchId, domain },
        );
        const cacheValid =
          cacheEntry &&
          cacheEntry.expiresAt > Date.now() &&
          cacheEntry.enrichmentData;

        if (cacheValid) {
          result = {
            ...(cacheEntry.enrichmentData as EnrichmentResult),
            provider: "findymail",
          };
        } else {
          const providerAttempt = await tryProvider("findymail", domain, {
            retries: 3,
            roles: requestedRoles,
            rolePatterns: enrichmentRolePatterns,
            rolePatternsByRole: enrichmentRolePatternsByRole,
            userApiKey: args.userApiKey,
          });
          result = providerAttempt.result;
          pipelineBlockingError = providerAttempt.pipelineBlockingError;

          if (result) {
            await ctx.runMutation(internal.leads.contactInternal.cacheEnrichmentData, {
              searchId: args.searchId,
              domain,
              enrichmentData: result,
            });
          }
        }
      } else {
        const providerAttempt = await tryProvider("findymail", domain, {
          retries: 3,
          roles: requestedRoles,
          rolePatterns: enrichmentRolePatterns,
          rolePatternsByRole: enrichmentRolePatternsByRole,
          userApiKey: args.userApiKey,
        });
        result = providerAttempt.result;
        pipelineBlockingError = providerAttempt.pipelineBlockingError;
      }

      // PIPELINE-BLOCKING ERROR handling uses pipelineBlockingError from above
      if (pipelineBlockingError) {
        logWithCorrelation(
          "error",
          correlation,
          "🚨 [Workpool] Pipeline-blocking error - Saving checkpoint & notifying user",
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

        // Broadcast critical notification to user
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcast,
          {
            userId: args.userId,
            type: "pipeline_blocked",
            title: "Email Enrichment Paused",
            message: pipelineBlockingError.userMessage || "Enrichment has been paused due to an issue that requires your attention.",
            data: {
              searchId: args.searchId,
              errorCode: pipelineBlockingError.errorCode,
              category: pipelineBlockingError.category,
              actionRequired: pipelineBlockingError.suggestedAction,
              actionUrl: pipelineBlockingError.actionUrl,
            },
            priority: "critical",
            category: "enrichment_error",
            entityType: "search",
            entityId: args.searchId,
            requiresAck: true,
            tags: ["enrichment", "blocked", pipelineBlockingError.category],
          },
        );

        // Mark lead as failed with specific error
        await updateLeadEnrichmentStatus({
          status: "failed",
          error: `Pipeline blocked: ${pipelineBlockingError.userMessage}`,
        });

        // Release slot
        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        // If this lead came from the queue, report completion to batch tracker
        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: false },
          );
        }

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

      // RESULT HANDLING — success requires accepted contacts, not raw provider emails
      const hasRawCandidates = hasRawEnrichmentCandidates(result);

      if (hasRawCandidates && isMultiContactPipelineEnabled()) {
        const semanticTitleAccepted = await resolveSemanticTitleAcceptance(
          ctx,
          args.userId,
          requestedRoles,
          result!,
          titleMatchPatterns,
        );

        const processResult = await ctx.runMutation(
          internal.leads.contactInternal.processMultiContactEnrichment,
          {
            leadId: args.leadId,
            searchId: args.searchId,
            userId: args.userId,
            requestedRoles,
            companyWebsite: lead.website,
            enrichmentResult: result,
            enableRoleExpansion: true,
            roleMatchPatterns: titleMatchPatterns,
            semanticTitleAccepted: Array.from(semanticTitleAccepted),
          },
        );

        if (processResult.acceptedCount > 0) {
          await checkEmailDuplicateWithPagination(
            ctx,
            args.leadId,
            args.userId,
            args.searchId,
          );

          const perfData = endPerformanceTracking(performanceTracker);
          logWithCorrelation(
            "info",
            correlation,
            "✅ [Workpool] Multi-contact enrichment successful",
            {
              leadId: args.leadId,
              acceptedCount: processResult.acceptedCount,
              candidateCount: processResult.candidateCount,
            },
          );

          trackEnrichmentCompleted({
            searchId: args.searchId,
            leadId: args.leadId,
            provider: "findymail",
            durationMs: perfData?.duration || 0,
            rolesFound: processResult.acceptedCount,
            emailFound: true,
            retryAttempt: 0,
            apiKeyHash: args.userApiKey ? apiKeyHash : undefined,
          });

          await ctx.runMutation(
            internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
            { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
          );

          if (args._fromQueue) {
            await ctx.runMutation(
              internal.leads.workpool.reportQueuedLeadCompletion,
              { searchId: args.searchId, leadId: args.leadId, success: true },
            );
          }

          await completeReenrichLink(false);

          return {
            success: true,
            provider: "findymail",
            emailsFound: processResult.acceptedCount,
          };
        }

        await updateLeadEnrichmentStatus({
          status: "no_contacts_found",
          error:
            "Contacts found but none passed role/domain/verification acceptance",
        });
        await completeReenrichLink(true);

        await ctx.runMutation(
          internal.apiKeySemaphore.semaphore.releaseApiKeySlot,
          { apiKeyHash, claimId: acquiredClaimId, slotIndex: acquiredSlotIndex },
        );

        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: false },
          );
        }

        return { success: false, provider: "findymail", reason: "no_accepted_contacts" };
      }

      {
        // No accepted contacts (API returned nothing or candidates failed acceptance)
        // This distinguishes between "API succeeded but no results" vs "API error"
        await updateLeadEnrichmentStatus({
          status: "no_contacts_found",
          error:
            "FindyMail API succeeded but no discoverable email contacts found for this domain",
        });

        if (!args.reenrichForSearch) {
          await ctx.runMutation(
            internal.leads.internal.updateEnrichmentProvider,
            { leadId: args.leadId, provider: "findymail" },
          );
        }

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

        // If this lead came from the queue, report completion to batch tracker
        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: false },
          );
        }

        await completeReenrichLink(true);

        return { success: false, provider: "findymail", reason: "no_contacts_found", emailsFound: 0 };
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
      await updateLeadEnrichmentStatus({
        status: "failed",
        error: error instanceof Error ? error.message : "Enrichment failed",
      });
      await completeReenrichLink(true);

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
        // If this lead came from the queue, report completion (as failed)
        if (args._fromQueue) {
          await ctx.runMutation(
            internal.leads.workpool.reportQueuedLeadCompletion,
            { searchId: args.searchId, leadId: args.leadId, success: false },
          );
        }
        return { success: false, provider: "none", reason: errorMsg };
      }

      // For retryable errors, if from queue, report as failed
      // The workpool will handle retrying if this was a direct workpool call
      if (args._fromQueue) {
        await ctx.runMutation(
          internal.leads.workpool.reportQueuedLeadCompletion,
          { searchId: args.searchId, leadId: args.leadId, success: false },
        );
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
// Return type for resumeEnrichmentFromCheckpoint
type ResumeEnrichmentResult = {
  success: boolean;
  resumed?: boolean;
  reason?: string;
  pendingLeads?: number;
  message?: string;
};

// Type for search enrichment status query result
type SearchEnrichmentStatus = {
  totalLeads: number;
  enrichedCount: number;
  allLeadsEnriched: boolean;
  statusCounts: {
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    no_contacts_found: number;
    completed_fallback: number;
  };
} | null;

export const resumeEnrichmentFromCheckpoint = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args): Promise<ResumeEnrichmentResult> => {
    const { searchId } = args;

    console.log(`[Resume Enrichment] Starting resume for search ${searchId}`);

    // Get checkpoint info if available - explicit type to break circular ref
    const checkpoint: EnrichmentCheckpoint = await ctx.runQuery(
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

    // Get current search status - explicit type to break circular ref
    const searchStatus: SearchEnrichmentStatus = await ctx.runQuery(
      internal.leads.internal.getSearchEnrichmentStatus,
      { searchId }
    );

    if (!searchStatus) {
      console.log(`[Resume Enrichment] Search ${searchId} not found`);
      return { success: false, reason: "search_not_found" };
    }

    const pendingCount: number = searchStatus.statusCounts.pending;
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
 * 2. Success only when at least one contact passes acceptance; otherwise no_contacts_found
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

    const searchForRoles = await ctx.runQuery(
      internal.search.internal.getSearchInternal,
      { searchId: args.searchId },
    );
    const requestedRoles = resolveEnrichmentRoles(
      args.roles,
      searchForRoles?.parameters,
    );
    const enrichmentRolePatterns = resolveEnrichmentRolePatterns(
      requestedRoles,
      searchForRoles?.parameters,
    );
    const enrichmentRolePatternsByRole = resolveExpandedPatternsByRole(
      requestedRoles,
      searchForRoles?.parameters,
    );
    const titleMatchPatterns = resolveTitleMatchPatterns(
      requestedRoles,
      searchForRoles?.parameters,
    );

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
          roles: requestedRoles,
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

        // Check for email duplicates using paginated queries (handles >5000 leads)
        await checkEmailDuplicateWithPagination(
          ctx,
          args.leadId,
          args.userId,
          args.searchId,
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
          roles: requestedRoles,
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
        roles: requestedRoles,
        rolePatterns: enrichmentRolePatterns,
        rolePatternsByRole: enrichmentRolePatternsByRole,
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

      // FINAL RESULT — success requires accepted contacts, not raw provider emails
      const hasRawCandidates = hasRawEnrichmentCandidates(result);
      let acceptedCount = 0;

      if (hasRawCandidates && isMultiContactPipelineEnabled()) {
        const semanticTitleAccepted = await resolveSemanticTitleAcceptance(
          ctx,
          args.userId,
          requestedRoles,
          result!,
          titleMatchPatterns,
        );

        const processResult = await ctx.runMutation(
          internal.leads.contactInternal.processMultiContactEnrichment,
          {
            leadId: args.leadId,
            searchId: args.searchId,
            userId: args.userId,
            requestedRoles,
            companyWebsite: lead.website,
            enrichmentResult: result,
            enableRoleExpansion: true,
            roleMatchPatterns: titleMatchPatterns,
            semanticTitleAccepted: Array.from(semanticTitleAccepted),
          },
        );
        acceptedCount = processResult.acceptedCount;

        if (acceptedCount > 0) {
          await checkEmailDuplicateWithPagination(
            ctx,
            args.leadId,
            args.userId,
            args.searchId,
          );

          const perfData = endPerformanceTracking(performanceTracker);

          logWithCorrelation(
            "info",
            correlation,
            "✅ Lead Enrichment Successful",
            {
              leadId: args.leadId,
              businessName: lead.businessName,
              provider: "findymail",
              acceptedCount,
              candidateCount: processResult.candidateCount,
              durationMs: perfData?.duration || 0,
            },
          );

          trackEnrichmentCompleted({
            searchId: args.searchId,
            leadId: args.leadId,
            provider: "findymail",
            durationMs: perfData?.duration || 0,
            rolesFound: acceptedCount,
            emailFound: true,
            retryAttempt: 0,
            apiKeyHash: args.userApiKey ? apiKeyHash : undefined,
          });

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
                  provider: "findymail",
                  emailCount: acceptedCount,
                  contactCount: acceptedCount,
                },
              },
            },
          );

          const shouldTriggerAnalysis = await ctx.runMutation(
            internal.leads.internal.tryTriggerAnalysisPhase,
            { searchId: args.searchId },
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

            try {
              await ctx.scheduler.runAfter(
                0,
                (internal as any)["leads/actions"].analyzeLeads,
                { searchId: args.searchId },
              );
            } catch (scheduleError) {
              const scheduleErrorMsg =
                scheduleError instanceof Error
                  ? scheduleError.message
                  : String(scheduleError);
              logWithCorrelation(
                "error",
                correlation,
                "❌ Failed to schedule analysis after enrichment complete",
                {
                  searchId: args.searchId,
                  error: scheduleErrorMsg,
                },
              );
              await ctx.runMutation(
                internal.leads.deadLetterQueue.recordFailedOperation,
                {
                  operationType: "analysis_trigger",
                  searchId: args.searchId,
                  error: `Analysis scheduling failed after enrichment: ${scheduleErrorMsg}`,
                  context: { leadId: args.leadId, triggeredBy: "enrich_single_lead" },
                  maxRetries: 5,
                },
              );
            }
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
              acceptedCount,
              slotIndex: acquiredSlotIndex,
            },
          );

          return {
            success: true,
            provider: "findymail",
            emailsFound: acceptedCount,
          };
        }
      }

      const noContactsReason = hasRawCandidates
        ? "no_accepted_contacts"
        : "no_contacts_found";

      if (!hasRawCandidates) {
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "no_contacts_found",
            error: "FindyMail API succeeded but no discoverable email contacts found for this domain",
          },
        );

        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentProvider,
          { leadId: args.leadId, provider: "findymail" },
        );
      }

      const perfData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "info",
        correlation,
        hasRawCandidates
          ? "📭 Lead Preserved - No Accepted Contacts"
          : "📭 Lead Preserved - No Contacts Found",
        {
          leadId: args.leadId,
          businessName: lead.businessName,
          domain,
          reason: noContactsReason,
          durationMs: perfData?.duration || 0,
          note: "Lead preserved with 'no_contacts_found' status for user visibility",
        },
      );

      trackEnrichmentFailed({
        searchId: args.searchId,
        leadId: args.leadId,
        provider: "findymail",
        durationMs: perfData?.duration || 0,
        errorType: hasRawCandidates ? "no_accepted_contacts" : "no_emails_found",
        retryAttempt: 0,
      });

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

      const progressPercentNoContacts =
        (processedLeadsForNoContacts.length / allLeadsForNoContacts.length) * 100;

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
              enriched: processedLeadsForNoContacts.filter(
                (l: any) =>
                  l.enrichmentStatus === "completed" ||
                  l.enrichmentStatus === "completed_fallback",
              ).length,
              analyzed: 0,
              total: allLeadsForNoContacts.length,
            },
            enrichmentBreakdown: {
              pending: allLeadsForNoContacts.filter((l: any) => l.enrichmentStatus === "pending").length,
              inProgress: allLeadsForNoContacts.filter((l: any) => l.enrichmentStatus === "in_progress").length,
              completed: allLeadsForNoContacts.filter((l: any) => l.enrichmentStatus === "completed").length,
              completedFallback: allLeadsForNoContacts.filter((l: any) => l.enrichmentStatus === "completed_fallback").length,
              noContactsFound: allLeadsForNoContacts.filter((l: any) => l.enrichmentStatus === "no_contacts_found").length,
              failed: allLeadsForNoContacts.filter((l: any) => l.enrichmentStatus === "failed").length,
              percentComplete: Math.round(progressPercentNoContacts),
            },
            lastProcessedLead: {
              businessName: lead.businessName,
              status: "no_contacts_found",
              reason: noContactsReason,
            },
          },
        },
      );

      const shouldTriggerAnalysis = await ctx.runMutation(
        internal.leads.internal.tryTriggerAnalysisPhase,
        { searchId: args.searchId },
      );

      if (shouldTriggerAnalysis) {
        logWithCorrelation(
          "info",
          correlation,
          "🎉 All Enrichment Complete - Triggering AI Analysis Phase (won race)",
          {
            searchId: args.searchId,
            nextPhase: "ai_analysis",
            triggeredBy: noContactsReason,
            note: "This action won the race to trigger analysis",
          },
        );

        try {
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: args.searchId },
          );
        } catch (scheduleError) {
          const scheduleErrorMsg =
            scheduleError instanceof Error
              ? scheduleError.message
              : String(scheduleError);
          logWithCorrelation(
            "error",
            correlation,
            "❌ Failed to schedule analysis after enrichment complete (no contacts path)",
            {
              searchId: args.searchId,
              error: scheduleErrorMsg,
            },
          );
          await ctx.runMutation(
            internal.leads.deadLetterQueue.recordFailedOperation,
            {
              operationType: "analysis_trigger",
              searchId: args.searchId,
              error: `Analysis scheduling failed after enrichment: ${scheduleErrorMsg}`,
              context: {
                leadId: args.leadId,
                triggeredBy: "enrich_single_lead_no_contacts",
              },
              maxRetries: 5,
            },
          );
        }
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
        success: false,
        provider: "findymail",
        reason: noContactsReason,
        emailsFound: 0,
      };
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
