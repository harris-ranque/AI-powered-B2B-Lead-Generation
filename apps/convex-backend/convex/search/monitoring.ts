/**
 * Search Completion Monitoring
 *
 * Periodically checks searches stuck in processing state and finalizes them
 * once all eligible leads have finished async analysis.
 */

import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  createCorrelationContext,
  logWithCorrelation,
  OPERATION_TYPES,
} from "../lib/correlation";
import { Doc, Id } from "../_generated/dataModel";
import {
  ANALYSIS_RECOVERY_GRACE_MS,
  hasPendingEnrichment,
  isAllEnrichmentTerminal,
} from "../lib/searchAnalysisRecovery";

type CorrelationContext = ReturnType<typeof createCorrelationContext>;

/**
 * Schedule Write Emails when enrichment finished but analyzeLeads never ran.
 */
async function triggerAnalysisRecovery(
  ctx: ActionCtx,
  correlation: CorrelationContext,
  searchId: Id<"searches">,
  logContext: Record<string, unknown>,
): Promise<boolean> {
  const shouldTrigger = await ctx.runMutation(
    internal.leads.internal.tryTriggerAnalysisPhase,
    { searchId },
  );

  if (shouldTrigger) {
    await ctx.scheduler.runAfter(
      0,
      (internal as any)["leads/actions"].analyzeLeads,
      { searchId },
    );
    logWithCorrelation(
      "info",
      correlation,
      "🔄 Analysis recovery: scheduled via tryTriggerAnalysisPhase",
      { searchId, ...logContext },
    );
    return true;
  }

  const evaluation = await ctx.runQuery(
    internal.leads.internal.evaluateAnalysisRecoveryNeed,
    { searchId },
  );

  if (!evaluation.shouldScheduleDirect) {
    return false;
  }

  await ctx.runMutation(internal.search.internal.reopenSearchForAnalysisRecovery, {
    searchId,
  });

  await ctx.scheduler.runAfter(
    0,
    (internal as any)["leads/actions"].analyzeLeads,
    { searchId },
  );

  logWithCorrelation(
    "info",
    correlation,
    "🔄 Analysis recovery: direct analyzeLeads schedule",
    {
      searchId,
      reason: evaluation.reason,
      pending: evaluation.pending,
      total: evaluation.total,
      ...logContext,
    },
  );

  return true;
}

export const checkPendingCompletions: any = internalAction({
  args: {},
  handler: async (ctx) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.MONITORING,
      "system",
      {
        metadata: {
          monitorType: "search_completion",
        },
      },
    );

    logWithCorrelation(
      "info",
      correlation,
      "🔍 Checking for searches ready to complete",
      {},
    );

    const statusesToCheck: Array<"processing" | "in_progress"> = [
      "processing",
      "in_progress",
    ];

    const candidateSearches = (await ctx.runQuery(
      internal.search.internal.getSearchesByStatusesInternal,
      {
        statuses: statusesToCheck,
      },
    )) as Doc<"searches">[];

    if (candidateSearches.length === 0) {
      logWithCorrelation(
        "info",
        correlation,
        "✅ No in-progress searches require completion",
        {},
      );
      return { success: true, searchesChecked: 0, completionsScheduled: 0 };
    }

    let completionsScheduled = 0;
    let searchesEvaluated = 0;

    for (const search of candidateSearches) {
      // Skip searches with active checkpoint error - they're paused waiting for user action
      const checkpoint = search.enrichmentCheckpoint;
      if (checkpoint?.errorCode && checkpoint.resumable) {
        continue;
      }

      const readiness = await ctx.runQuery(
        internal.search.internal.getSearchCompletionReadinessInternal,
        { searchId: search._id as Id<"searches"> },
      );

      if (!readiness.ready) {
        continue;
      }

      searchesEvaluated++;
      completionsScheduled++;

      logWithCorrelation(
        "info",
        correlation,
        "🏁 Write Emails complete - scheduling search completion",
        {
          searchId: search._id,
          reason: readiness.reason,
          total: readiness.total,
        },
      );

      await ctx.scheduler.runAfter(0, "search/actions:completeSearch" as any, {
        searchId: search._id as any,
      });
    }

    logWithCorrelation(
      "info",
      correlation,
      "✅ Search completion monitoring cycle finished",
      {
        searchesChecked: candidateSearches.length,
        searchesEvaluated,
        completionsScheduled,
      },
    );

    return {
      success: true,
      searchesChecked: candidateSearches.length,
      searchesEvaluated,
      completionsScheduled,
    };
  },
});

