import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Constants for query limits - conservative to stay under Convex 16MB byte limit
// Lead documents are 5-20KB each, so 5000 * 10KB = 50MB would exceed limit
const MAX_ITERATION_COUNT = 10000;
const MAX_DOCS_SCAN = 5000;

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

      if (totalUsers >= MAX_DOCS_SCAN) break;
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

    // Count leads and compute quality metrics in a SINGLE pass using by_created index
    // This replaces 3 separate full-table scans that would each hit the 16MB byte limit
    let totalLeads = 0;
    let totalEmails = 0;
    let relevanceSum = 0;
    let relevanceCount = 0;
    let processingTimeSum = 0;
    let processingTimeCount = 0;
    let errorCount = 0;
    let todayLeadsProcessed = 0;

    for await (const lead of ctx.db
      .query("leads")
      .withIndex("by_created", (q) => q.gte("createdAt", dateStart).lte("createdAt", dateEnd))) {
      totalLeads++;

      // Email count
      if (lead.analysisStatus === "completed" && lead.generatedEmails && lead.generatedEmails.length > 0) {
        totalEmails++;
      }

      // Quality metrics
      todayLeadsProcessed++;
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

      if (totalLeads >= MAX_DOCS_SCAN) break;
    }

    // Calculate credit usage for the day using compound index
    let totalCreditsUsed = 0;
    let creditDocsScanned = 0;
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_type_created", (q) =>
        q.eq("type", "usage").gte("createdAt", dateStart).lte("createdAt", dateEnd))) {
      totalCreditsUsed += Math.abs(tx.amount);
      creditDocsScanned++;
      if (creditDocsScanned >= MAX_DOCS_SCAN) break;
    }

    // Calculate revenue from billing (simplified - active subscriptions)
    let totalRevenue = 0;
    let newRevenue = 0;
    let billingDocsScanned = 0;
    for await (const billing of ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "active"))) {
      totalRevenue += billing.amount || 0;

      // Check if subscription started today
      if (billing.createdAt >= dateStart && billing.createdAt <= dateEnd) {
        newRevenue += billing.amount || 0;
      }
      billingDocsScanned++;
      if (billingDocsScanned >= MAX_DOCS_SCAN) break;
    }

    const avgRelevanceScore =
      relevanceCount > 0 ? Math.round((relevanceSum / relevanceCount) * 100) / 100 : 0;
    const avgProcessingTime =
      processingTimeCount > 0
        ? Math.round(processingTimeSum / processingTimeCount)
        : 0;
    const errorRate =
      todayLeadsProcessed > 0
        ? Math.round((errorCount / todayLeadsProcessed) * 10000) / 100
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
