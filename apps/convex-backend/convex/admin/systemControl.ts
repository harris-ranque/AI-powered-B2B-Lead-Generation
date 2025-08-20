import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError, isAdmin } from "../lib/helpers";

/**
 * System Control Functions - Emergency admin controls for lead generation system
 */

// Get system emergency controls status
export const getSystemControlStatus = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const controlState = await ctx.db
      .query("systemControlState")
      .unique();

    return {
      systemPaused: controlState?.systemPaused || false,
      leadGenerationDisabled: controlState?.leadGenerationDisabled || false,
      maintenanceMode: controlState?.maintenanceMode || false,
      pausedAt: controlState?.pausedAt || null,
      pausedBy: controlState?.pausedBy || null,
      reason: controlState?.reason || null,
      lastUpdated: controlState?.updatedAt || null,
    };
  },
});

// Emergency pause all lead generation activities
export const pauseAllLeadGeneration = mutation({
  args: {
    reason: v.optional(v.string()),
    maintenanceMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const reason = args.reason || "Emergency pause by admin";
    const maintenanceMode = args.maintenanceMode || false;

    // Check if system is already paused
    const existingState = await ctx.db
      .query("systemControlState")
      .unique();

    if (existingState?.systemPaused) {
      return { 
        success: false, 
        message: "System is already paused",
        pausedBy: existingState.pausedBy,
        pausedAt: existingState.pausedAt 
      };
    }

    // Cancel all in-progress searches
    const activeSearches = await ctx.db
      .query("searches")
      .filter((q) => q.or(
        q.eq(q.field("status"), "pending"),
        q.eq(q.field("status"), "in_progress"),
        q.eq(q.field("status"), "google_maps"),
        q.eq(q.field("status"), "enriching"),
        q.eq(q.field("status"), "ai_analysis")
      ))
      .collect();

    let cancelledSearches = 0;
    for (const search of activeSearches) {
      await ctx.db.patch(search._id, {
        status: "cancelled",
        errorMessage: `System paused by admin: ${reason}`,
        completedAt: now,
        updatedAt: now,
      });

      // Refund reserved credits
      if (search.creditsReserved && search.creditsReserved > 0) {
        const user = await ctx.db.get(search.userId);
        if (user) {
          await ctx.db.patch(search.userId, {
            credits: user.credits + search.creditsReserved,
            updatedAt: now,
          });

          // Record refund transaction
          await ctx.db.insert("creditTransactions", {
            userId: search.userId,
            type: "refund",
            amount: search.creditsReserved,
            description: `Refund for cancelled search due to system pause: ${reason}`,
            balanceAfter: user.credits + search.creditsReserved,
            createdAt: now,
          });
        }
      }

      cancelledSearches++;
    }

    // Clear all batch queues
    const batchQueues = await ctx.db.query("batchPlans").collect();
    let clearedBatches = 0;
    for (const batch of batchQueues) {
      await ctx.db.delete(batch._id);
      clearedBatches++;
    }

    // Update or create system control state
    if (existingState) {
      await ctx.db.patch(existingState._id, {
        systemPaused: true,
        leadGenerationDisabled: true,
        maintenanceMode,
        pausedAt: now,
        pausedBy: currentUser._id,
        reason,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("systemControlState", {
        systemPaused: true,
        leadGenerationDisabled: true,
        maintenanceMode,
        pausedAt: now,
        pausedBy: currentUser._id,
        reason,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Log the emergency action
    await ctx.db.insert("systemLogs", {
      type: "emergency_action",
      action: "pause_all_lead_generation",
      userId: currentUser._id,
      data: {
        reason,
        maintenanceMode,
        cancelledSearches,
        clearedBatches,
        activeSearchesFound: activeSearches.length,
      },
      timestamp: now,
    });

    // Send notifications to all active users
    const activeUsers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const notificationTitle = maintenanceMode 
      ? "System Maintenance" 
      : "Lead Generation Paused";
    
    const notificationMessage = maintenanceMode
      ? "System is temporarily under maintenance. All active searches have been paused and credits refunded."
      : `Lead generation has been temporarily paused by administrators. Reason: ${reason}. All active searches have been cancelled and credits refunded.`;

    for (const user of activeUsers) {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: notificationTitle,
        message: notificationMessage,
        data: { 
          systemPaused: true,
          reason,
          maintenanceMode,
          pausedAt: now,
        },
        read: false,
        sent: false,
        createdAt: now,
      });
    }

    return { 
      success: true, 
      cancelledSearches,
      clearedBatches,
      notifiedUsers: activeUsers.length,
      pausedAt: now,
    };
  },
});

// Resume all lead generation activities
export const resumeAllLeadGeneration = mutation({
  args: {
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const reason = args.reason || "System resumed by admin";

    // Check if system is actually paused
    const controlState = await ctx.db
      .query("systemControlState")
      .unique();

    if (!controlState?.systemPaused) {
      return { 
        success: false, 
        message: "System is not currently paused"
      };
    }

    // Update system control state
    await ctx.db.patch(controlState._id, {
      systemPaused: false,
      leadGenerationDisabled: false,
      maintenanceMode: false,
      resumedAt: now,
      resumedBy: currentUser._id,
      resumeReason: reason,
      updatedAt: now,
    });

    // Log the resume action
    await ctx.db.insert("systemLogs", {
      type: "emergency_action",
      action: "resume_all_lead_generation",
      userId: currentUser._id,
      data: {
        reason,
        pausedDuration: now - controlState.pausedAt,
        pausedBy: controlState.pausedBy,
        originalPauseReason: controlState.reason,
      },
      timestamp: now,
    });

    // Send notifications to all active users
    const activeUsers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    for (const user of activeUsers) {
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Lead Generation Resumed",
        message: `Lead generation has been resumed. You can now create new searches. Reason: ${reason}`,
        data: { 
          systemPaused: false,
          reason,
          resumedAt: now,
        },
        read: false,
        sent: false,
        createdAt: now,
      });
    }

    return { 
      success: true, 
      notifiedUsers: activeUsers.length,
      resumedAt: now,
      pausedDuration: now - controlState.pausedAt,
    };
  },
});

// Clear all active searches (emergency clear)
export const clearAllActiveSearches = mutation({
  args: {
    reason: v.string(),
    refundCredits: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const refundCredits = args.refundCredits !== false; // Default to true

    // Get all active searches
    const activeSearches = await ctx.db
      .query("searches")
      .filter((q) => q.or(
        q.eq(q.field("status"), "pending"),
        q.eq(q.field("status"), "in_progress"),
        q.eq(q.field("status"), "google_maps"),
        q.eq(q.field("status"), "enriching"),
        q.eq(q.field("status"), "ai_analysis")
      ))
      .collect();

    let clearedSearches = 0;
    let totalCreditsRefunded = 0;

    for (const search of activeSearches) {
      // Update search status
      await ctx.db.patch(search._id, {
        status: "cancelled",
        errorMessage: `Cleared by admin: ${args.reason}`,
        completedAt: now,
        updatedAt: now,
      });

      // Refund reserved credits if requested
      if (refundCredits && search.creditsReserved && search.creditsReserved > 0) {
        const user = await ctx.db.get(search.userId);
        if (user) {
          await ctx.db.patch(search.userId, {
            credits: user.credits + search.creditsReserved,
            updatedAt: now,
          });

          // Record refund transaction
          await ctx.db.insert("creditTransactions", {
            userId: search.userId,
            type: "refund",
            amount: search.creditsReserved,
            description: `Refund for cleared search: ${args.reason}`,
            balanceAfter: user.credits + search.creditsReserved,
            createdAt: now,
          });

          totalCreditsRefunded += search.creditsReserved;
        }
      }

      clearedSearches++;
    }

    // Clear batch queues and processing records
    const batchPlans = await ctx.db.query("batchPlans").collect();
    const searchBatches = await ctx.db.query("searchBatches").collect();
    
    for (const batch of batchPlans) {
      await ctx.db.delete(batch._id);
    }
    
    for (const batch of searchBatches) {
      await ctx.db.delete(batch._id);
    }

    // Log the clear action
    await ctx.db.insert("systemLogs", {
      type: "emergency_action",
      action: "clear_all_active_searches",
      userId: currentUser._id,
      data: {
        reason: args.reason,
        clearedSearches,
        totalCreditsRefunded,
        refundCredits,
        batchPlansCleared: batchPlans.length,
        searchBatchesCleared: searchBatches.length,
      },
      timestamp: now,
    });

    return { 
      success: true, 
      clearedSearches,
      totalCreditsRefunded,
      batchesCleared: batchPlans.length + searchBatches.length,
    };
  },
});

// Get system activity statistics for monitoring
export const getSystemActivity = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Get active searches by status
    const searches = await ctx.db.query("searches").collect();
    
    const activeSearches = searches.filter(s => 
      s.status === "pending" || s.status === "in_progress" || 
      s.status === "google_maps" || s.status === "enriching" || s.status === "ai_analysis"
    );
    
    const recentSearches = searches.filter(s => s.startedAt && s.startedAt > oneHourAgo);
    const todaysSearches = searches.filter(s => s.startedAt && s.startedAt > oneDayAgo);

    // Get batch queue status
    const batchPlans = await ctx.db.query("batchPlans").collect();
    const searchBatches = await ctx.db.query("searchBatches").collect();

    // Get recent system logs
    const recentLogs = await ctx.db
      .query("systemLogs")
      .filter((q) => q.gt(q.field("timestamp"), oneHourAgo))
      .order("desc")
      .take(10);

    return {
      activeSearches: {
        total: activeSearches.length,
        byStatus: {
          pending: activeSearches.filter(s => s.status === "pending").length,
          in_progress: activeSearches.filter(s => s.status === "in_progress").length,
          google_maps: activeSearches.filter(s => s.status === "google_maps").length,
          enriching: activeSearches.filter(s => s.status === "enriching").length,
          ai_analysis: activeSearches.filter(s => s.status === "ai_analysis").length,
        },
      },
      searchActivity: {
        lastHour: recentSearches.length,
        last24Hours: todaysSearches.length,
      },
      queueStatus: {
        batchPlans: batchPlans.length,
        searchBatches: searchBatches.length,
      },
      recentLogs,
      timestamp: now,
    };
  },
});