/**
 * Detect and recover stuck searches
 *
 * Phase timeouts:
 * - Discovery (in_progress): 15 minutes
 * - Enrichment/Analysis (processing): 120 minutes
 */
export const recoverStuckSearches: any = internalAction({
  args: {},
  handler: async (ctx) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.MONITORING,
      "system",
      {
        metadata: {
          monitorType: "stuck_search_recovery",
        },
      },
    );

    logWithCorrelation(
      "info",
      correlation,
      "🔍 Checking for stuck searches",
      {},
    );

    const now = Date.now();
    const DISCOVERY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    const PROCESSING_TIMEOUT_MS = 120 * 60 * 1000; // 120 minutes

    // Get searches in in_progress or processing state
    const statusesToCheck: Array<"processing" | "in_progress"> = [
      "processing",
      "in_progress",
    ];

    const candidateSearches = (await ctx.runQuery(
      internal.search.internal.getSearchesByStatusesInternal,
      {
        statuses: statusesToCheck,
      },
    )) as Doc<"searches">[];

    let recoveredCount = 0;

    for (const search of candidateSearches) {
      // Skip searches with active checkpoint error - they're paused waiting for user action
      // Don't mark them as failed/stuck since user needs to resolve the issue first
      const checkpoint = search.enrichmentCheckpoint;
      if (checkpoint?.errorCode && checkpoint.resumable) {
        logWithCorrelation(
          "info",
          correlation,
          "⏸️ Search paused with checkpoint error - skipping recovery",
          {
            searchId: search._id,
            errorCode: checkpoint.errorCode,
          },
        );
        continue;
      }

      const startedAt = search.startedAt || search.createdAt;
      const age = now - startedAt;

      // Check if stuck in discovery phase
      if (search.status === "in_progress" && age > DISCOVERY_TIMEOUT_MS) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ Search stuck in discovery phase - marking as failed",
          {
            searchId: search._id,
            ageMinutes: Math.floor(age / 60000),
            status: search.status,
          },
        );

        await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
          searchId: search._id as any,
          status: "failed" as const,
          error: `Search timed out during discovery phase (exceeded ${Math.floor(DISCOVERY_TIMEOUT_MS / 60000)} minutes)`,
        });

        recoveredCount++;
        continue;
      }

      // Recover missed Write Emails trigger (enrichment done, analysis never started)
      if (
        (search.status === "processing" || search.status === "failed") &&
        age >= ANALYSIS_RECOVERY_GRACE_MS
      ) {
        const leadsForRecovery = (await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          { searchId: search._id as any },
        )) as Doc<"leads">[];

        if (
          isAllEnrichmentTerminal(leadsForRecovery) &&
          !hasPendingEnrichment(leadsForRecovery)
        ) {
          const analysisRecovered = await triggerAnalysisRecovery(
            ctx,
            correlation,
            search._id,
            { ageMinutes: Math.floor(age / 60000), phase: "stuck_search_recovery" },
          );
          if (analysisRecovered) {
            recoveredCount++;
            continue;
          }
        }
      }

      // Check if stuck in processing phase
      if (search.status === "processing" && age > PROCESSING_TIMEOUT_MS) {
        // Get leads to see what phase we're stuck in
        const leads = (await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          {
            searchId: search._id as any,
          },
        )) as Doc<"leads">[];

        const pendingEnrichment = leads.filter(
          (l) => l.enrichmentStatus === "pending" || l.enrichmentStatus === "in_progress"
        );
        const failedEnrichment = leads.filter(
          (l) => l.enrichmentStatus === "failed"
        );
        const pendingAnalysis = leads.filter(
          (l) => l.analysisStatus === "pending" || l.analysisStatus === "scheduled" || l.analysisStatus === "processing"
        );

        if (pendingEnrichment.length > 0 || failedEnrichment.length > 0 || pendingAnalysis.length > 0) {
          // Last-chance recovery: enrichment finished but Write Emails never started
          if (
            pendingEnrichment.length === 0 &&
            failedEnrichment.length === 0 &&
            pendingAnalysis.length > 0
          ) {
            const analysisRecovered = await triggerAnalysisRecovery(
              ctx,
              correlation,
              search._id,
              {
                ageMinutes: Math.floor(age / 60000),
                phase: "processing_timeout_last_chance",
                pendingAnalysis: pendingAnalysis.length,
              },
            );
            if (analysisRecovered) {
              recoveredCount++;
              continue;
            }
          }

          logWithCorrelation(
            "warn",
            correlation,
            "⚠️ Search stuck in processing phase - marking as failed",
            {
              searchId: search._id,
              ageMinutes: Math.floor(age / 60000),
              status: search.status,
              pendingEnrichment: pendingEnrichment.length,
              failedEnrichment: failedEnrichment.length,
              pendingAnalysis: pendingAnalysis.length,
            },
          );

          await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
            searchId: search._id as any,
            status: "failed" as const,
            error: `Search timed out during processing phase (exceeded ${Math.floor(PROCESSING_TIMEOUT_MS / 60000)} minutes). ${pendingEnrichment.length} leads pending enrichment, ${failedEnrichment.length} leads failed enrichment, ${pendingAnalysis.length} leads pending analysis.`,
          });

          recoveredCount++;
        }
      }

      // NEW: Check for searches with failed enrichment leads BEFORE timeout
      if (search.status === "processing" && age < PROCESSING_TIMEOUT_MS) {
        const pendingLinkedCount = await ctx.runQuery(
          internal.leads.searchLinkedLeads.countSearchLinkedLeads,
          {
            searchId: search._id as Id<"searches">,
            status: "pending",
          },
        );

        if (pendingLinkedCount > 0 && age >= ANALYSIS_RECOVERY_GRACE_MS) {
          logWithCorrelation(
            "info",
            correlation,
            "🔄 Resuming enrichment for pending linked duplicate businesses",
            {
              searchId: search._id,
              pendingLinkedCount,
              ageMinutes: Math.floor(age / 60000),
            },
          );

          await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
            searchId: search._id,
          });

          recoveredCount++;
          continue;
        }

        // Get leads to check for failures
        const leads = (await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          {
            searchId: search._id as any,
          },
        )) as Doc<"leads">[];

        const completedLeads = leads.filter(
          (l) => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback"
        );
        const failedLeads = leads.filter((l) => l.enrichmentStatus === "failed");
        const pendingLeads = leads.filter(
          (l) => l.enrichmentStatus === "pending" || l.enrichmentStatus === "in_progress"
        );

        // STRATEGY 1: Force completion after 30 minutes if we have SOME enriched leads
        const FORCE_COMPLETE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
        const hasEnrichedLeads = completedLeads.length > 0;
        const hasOnlyFailures = failedLeads.length > 0 && pendingLeads.length === 0;

        if (age > FORCE_COMPLETE_TIMEOUT_MS && hasEnrichedLeads && hasOnlyFailures) {
          logWithCorrelation(
            "warn",
            correlation,
            "⏩ Force completing search - proceeding with enriched leads",
            {
              searchId: search._id,
              ageMinutes: Math.floor(age / 60000),
              enrichedLeads: completedLeads.length,
              failedLeads: failedLeads.length,
              totalLeads: leads.length,
              reason: "timeout_with_partial_success",
            },
          );

          // Mark all failed leads as completed_fallback so they don't block progress
          for (const lead of failedLeads) {
            await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
              leadId: lead._id as any,
              status: "completed_fallback",
              error: lead.enrichmentError || "Skipped due to search timeout",
            });
          }

          // Trigger analysis phase with the leads we have
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/actions"].analyzeLeads,
            { searchId: search._id as any }
          );

          recoveredCount++;
          continue;
        }

        // STRATEGY 2: Retry rate-limited leads (if under 30 min timeout)
        const rateLimitedLeads = failedLeads.filter(
          (l) => l.enrichmentError &&
                 (l.enrichmentError.includes("Rate limit") || l.enrichmentError.includes("rate_limit"))
        );

        if (rateLimitedLeads.length > 0 && age < FORCE_COMPLETE_TIMEOUT_MS) {
          logWithCorrelation(
            "info",
            correlation,
            "🔄 Retrying rate-limited leads",
            {
              searchId: search._id,
              rateLimitedLeads: rateLimitedLeads.length,
              ageMinutes: Math.floor(age / 60000),
            },
          );

          // Reset each rate-limited lead back to pending and schedule retry
          for (const lead of rateLimitedLeads) {
            // Reset enrichment status to pending
            await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
              leadId: lead._id as any,
              status: "pending",
              error: undefined,
            });

            // Schedule enrichment retry with 5-second delay to avoid immediate re-rate-limiting
            // Note: roles come from search parameters, userApiKey will be fetched during enrichment
            const requestedRoles = Array.isArray(search.parameters?.roles)
              ? search.parameters.roles.filter((role: unknown): role is string =>
                  typeof role === "string" && role.trim().length > 0,
                )
              : undefined;

            await ctx.scheduler.runAfter(
              5000,
              internal.leads.asyncEnrichment.enrichSingleLead,
              {
                leadId: lead._id as any,
                searchId: search._id as any,
                userId: search.userId as any,
                roles: requestedRoles,
                // userApiKey is fetched during enrichment based on user plan
              }
            );
          }

          recoveredCount++;
        }
      }
    }

    logWithCorrelation(
      "info",
      correlation,
      "✅ Stuck search recovery cycle finished",
      {
        searchesChecked: candidateSearches.length,
        searchesRecovered: recoveredCount,
      },
    );

    return {
      success: true,
      searchesChecked: candidateSearches.length,
      searchesRecovered: recoveredCount,
    };
  },
});

