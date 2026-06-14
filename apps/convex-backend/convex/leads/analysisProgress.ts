import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { computeAnalysisProgress } from "../lib/analysisProgress";

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
  },
  handler: async (ctx, args) => {
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

    await ctx.runMutation(internal.search.internal.updateSearchProgressInternal, {
      searchId: args.searchId,
      progress: {
        discovered,
        enriched,
        analyzed: analysis.personalized,
        total: analysis.total,
      },
    });

    const progressPercent =
      args.progressPercent ?? analysis.personalizedPercent;

    await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
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
      },
    });

    return {
      updated: true,
      personalized: analysis.personalized,
      total: analysis.total,
      isComplete: analysis.isComplete,
    };
  },
});
