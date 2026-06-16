import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { computeAnalysisProgress } from "../lib/analysisProgress";
import { countExportableSummaryForSearch } from "../lib/exportEligibility";
import { insertPipelineBroadcast } from "../realtime/broadcaster";
import {
  isUpdatedAtSchemaError,
  withUpdatedAtIfSupported,
} from "../search/utils";

export type PublishAnalysisProgressArgs = {
  searchId: Id<"searches">;
  userId: Id<"users">;
  message?: string;
  progressPercent?: number;
  currentLead?: string;
  batchId?: string;
  activityPhase?: "researching" | "writing_email" | "completed";
};

export async function publishAnalysisProgressHandler(
  ctx: MutationCtx,
  args: PublishAnalysisProgressArgs,
) {
  const search = await ctx.db.get(args.searchId);
  if (!search) {
    return { updated: false, reason: "search_not_found" };
  }

  const analysis = await computeAnalysisProgress(ctx, args.searchId);
  const discovered =
    search.progress?.discovered ??
    search.results?.totalFound ??
    analysis.total;
  const enriched =
    search.progress?.enriched ?? search.results?.enrichedCount ?? 0;

  const progressPercent =
    args.progressPercent ?? analysis.personalizedPercent;

  await insertPipelineBroadcast(ctx, {
    userId: args.userId,
    searchId: args.searchId,
    stage: "analysis",
    progress: progressPercent,
    message:
      args.message ??
      `Wrote ${analysis.personalized} of ${analysis.total} emails (${progressPercent}% complete)`,
    data: {
      progress: {
        discovered,
        enriched,
        analyzed: analysis.personalized,
        total: analysis.total,
      },
      analysisBreakdown: {
        pending: analysis.pending,
        inProgress: analysis.inProgress,
        completed: analysis.completed,
        personalized: analysis.personalized,
        failed: analysis.failed,
        skipped: analysis.skipped,
        percentComplete: analysis.percentComplete,
        personalizedPercent: analysis.personalizedPercent,
      },
      currentLead: args.currentLead,
      batchId: args.batchId,
      activityPhase: args.activityPhase,
      activityLabel: args.message,
    },
  });

  const exportableSummary = await countExportableSummaryForSearch(
    ctx,
    args.searchId,
    search.userId,
  );
  const exportableCount = exportableSummary.exportableContacts;
  const existingResults = search.results ?? {
    totalFound: discovered,
    enrichedCount: enriched,
  };

  const now = Date.now();
  const progress = {
    discovered,
    enriched,
    analyzed: analysis.personalized,
    total: analysis.total,
  };
  let searchPatch: Record<string, unknown> = {
    progress,
    lastOrchestrationAt: now,
    results: {
      ...existingResults,
      exportableCount,
      analyzedCount: analysis.personalized,
    },
  };
  searchPatch = withUpdatedAtIfSupported(searchPatch, search, now);

  try {
    await ctx.db.patch(args.searchId, searchPatch);
  } catch (error) {
    if (!isUpdatedAtSchemaError(error)) {
      throw error;
    }
    const { updatedAt: _unused, ...withoutTimestamp } = searchPatch as typeof searchPatch & {
      updatedAt?: number;
    };
    await ctx.db.patch(args.searchId, withoutTimestamp);
  }

  return {
    updated: true,
    personalized: analysis.personalized,
    total: analysis.total,
    exportableCount,
    isComplete: analysis.isComplete,
  };
}

/**
 * Keep search.progress.analyzed aligned with live contact/lead analysis state.
 */
export const publishAnalysisProgress = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    message: v.optional(v.string()),
    progressPercent: v.optional(v.number()),
    currentLead: v.optional(v.string()),
    batchId: v.optional(v.string()),
    activityPhase: v.optional(
      v.union(
        v.literal("researching"),
        v.literal("writing_email"),
        v.literal("completed"),
      ),
    ),
  },
  handler: async (ctx, args) => publishAnalysisProgressHandler(ctx, args),
});
