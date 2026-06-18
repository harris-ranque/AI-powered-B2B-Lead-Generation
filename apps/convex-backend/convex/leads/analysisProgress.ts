import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { computeAnalysisProgress } from "../lib/analysisProgress";
import { insertPipelineBroadcast } from "../realtime/broadcaster";

export type PublishAnalysisProgressArgs = {
  searchId: Id<"searches">;
  userId: Id<"users">;
  message?: string;
  progressPercent?: number;
  currentLead?: string;
  batchId?: string;
  activityPhase?: "researching" | "writing_email" | "completed";
};

/**
 * Broadcast live Write Emails progress to the UI.
 *
 * Does not patch the searches document — concurrent LangGraph batch/lead
 * webhooks would cause OCC conflicts on the same search row. Final
 * search.progress / results are written by completeSearch.
 */
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

  return {
    updated: true,
    personalized: analysis.personalized,
    total: analysis.total,
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
