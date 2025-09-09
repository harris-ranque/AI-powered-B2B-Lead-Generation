import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Research Progress Tracking for Tiered Business Context Research
 * 
 * Tracks progress updates from the three-tier research system:
 * - Tier 1: Tavily (fast basic research)  
 * - Tier 2: Exa (competitor and industry analysis)
 * - Tier 3: Perplexity (comprehensive reports)
 */

// Update research progress for a search (internal mutation)
export const updateResearchProgress = internalMutation({
  args: {
    searchId: v.id("searches"),
    stage: v.union(
      v.literal("research_started"),
      v.literal("tier1_tavily"), 
      v.literal("tier2_exa"),
      v.literal("tier3_perplexity"),
      v.literal("research_completed"),
      v.literal("research_failed"),
      v.literal("research_error")
    ),
    tier: v.union(
      v.literal("tavily"),
      v.literal("exa"), 
      v.literal("perplexity"),
      v.literal("error")
    ),
    confidence: v.optional(v.number()),
    dataPoints: v.optional(v.number()),
    sourcesAnalyzed: v.optional(v.number()),
    message: v.string(),
    escalationReason: v.optional(v.string()),
    error: v.optional(v.string()),
    metadata: v.optional(v.any())
  },
  handler: async (ctx, args) => {
    // Get the search to verify it exists and get user ID
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      console.warn(`Research progress update for non-existent search: ${args.searchId}`);
      return;
    }

    // Update search with research progress metadata
    await ctx.db.patch(args.searchId, {
      researchStage: args.stage,
      researchTier: args.tier,
      researchConfidence: args.confidence,
      researchDataPoints: args.dataPoints,
      researchSourcesAnalyzed: args.sourcesAnalyzed,
      researchEscalationReason: args.escalationReason,
    });

    // Broadcast real-time progress update to user
    await ctx.scheduler.runAfter(0, internal.realtime.broadcaster.broadcastPipelineUpdate, {
      userId: search.userId,
      searchId: args.searchId,
      stage: args.stage,
      progress: calculateProgressPercentage(args.stage, args.tier),
      message: args.message,
      data: {
        tier: args.tier,
        confidence: args.confidence,
        dataPoints: args.dataPoints,
        sourcesAnalyzed: args.sourcesAnalyzed,
        escalationReason: args.escalationReason,
        ...args.metadata,
      },
      error: args.error,
    });

    // Log research metrics for analytics
    await ctx.db.insert("researchMetrics", {
      searchId: args.searchId,
      userId: search.userId,
      stage: args.stage,
      tier: args.tier,
      confidence: args.confidence || 0,
      dataPoints: args.dataPoints || 0,
      sourcesAnalyzed: args.sourcesAnalyzed || 0,
      escalationReason: args.escalationReason,
      timestamp: Date.now(),
      error: args.error,
      metadata: args.metadata || {},
    });

    return { success: true };
  }
});

// Calculate progress percentage based on research stage
function calculateProgressPercentage(stage: string, tier: string): number {
  const stageProgress = {
    "research_started": 5,
    "tier1_tavily": 25,
    "tier2_exa": 60, 
    "tier3_perplexity": 85,
    "research_completed": 100,
    "research_failed": 0,
    "research_error": 0
  };
  
  return stageProgress[stage as keyof typeof stageProgress] || 0;
}

