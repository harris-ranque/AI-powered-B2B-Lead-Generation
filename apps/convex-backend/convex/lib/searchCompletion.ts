import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getAnalysisCompletionState } from "./analysisProgress";
import { isAllEnrichmentTerminal } from "./searchAnalysisRecovery";

type CompletionCtx = QueryCtx | MutationCtx;

export async function countPendingLinkedEnrichment(
  ctx: CompletionCtx,
  searchId: Id<"searches">,
): Promise<number> {
  const pending = await ctx.db
    .query("searchLinkedLeads")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "pending"),
    )
    .collect();
  return pending.length;
}

async function hasPendingLinkedEnrichment(
  ctx: CompletionCtx,
  searchId: Id<"searches">,
): Promise<boolean> {
  const pendingCount = await countPendingLinkedEnrichment(ctx, searchId);
  return pendingCount > 0;
}

async function hasRunningEnrichmentBatch(
  ctx: CompletionCtx,
  searchId: Id<"searches">,
): Promise<boolean> {
  const running = await ctx.db
    .query("enrichmentBatches")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .filter((q) => q.eq(q.field("status"), "running"))
    .take(1);
  return running.length > 0;
}

/**
 * Native enrichment batch finished but duplicate-linked businesses are still pending.
 * Schedules enrichLeads so linked re-enrichment runs, then analysis can start.
 */
export async function schedulePendingLinkedEnrichmentRecovery(
  ctx: MutationCtx,
  searchId: Id<"searches">,
): Promise<{ scheduled: boolean; reason: string; pendingCount: number }> {
  const pendingCount = await countPendingLinkedEnrichment(ctx, searchId);
  if (pendingCount === 0) {
    return { scheduled: false, reason: "no_pending_linked", pendingCount: 0 };
  }

  const search = await ctx.db.get(searchId);
  if (!search || search.status === "cancelled") {
    return { scheduled: false, reason: "search_not_active", pendingCount };
  }

  if (search.enrichmentCheckpoint?.errorCode && search.enrichmentCheckpoint.resumable) {
    return { scheduled: false, reason: "checkpoint_paused", pendingCount };
  }

  if (await hasRunningEnrichmentBatch(ctx, searchId)) {
    return { scheduled: false, reason: "enrichment_batch_running", pendingCount };
  }

  await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
    searchId,
  });

  return {
    scheduled: true,
    reason: "linked_reenrichment_scheduled",
    pendingCount,
  };
}

/** Whether enrichment finished for native leads and linked re-enrichment queue. */
export async function isSearchEnrichmentComplete(
  ctx: CompletionCtx,
  searchId: Id<"searches">,
): Promise<boolean> {
  const leads = await ctx.db
    .query("leads")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .collect();

  const linkedEnrichmentPending = await hasPendingLinkedEnrichment(ctx, searchId);
  const nativeEnrichmentTerminal =
    leads.length === 0 || isAllEnrichmentTerminal(leads);

  return nativeEnrichmentTerminal && !linkedEnrichmentPending;
}

export async function scheduleSearchCompletionIfReady(
  ctx: MutationCtx,
  searchId: Id<"searches">,
): Promise<{ scheduled: boolean; reason: string }> {
  const readiness = await getSearchAnalysisCompletionReadiness(ctx, searchId);
  if (!readiness.ready) {
    return { scheduled: false, reason: readiness.reason };
  }

  const search = await ctx.db.get(searchId);
  if (
    !search ||
    (search.status !== "processing" && search.status !== "in_progress")
  ) {
    return { scheduled: false, reason: "search_not_processing" };
  }

  await ctx.scheduler.runAfter(0, "search/actions:completeSearch" as any, {
    searchId,
  });

  return { scheduled: true, reason: readiness.reason };
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

  if (!await isSearchEnrichmentComplete(ctx, searchId)) {
    const linkedEnrichmentPending = await hasPendingLinkedEnrichment(
      ctx,
      searchId,
    );
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
