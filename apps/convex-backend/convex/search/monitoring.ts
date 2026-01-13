/**
 * Search Completion Monitoring
 *
 * Periodically checks searches stuck in processing state and finalizes them
 * once all eligible leads have finished async analysis.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  createCorrelationContext,
  logWithCorrelation,
  OPERATION_TYPES,
} from "../lib/correlation";
import { Doc } from "../_generated/dataModel";

const FINAL_ANALYSIS_STATUSES = new Set(["completed", "failed", "timeout"]);

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
      const leads = (await ctx.runQuery(
        internal.leads.internal.getSearchLeadsInternal,
        {
          searchId: search._id as any,
        },
      )) as Doc<"leads">[];

      const eligibleLeads = leads.filter((lead: Doc<"leads">) => {
        const enrichmentComplete =
          lead.enrichmentStatus === "completed" ||
          lead.enrichmentStatus === "completed_fallback";
        const hasEmail = Boolean(lead.contactInfo?.emails?.length);
        const hasContactName = Boolean(lead.contactInfo?.contacts?.[0]?.name);

        return enrichmentComplete && hasEmail && hasContactName;
      });

      if (eligibleLeads.length === 0) {
        continue;
      }

      searchesEvaluated++;

      const finishedLeads = eligibleLeads.filter((lead: Doc<"leads">) =>
        FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? ""),
      );

      const activeLeads = eligibleLeads.filter(
        (lead: Doc<"leads">) =>
          !FINAL_ANALYSIS_STATUSES.has(lead.analysisStatus ?? ""),
      );

      if (activeLeads.length > 0) {
        continue;
      }

      completionsScheduled++;

      logWithCorrelation(
        "info",
        correlation,
        "🏁 All leads complete - scheduling search completion",
        {
          searchId: search._id,
          analyzedLeads: finishedLeads.length,
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

        await ctx.runMutation(internal.search.internal.markSearchFailedInternal, {
          searchId: search._id as any,
          error: `Search timed out during discovery phase (exceeded ${Math.floor(DISCOVERY_TIMEOUT_MS / 60000)} minutes)`,
        });

        recoveredCount++;
        continue;
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
        const pendingAnalysis = leads.filter(
          (l) => l.analysisStatus === "pending" || l.analysisStatus === "scheduled" || l.analysisStatus === "processing"
        );

        if (pendingEnrichment.length > 0 || pendingAnalysis.length > 0) {
          logWithCorrelation(
            "warn",
            correlation,
            "⚠️ Search stuck in processing phase - marking as failed",
            {
              searchId: search._id,
              ageMinutes: Math.floor(age / 60000),
              status: search.status,
              pendingEnrichment: pendingEnrichment.length,
              pendingAnalysis: pendingAnalysis.length,
            },
          );

          await ctx.runMutation(internal.search.internal.markSearchFailedInternal, {
            searchId: search._id as any,
            error: `Search timed out during processing phase (exceeded ${Math.floor(PROCESSING_TIMEOUT_MS / 60000)} minutes). ${pendingEnrichment.length} leads pending enrichment, ${pendingAnalysis.length} leads pending analysis.`,
          });

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