/**
 * Combined Search Health Monitor
 *
 * Unified monitoring for all search-level health checks:
 * 1. Check searches ready for completion (all leads done)
 * 2. Recover stuck searches (discovery: 15min, processing: 120min timeouts)
 *
 * Runs every 5 minutes via cron. Consolidates 2 separate crons into 1.
 */
export const monitorSearchHealth: any = internalAction({
  args: {},
  handler: async (ctx) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.MONITORING,
      "system",
      {
        metadata: {
          monitorType: "search_health_combined",
        },
      },
    );

    logWithCorrelation(
      "info",
      correlation,
      "🏥 Starting Combined Search Health Monitor",
      {
        checks: ["pending_completions", "stuck_search_recovery"],
      },
    );

    const now = Date.now();
    const DISCOVERY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
    const PROCESSING_TIMEOUT_MS = 120 * 60 * 1000; // 120 minutes
    const FORCE_COMPLETE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

    const results = {
      completions: { searchesChecked: 0, searchesEvaluated: 0, completionsScheduled: 0 },
      recovery: {
        searchesChecked: 0,
        searchesRecovered: 0,
        analysisRecoveryScheduled: 0,
      },
    };

    try {
      // Get all in-progress searches (one query for both checks)
      const statusesToCheck: Array<
        "processing" | "in_progress" | "failed"
      > = ["processing", "in_progress", "failed"];

      const candidateSearches = (await ctx.runQuery(
        internal.search.internal.getSearchesByStatusesInternal,
        { statuses: statusesToCheck },
      )) as Doc<"searches">[];

      if (candidateSearches.length === 0) {
        logWithCorrelation(
          "info",
          correlation,
          "✅ No in-progress searches to check",
          {},
        );
        return { success: true, ...results };
      }

      results.completions.searchesChecked = candidateSearches.length;
      results.recovery.searchesChecked = candidateSearches.length;

      for (const search of candidateSearches) {
        // Skip searches with active checkpoint error - they're paused waiting for user action
        const checkpoint = search.enrichmentCheckpoint;
        if (checkpoint?.errorCode && checkpoint.resumable) {
          logWithCorrelation(
            "info",
            correlation,
            "⏸️ Search paused with checkpoint error - skipping",
            { searchId: search._id, errorCode: checkpoint.errorCode },
          );
          continue;
        }

        const startedAt = search.startedAt || search.createdAt;
        const age = now - startedAt;

        // ======================================================================
        // CHECK 0: Recover missed Write Emails trigger
        // ======================================================================
        if (
          (search.status === "processing" || search.status === "failed") &&
          age >= ANALYSIS_RECOVERY_GRACE_MS
        ) {
          const leadsForRecovery = (await ctx.runQuery(
            internal.leads.internal.getSearchLeadsInternal,
            { searchId: search._id as any },
          )) as Doc<"leads">[];

          if (
            isAllEnrichmentTerminal(leadsForRecovery) &&
            !hasPendingEnrichment(leadsForRecovery)
          ) {
            const analysisRecovered = await triggerAnalysisRecovery(
              ctx,
              correlation,
              search._id,
              { ageMinutes: Math.floor(age / 60000), phase: "health_monitor" },
            );
            if (analysisRecovered) {
              results.recovery.searchesRecovered++;
              results.recovery.analysisRecoveryScheduled++;
              continue;
            }
          }
        }

        // ======================================================================
        // CHECK 1: Stuck Search Recovery (timeouts)
        // ======================================================================

        // Check if stuck in discovery phase (15 min timeout)
        if (search.status === "in_progress" && age > DISCOVERY_TIMEOUT_MS) {
          logWithCorrelation(
            "warn",
            correlation,
            "⚠️ Search stuck in discovery phase - marking as failed",
            {
              searchId: search._id,
              ageMinutes: Math.floor(age / 60000),
              status: search.status,
            },
          );

          await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
            searchId: search._id as any,
            status: "failed" as const,
            error: `Search timed out during discovery phase (exceeded ${Math.floor(DISCOVERY_TIMEOUT_MS / 60000)} minutes)`,
          });

          results.recovery.searchesRecovered++;
          continue; // Skip completion check for this search
        }

        // Check if stuck in processing phase (120 min timeout)
        if (search.status === "processing" && age > PROCESSING_TIMEOUT_MS) {
          const leads = (await ctx.runQuery(
            internal.leads.internal.getSearchLeadsInternal,
            { searchId: search._id as any },
          )) as Doc<"leads">[];

          const pendingEnrichment = leads.filter(
            (l) => l.enrichmentStatus === "pending" || l.enrichmentStatus === "in_progress"
          );
          const failedEnrichment = leads.filter((l) => l.enrichmentStatus === "failed");
          const pendingAnalysis = leads.filter(
            (l) => l.analysisStatus === "pending" || l.analysisStatus === "scheduled" || l.analysisStatus === "processing"
          );

          if (pendingEnrichment.length > 0 || failedEnrichment.length > 0 || pendingAnalysis.length > 0) {
            if (
              pendingEnrichment.length === 0 &&
              failedEnrichment.length === 0 &&
              pendingAnalysis.length > 0
            ) {
              const analysisRecovered = await triggerAnalysisRecovery(
                ctx,
                correlation,
                search._id,
                {
                  ageMinutes: Math.floor(age / 60000),
                  phase: "processing_timeout_last_chance",
                  pendingAnalysis: pendingAnalysis.length,
                },
              );
              if (analysisRecovered) {
                results.recovery.searchesRecovered++;
                results.recovery.analysisRecoveryScheduled++;
                continue;
              }
            }

            logWithCorrelation(
              "warn",
              correlation,
              "⚠️ Search stuck in processing phase - marking as failed",
              {
                searchId: search._id,
                ageMinutes: Math.floor(age / 60000),
                pendingEnrichment: pendingEnrichment.length,
                failedEnrichment: failedEnrichment.length,
                pendingAnalysis: pendingAnalysis.length,
              },
            );

            await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
              searchId: search._id as any,
              status: "failed" as const,
              error: `Search timed out during processing phase (exceeded ${Math.floor(PROCESSING_TIMEOUT_MS / 60000)} minutes).`,
            });

            results.recovery.searchesRecovered++;
            continue; // Skip completion check for this search
          }
        }

        // ======================================================================
        // CHECK 2: Force completion after 30 min with partial success
        // ======================================================================
        if (search.status === "processing" && age > FORCE_COMPLETE_TIMEOUT_MS && age < PROCESSING_TIMEOUT_MS) {
          const leads = (await ctx.runQuery(
            internal.leads.internal.getSearchLeadsInternal,
            { searchId: search._id as any },
          )) as Doc<"leads">[];

          const completedLeads = leads.filter(
            (l) => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback"
          );
          const failedLeads = leads.filter((l) => l.enrichmentStatus === "failed");
          const pendingLeads = leads.filter(
            (l) => l.enrichmentStatus === "pending" || l.enrichmentStatus === "in_progress"
          );

          const hasEnrichedLeads = completedLeads.length > 0;
          const hasOnlyFailures = failedLeads.length > 0 && pendingLeads.length === 0;

          if (hasEnrichedLeads && hasOnlyFailures) {
            logWithCorrelation(
              "warn",
              correlation,
              "⏩ Force completing search - proceeding with enriched leads",
              {
                searchId: search._id,
                ageMinutes: Math.floor(age / 60000),
                enrichedLeads: completedLeads.length,
                failedLeads: failedLeads.length,
              },
            );

            // Mark all failed leads as completed_fallback
            for (const lead of failedLeads) {
              await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
                leadId: lead._id as any,
                status: "completed_fallback",
                error: lead.enrichmentError || "Skipped due to search timeout",
              });
            }

            // Trigger analysis phase
            await ctx.scheduler.runAfter(
              0,
              (internal as any)["leads/actions"].analyzeLeads,
              { searchId: search._id as any }
            );

            results.recovery.searchesRecovered++;
            continue;
          }

          // Retry rate-limited leads if under 30 min
          const rateLimitedLeads = failedLeads.filter(
            (l) => l.enrichmentError?.includes("Rate limit") || l.enrichmentError?.includes("rate_limit")
          );

          if (rateLimitedLeads.length > 0) {
            logWithCorrelation(
              "info",
              correlation,
              "🔄 Retrying rate-limited leads",
              { searchId: search._id, rateLimitedLeads: rateLimitedLeads.length },
            );

            for (const lead of rateLimitedLeads) {
              await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
                leadId: lead._id as any,
                status: "pending",
                error: undefined,
              });

              const requestedRoles = Array.isArray(search.parameters?.roles)
                ? search.parameters.roles.filter((role: unknown): role is string =>
                    typeof role === "string" && role.trim().length > 0,
                  )
                : undefined;

              await ctx.scheduler.runAfter(
                5000,
                internal.leads.asyncEnrichment.enrichSingleLead,
                {
                  leadId: lead._id as any,
                  searchId: search._id as any,
                  userId: search.userId as any,
                  roles: requestedRoles,
                }
              );
            }

            results.recovery.searchesRecovered++;
            continue;
          }
        }

        // ======================================================================
        // CHECK 3: Search Completion (all leads done)
        // ======================================================================
        const readiness = await ctx.runQuery(
          internal.search.internal.getSearchCompletionReadinessInternal,
          { searchId: search._id as Id<"searches"> },
        );

        if (!readiness.ready) {
          continue;
        }

        results.completions.searchesEvaluated++;

        results.completions.completionsScheduled++;

        logWithCorrelation(
          "info",
          correlation,
          "🏁 Write Emails complete - scheduling search completion",
          {
            searchId: search._id,
            reason: readiness.reason,
            total: readiness.total,
          },
        );

        await ctx.scheduler.runAfter(0, "search/actions:completeSearch" as any, {
          searchId: search._id as any,
        });
      }

      // ======================================================================
      // SUMMARY
      // ======================================================================
      logWithCorrelation(
        "info",
        correlation,
        "✅ Combined Search Health Monitor Complete",
        {
          completions: results.completions,
          recovery: results.recovery,
        },
      );

      return {
        success: true,
        ...results,
      };
    } catch (error) {
      logWithCorrelation(
        "error",
        correlation,
        "💥 Combined Search Health Monitor Failed",
        {},
        error as Error,
      );

      throw error;
    }
  },
});
