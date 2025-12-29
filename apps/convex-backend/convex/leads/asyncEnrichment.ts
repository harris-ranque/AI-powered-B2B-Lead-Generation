/**
 * Async Lead Enrichment with Scheduled Actions
 *
 * Uses scheduled actions with staggered delays to process lead enrichment:
 * - ~5 concurrent requests via 200ms staggering (respects FindyMail API limit)
 * - FindyMail primary provider with retry logic
 * - IcyPeas fallback currently disabled (set ICYPEAS_CONFIGURED = true to enable)
 * - Fast processing: ~15-20 minutes for 500 leads
 * - Built-in retry with exponential backoff per provider
 *
 * CRITICAL: Phase Transition Handling with Race Prevention
 * =========================================================
 * Each enrichment action checks if ALL leads are enriched (success, fallback, or failed).
 * The LAST action to complete automatically triggers the AI analysis phase.
 *
 * RACE CONDITION PREVENTION:
 * - Uses atomic Compare-And-Set via tryTriggerAnalysisPhase mutation
 * - Only ONE action wins the race and triggers analyzeLeads
 * - Other actions log that analysis was already triggered
 * - Prevents duplicate LangGraph requests and wasted costs
 *
 * The atomic check happens in 3 places:
 * 1. After successful enrichment (lines ~309-347)
 * 2. After failed enrichment with no emails (lines ~380-415)
 * 3. After exception/error during enrichment (lines ~447-488)
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
  createEnrichmentService,
  EnrichmentProviderFactory,
} from "./enrichment/provider";
import { EnrichmentResult, EnrichmentOptions } from "./enrichment/types";

// IcyPeas fallback is disabled in both prod and dev
// Set to true only when ready to enable fallback provider
const ICYPEAS_CONFIGURED = false;

// Note: Workpool instance is created per-call in enrichLeads action
// This is because we need ctx.runMutation which is only available in action context

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
 * Try enriching a domain with a specific provider
 * Includes retry logic with exponential backoff
 */
async function tryProvider(
  provider: "findymail" | "icypeas",
  domain: string,
  options: {
    retries: number;
    roles?: string[];
    userApiKey?: string;
  }
): Promise<(EnrichmentResult & { provider: "findymail" | "icypeas" }) | null> {
  const service = createEnrichmentService(options.userApiKey, provider);

  for (let attempt = 1; attempt <= options.retries; attempt++) {
    try {
      console.log(`[${provider}] Attempt ${attempt}/${options.retries} for domain: ${domain}`);

      const result = await service.enrichSingle(domain, { roles: options.roles });

      // Check if we got valid emails
      if (result && result.emails && result.emails.length > 0) {
        console.log(`[${provider}] ✅ Success for ${domain}: found ${result.emails.length} emails`);
        return { ...result, provider }; // Tag with provider that worked
      }

      // API succeeded but no emails found - don't retry (wastes credits)
      // The domain simply doesn't have discoverable contacts
      console.log(`[${provider}] ⚠️ No emails found for ${domain} - API succeeded but domain has no discoverable contacts`);
      return null; // Exit immediately, no point retrying
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${provider}] ❌ Error on attempt ${attempt}/${options.retries} for ${domain}: ${errorMsg}`);

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

  return null;
}

/**
 * Enrich a single lead with inline fallback provider support
 *
 * Flow:
 * 1. Try FindyMail (3 retries with exponential backoff)
 * 2. If no emails found, IcyPeas fallback is currently DISABLED
 * 3. Mark as completed_fallback with no emails
 *
 * Each lead has its own 10-minute action timeout
 * IcyPeas fallback can be enabled by setting ICYPEAS_CONFIGURED = true
 */
export const enrichSingleLead = internalAction({
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
          stage: "single_lead_enrichment",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    try {
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
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ Rate Limit Exceeded",
          {
            leadId: args.leadId,
            reason: rateLimitResult.reason,
            retryAfter: rateLimitResult.retryAfter,
          },
        );

        // Mark as failed with rate limit error
        await ctx.runMutation(
          internal.leads.internal.updateEnrichmentStatus,
          {
            leadId: args.leadId,
            status: "failed",
            error: `Rate limit exceeded: ${rateLimitResult.reason}. Retry after ${Math.ceil((rateLimitResult.retryAfter || 60000) / 1000)} seconds.`,
          },
        );

        return {
          success: false,
          provider: "none",
          reason: "rate_limit_exceeded",
          retryAfter: rateLimitResult.retryAfter,
        };
      }

      // PRIMARY PROVIDER: FindyMail (3 retries)
      let result = await tryProvider("findymail", domain, {
        retries: 3,
        roles: args.roles,
        userApiKey: args.userApiKey,
      });

      // FALLBACK PROVIDER: IcyPeas (2 retries)
      if (!result && ICYPEAS_CONFIGURED) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ FindyMail failed, trying IcyPeas fallback",
          {
            leadId: args.leadId,
            domain,
          },
        );

        result = await tryProvider("icypeas", domain, {
          retries: 2,
          roles: args.roles,
          // Note: IcyPeas doesn't support BYOK yet, so no userApiKey
        });
      } else if (!result && !ICYPEAS_CONFIGURED) {
        logWithCorrelation(
          "info",
          correlation,
          "ℹ️ IcyPeas fallback skipped - provider not configured",
          {
            leadId: args.leadId,
            domain,
            note: "ICYPEAS_API_KEY not set in environment",
          },
        );
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
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: args.userId,
            searchId: args.searchId,
            stage: "enrichment",
            progress: progressPercent,
            message: `Enriched ${enrichedLeads.length} of ${allLeads.length} leads`,
            data: {
              progress: {
                discovered: allLeads.length,
                enriched: enrichedLeads.length,
                analyzed: 0,
                total: allLeads.length,
              },
              lastEnrichedLead: {
                businessName: lead.businessName,
                provider: result.provider,
                emailCount: result.emails.length,
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

        return {
          success: true,
          provider: result.provider,
          emailsFound: result.emails.length,
        };
      } else {
        // FAILURE: No emails found from any provider - DELETE the lead
        await ctx.runMutation(
          internal.leads.internal.deleteLead,
          {
            leadId: args.leadId,
          },
        );

        const perfData = endPerformanceTracking(performanceTracker);

        logWithCorrelation(
          "info",
          correlation,
          "🗑️ Lead Deleted - No Contacts Found",
          {
            leadId: args.leadId,
            businessName: lead.businessName,
            domain,
            triedProviders: ["findymail", "icypeas"],
            durationMs: perfData?.duration || 0,
            reason: "No emails or contacts found, lead deleted per user preference",
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
              triggeredBy: "failed_enrichment_completion",
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

        return {
          success: false,
          provider: "none",
          reason: "no_emails_found",
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

      throw error;
    }
  },
});
