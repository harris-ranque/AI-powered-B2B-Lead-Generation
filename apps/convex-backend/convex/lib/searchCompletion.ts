import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getAnalysisCompletionState } from "./analysisProgress";
import { isAllEnrichmentTerminal } from "./searchAnalysisRecovery";

async function hasPendingLinkedEnrichment(
  ctx: QueryCtx,
  searchId: Id<"searches">,
): Promise<boolean> {
  const pending = await ctx.db
    .query("searchLinkedLeads")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "pending"),
    )
    .take(1);
  return pending.length > 0;
}

export type SearchCompletionReadiness = {
  ready: boolean;
  reason: string;
  inProgress: number;
  total: number;
  isComplete: boolean;
};

/**
 * Whether Write Emails has finished and the search can be finalized.
 * Uses contact-level completion when leadContacts exist (multi-contact pipeline).
 */
export async function getSearchAnalysisCompletionReadiness(
  ctx: QueryCtx,
  searchId: Id<"searches">,
): Promise<SearchCompletionReadiness> {
  const search = await ctx.db.get(searchId);
  if (!search) {
    return {
      ready: false,
      reason: "search_not_found",
      inProgress: 0,
      total: 0,
      isComplete: false,
    };
  }

  const leads = await ctx.db
    .query("leads")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .collect();

  const linkedEnrichmentPending = await hasPendingLinkedEnrichment(ctx, searchId);

  if (!isAllEnrichmentTerminal(leads) || linkedEnrichmentPending) {
    return {
      ready: false,
      reason: linkedEnrichmentPending
        ? "linked_enrichment_incomplete"
        : "enrichment_incomplete",
      inProgress: 0,
      total: 0,
      isComplete: false,
    };
  }

  const completion = await getAnalysisCompletionState(ctx, searchId);

  if (completion.total === 0) {
    return {
      ready: true,
      reason: "nothing_to_analyze",
      inProgress: 0,
      total: 0,
      isComplete: true,
    };
  }

  if (completion.inProgress > 0) {
    return {
      ready: false,
      reason: "analysis_in_progress",
      inProgress: completion.inProgress,
      total: completion.total,
      isComplete: false,
    };
  }

  if (!completion.isComplete) {
    return {
      ready: false,
      reason: "analysis_not_complete",
      inProgress: 0,
      total: completion.total,
      isComplete: false,
    };
  }

  return {
    ready: true,
    reason: "analysis_complete",
    inProgress: 0,
    total: completion.total,
    isComplete: true,
  };
}