// Public mutation for research completion (called by LangGraph worker)
export const completeResearch = mutation({
  args: {
    searchId: v.id("searches"),
    researchResults: v.object({
      tier: v.string(),
      confidence: v.number(),
      dataPoints: v.number(),
      sourcesAnalyzed: v.number(),
      researchTime: v.number(),
      escalationReason: v.optional(v.string()),
      competitors: v.optional(v.array(v.any())),
      industryInsights: v.optional(v.string()),
      comprehensiveReport: v.optional(v.string()),
    })
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Verify search exists and user owns it
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== identity.subject) {
      throw new Error("Search not found or access denied");
    }

    // Update search with final research results
    await ctx.db.patch(args.searchId, {
      researchResults: args.researchResults,
      researchStage: "research_completed",
      researchTier: args.researchResults.tier as "tavily" | "exa" | "perplexity",
      researchConfidence: args.researchResults.confidence,
      researchDataPoints: args.researchResults.dataPoints,
      researchSourcesAnalyzed: args.researchResults.sourcesAnalyzed,
      researchCompletedAt: Date.now(),
    });

    // Broadcast completion
    await ctx.scheduler.runAfter(0, internal.research.progress.updateResearchProgress, {
      searchId: args.searchId,
      stage: "research_completed",
      tier: args.researchResults.tier as any,
      confidence: args.researchResults.confidence,
      dataPoints: args.researchResults.dataPoints,
      sourcesAnalyzed: args.researchResults.sourcesAnalyzed,
      message: `Research completed using ${args.researchResults.tier} tier`,
      escalationReason: args.researchResults.escalationReason,
      metadata: {
        researchTime: args.researchResults.researchTime,
        hasCompetitors: (args.researchResults.competitors?.length || 0) > 0,
        hasIndustryInsights: Boolean(args.researchResults.industryInsights),
        hasComprehensiveReport: Boolean(args.researchResults.comprehensiveReport),
      }
    });

    return { success: true, searchId: args.searchId };
  }
});

// Get research progress for a search
export const getResearchProgress = mutation({
  args: {
    searchId: v.id("searches")
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Get search and verify access
    const search = await ctx.db.get(args.searchId);
    if (!search || search.userId !== identity.subject) {
      throw new Error("Search not found or access denied");
    }

    // Get recent research metrics
    const recentMetrics = await ctx.db
      .query("researchMetrics")
      .withIndex("by_search_timestamp")
      .filter(q => q.eq(q.field("searchId"), args.searchId))
      .order("desc")
      .take(10);

    return {
      searchId: args.searchId,
      currentStage: search.researchStage,
      currentTier: search.researchTier,
      confidence: search.researchConfidence,
      dataPoints: search.researchDataPoints,
      sourcesAnalyzed: search.researchSourcesAnalyzed,
      escalationReason: search.researchEscalationReason,
      completedAt: search.researchCompletedAt,
      results: search.researchResults,
      recentActivity: recentMetrics.map(metric => ({
        stage: metric.stage,
        tier: metric.tier,
        confidence: metric.confidence,
        timestamp: metric.timestamp,
        message: `${metric.stage} - ${metric.tier} (confidence: ${metric.confidence}%)`,
      })),
    };
  }
});

// Get aggregated research analytics (admin only)
export const getResearchAnalytics = mutation({
  args: {
    timeframe: v.optional(v.union(
      v.literal("24h"),
      v.literal("7d"), 
      v.literal("30d")
    )),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // TODO: Add admin check
    // For now, allow any authenticated user

    const timeframe = args.timeframe || "7d";
    const cutoffTime = Date.now() - getTimeframeDuration(timeframe);

    // Get recent research metrics
    const metrics = await ctx.db
      .query("researchMetrics")
      .withIndex("by_timestamp")
      .filter(q => q.gte(q.field("timestamp"), cutoffTime))
      .collect();

    // Calculate analytics
    const tierUsage = metrics.reduce((acc, metric) => {
      acc[metric.tier] = (acc[metric.tier] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const averageConfidence = metrics.reduce((sum, metric) => sum + metric.confidence, 0) / Math.max(metrics.length, 1);
    
    const escalationRate = metrics.filter(m => m.escalationReason).length / Math.max(metrics.length, 1);

    const stageDistribution = metrics.reduce((acc, metric) => {
      acc[metric.stage] = (acc[metric.stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      timeframe,
      totalOperations: metrics.length,
      tierUsage,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      escalationRate: Math.round(escalationRate * 100),
      stageDistribution,
      successRate: Math.round((metrics.filter(m => m.stage === "research_completed").length / Math.max(metrics.length, 1)) * 100),
    };
  }
});

function getTimeframeDuration(timeframe: string): number {
  switch (timeframe) {
    case "24h": return 24 * 60 * 60 * 1000;
    case "7d": return 7 * 24 * 60 * 60 * 1000;
    case "30d": return 30 * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}