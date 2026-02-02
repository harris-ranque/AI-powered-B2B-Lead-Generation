import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Constants for query limits
const MAX_ITERATION_COUNT = 100000;
const BATCH_SIZE = 100;

/**
 * Daily admin metrics aggregation - runs once per day via cron
 * Computes all admin dashboard metrics efficiently using indexes and streaming
 */
export const aggregateDailyMetrics = internalMutation({
  args: {
    date: v.optional(v.string()), // YYYY-MM-DD format, defaults to today
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const targetDate: string =
      args.date || new Date(now).toISOString().split("T")[0] || "";

    // Check if we already have metrics for this date
    const existingMetrics = await ctx.db
      .query("adminMetrics")
      .withIndex("by_date", (q) => q.eq("date", targetDate))
      .unique();

    // Date boundaries for queries
    const dateStart = new Date(targetDate + "T00:00:00Z").getTime();
    const dateEnd = new Date(targetDate + "T23:59:59.999Z").getTime();

    // Initialize counters
    let totalUsers = 0;
    let activeUsers = 0;
    let newUsers = 0;
    let freeUsers = 0;
    let proUsers = 0;
    let enterpriseUsers = 0;

    // Count users using streaming with indexes
    for await (const user of ctx.db.query("users")) {
      totalUsers++;

      if (user.isActive) {
        activeUsers++;
      }

      if (user.createdAt >= dateStart && user.createdAt <= dateEnd) {
        newUsers++;
      }

      // Plan distribution
      switch (user.plan) {
        case "starter":
          freeUsers++;
          break;
        case "professional":
        case "business":
          proUsers++;
          break;
        case "enterprise":
          enterpriseUsers++;
          break;
      }

      if (totalUsers >= MAX_ITERATION_COUNT) break;
    }

    // Count searches for the day
    let totalSearches = 0;
    for await (const search of ctx.db
      .query("searches")
      .withIndex("by_created", (q) =>
        q.gte("createdAt", dateStart).lte("createdAt", dateEnd)
      )) {
      totalSearches++;
      if (totalSearches >= MAX_ITERATION_COUNT) break;
    }

    // Count total leads (all time is expensive, estimate from recent activity)
    let totalLeads = 0;
    let leadsProcessed = 0;
    for await (const lead of ctx.db.query("leads")) {
      totalLeads++;
      leadsProcessed++;
      if (leadsProcessed >= MAX_ITERATION_COUNT) break;
    }

    // Count generated emails (leads with emails and analysis completed)
    let totalEmails = 0;
    let emailsProcessed = 0;
    for await (const lead of ctx.db.query("leads")) {
      if (lead.analysisStatus === "completed" && lead.generatedEmails && lead.generatedEmails.length > 0) {
        totalEmails++;
      }
      emailsProcessed++;
      if (emailsProcessed >= MAX_ITERATION_COUNT) break;
    }

    // Calculate credit usage for the day
    let totalCreditsUsed = 0;
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type", (q) => q.eq("type", "usage"))) {
      if (tx.createdAt >= dateStart && tx.createdAt <= dateEnd) {
        totalCreditsUsed += Math.abs(tx.amount);
      }
    }

    // Calculate revenue from billing (simplified - active subscriptions)
    let totalRevenue = 0;
    let newRevenue = 0;
    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "active"))) {
      totalRevenue += billing.amount || 0;

      // Check if subscription started today
      if (billing.createdAt >= dateStart && billing.createdAt <= dateEnd) {
        newRevenue += billing.amount || 0;
      }
    }

    // Calculate quality metrics from recent leads
    let relevanceSum = 0;
    let relevanceCount = 0;
    let processingTimeSum = 0;
    let processingTimeCount = 0;
    let errorCount = 0;
    let qualityLeadsProcessed = 0;

    // No by_created index on leads - filter in memory
    for await (const lead of ctx.db.query("leads")) {
      // Filter by creation date
      if (lead.createdAt < dateStart || lead.createdAt > dateEnd) {
        continue;
      }
      qualityLeadsProcessed++;

      // relevanceScore is inside aiAnalysis
      const relevanceScore = lead.aiAnalysis?.relevanceScore;
      if (relevanceScore !== undefined && relevanceScore !== null) {
        relevanceSum += relevanceScore;
        relevanceCount++;
      }

      if (
        lead.analysisStatus === "completed" &&
        lead.analysisStartedAt &&
        lead.analysisCompletedAt
      ) {
        processingTimeSum += lead.analysisCompletedAt - lead.analysisStartedAt;
        processingTimeCount++;
      }

      if (lead.analysisStatus === "failed" || lead.enrichmentStatus === "failed") {
        errorCount++;
      }

      if (qualityLeadsProcessed >= MAX_ITERATION_COUNT) break;
    }

    const avgRelevanceScore =
      relevanceCount > 0 ? Math.round((relevanceSum / relevanceCount) * 100) / 100 : 0;
    const avgProcessingTime =
      processingTimeCount > 0
        ? Math.round(processingTimeSum / processingTimeCount)
        : 0;
    const errorRate =
      qualityLeadsProcessed > 0
        ? Math.round((errorCount / qualityLeadsProcessed) * 10000) / 100
        : 0;

    const metrics = {
      totalUsers,
      newUsers,
      activeUsers,
      freeUsers,
      proUsers,
      enterpriseUsers,
      totalSearches,
      totalLeads,
      totalEmails,
      totalCreditsUsed,
      totalRevenue,
      newRevenue,
      avgRelevanceScore,
      avgProcessingTime,
      errorRate,
    };

    // Insert or update metrics
    if (existingMetrics) {
      await ctx.db.patch(existingMetrics._id, {
        metrics,
        createdAt: now,
      });
    } else {
      await ctx.db.insert("adminMetrics", {
        date: targetDate,
        metrics,
        createdAt: now,
      });
    }

    console.log(`[MetricsAggregation] Aggregated metrics for ${targetDate}:`, metrics);

    return { success: true, date: targetDate, metrics };
  },
});

/**
 * Get latest aggregated metrics - for quick admin dashboard loads
 */
export const getLatestMetrics = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get the most recent metrics entry
    const latestMetrics = await ctx.db
      .query("adminMetrics")
      .withIndex("by_date")
      .order("desc")
      .first();

    return latestMetrics;
  },
});

/**
 * Get metrics for a date range
 */
export const getMetricsRange = internalQuery({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("adminMetrics")
      .withIndex("by_date", (q) =>
        q.gte("date", args.startDate).lte("date", args.endDate)
      )
      .collect();

    return metrics;
  },
});
