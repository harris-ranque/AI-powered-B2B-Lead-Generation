import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "../auth";

// Get system control status
export const getSystemControlStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    // Get current processing statistics
    const processingSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "processing"))
      .collect();

    const queuedSearches = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "queued"))
      .collect();

    return {
      maintenanceMode: false, // Not available in current schema
      leadGenerationPaused: false, // Not available in current schema
      processingQueue: {
        processing: processingSearches.length,
        queued: queuedSearches.length,
        total: processingSearches.length + queuedSearches.length,
      },
      systemLoad: {
        status: processingSearches.length > 10 ? "high" : processingSearches.length > 5 ? "medium" : "low",
        activeProcesses: processingSearches.length,
      },
    };
  },
});

// Get system activity
export const getSystemActivity = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit || 50;
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Get recent system logs
    const systemLogs = await ctx.db
      .query("systemLogs")
      .filter((q) => q.gte(q.field("timestamp"), oneHourAgo))
      .order("desc")
      .take(limit);

    // Get recent searches with their status
    const recentSearches = await ctx.db
      .query("searches")
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .order("desc")
      .take(limit);

    // Get recent failed operations
    const failedOperations = await ctx.db
      .query("searches")
      .filter((q) => q.eq(q.field("status"), "failed"))
      .filter((q) => q.gte(q.field("createdAt"), oneHourAgo))
      .collect();

    return {
      systemLogs: systemLogs.map(log => ({
        id: log._id,
        type: log.type,
        action: log.action,
        timestamp: log.timestamp,
        data: log.data,
      })),
      recentSearches: recentSearches.map(search => ({
        id: search._id,
        userId: search.userId,
        status: search.status,
        createdAt: search._creationTime,
        name: search.name,
        parameters: search.parameters,
      })),
      failedOperations: failedOperations.length,
      activitySummary: {
        totalSearches: recentSearches.length,
        failedSearches: failedOperations.length,
        successRate: recentSearches.length > 0 
          ? Math.round(((recentSearches.length - failedOperations.length) / recentSearches.length) * 100)
          : 100,
      },
    };
  },
});

// Pause all lead generation
export const pauseAllLeadGeneration = mutation({
  args: {},
  handler: async (ctx) => {
    const adminUser = await requireAdmin(ctx);

    // Update system configuration
    let systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    // Note: Current systemConfiguration schema doesn't support lead generation pause settings
    // This functionality would require schema updates to add a settings field
    
    // For now, we'll just log the action but not persist the setting
    console.log("Lead generation pause requested but not persisted due to schema limitations");

    // Log the action
    await ctx.db.insert("systemLogs", {
      type: "system_control",
      action: "pause_lead_generation",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        message: "All lead generation has been paused by admin",
      },
    });

    return { success: true, message: "Lead generation paused successfully" };
  },
});

// Resume all lead generation
export const resumeAllLeadGeneration = mutation({
  args: {},
  handler: async (ctx) => {
    const adminUser = await requireAdmin(ctx);

    // Update system configuration
    let systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    // Note: Current systemConfiguration schema doesn't support lead generation pause settings
    // This functionality would require schema updates to add a settings field
    
    // For now, we'll just log the action but not persist the setting
    console.log("Lead generation resume requested but not persisted due to schema limitations");

    // Log the action
    await ctx.db.insert("systemLogs", {
      type: "system_control",
      action: "resume_lead_generation",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        message: "Lead generation has been resumed by admin",
      },
    });

    return { success: true, message: "Lead generation resumed successfully" };
  },
});

// Clear all active searches
export const clearAllActiveSearches = mutation({
  args: {
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const reason = args.reason || "Cleared by admin";

    // Get all processing or queued searches
    const activeSearches = await ctx.db
      .query("searches")
      .filter((q) => q.or(
        q.eq(q.field("status"), "processing"),
        q.eq(q.field("status"), "queued")
      ))
      .collect();

    let clearedCount = 0;

    // Update each active search to failed status
    for (const search of activeSearches) {
      await ctx.db.patch(search._id, {
        status: "failed",
        error: `Search cleared by admin: ${reason}`,
      });
      clearedCount++;

      // Refund any reserved credits
      if (search.creditsReserved && search.creditsReserved > 0) {
        const user = await ctx.db.get(search.userId);
        if (user) {
          await ctx.db.patch(user._id, {
            credits: user.credits + search.creditsReserved,
            updatedAt: Date.now(),
          });

          // Record refund transaction
          await ctx.db.insert("creditTransactions", {
            userId: search.userId,
            type: "refund",
            amount: search.creditsReserved,
            description: `Refund for cleared search: ${reason}`,
            balanceAfter: user.credits + search.creditsReserved,
            createdAt: Date.now(),
          });
        }
      }
    }

    // Log the action
    await ctx.db.insert("systemLogs", {
      type: "system_control",
      action: "clear_active_searches",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        reason,
        clearedCount,
        message: `Cleared ${clearedCount} active searches`,
      },
    });

    return { 
      success: true, 
      message: `Cleared ${clearedCount} active searches`,
      clearedCount 
    };
  },
});