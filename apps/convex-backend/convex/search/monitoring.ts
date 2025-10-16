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
