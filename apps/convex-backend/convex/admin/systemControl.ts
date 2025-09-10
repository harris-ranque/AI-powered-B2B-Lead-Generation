import { query, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAdmin } from "../auth";

// NOTE: getSystemControlStatus and getSystemActivity have been moved to admin/queries.ts
// to match frontend expectations. Keep mutations here for logical organization.

// Pause all lead generation
export const pauseAllLeadGeneration = mutation({
  args: {
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    // Update system configuration
    let systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    if (!systemConfig) {
      // Create initial config with paused state
      const configId = await ctx.db.insert("systemConfiguration", {
        creditCosts: {
          LEAD_DISCOVERY: 1,
          EMAIL_ENRICHMENT: 1,
          AI_ANALYSIS: 2,
          EMAIL_GENERATION: 3,
          BULK_ANALYSIS: 5,
        },
        planLimits: {
          free: {
            monthlyCredits: 100,
            maxSearches: 10,
            maxLeadsPerSearch: 50,
            emailGeneration: true,
            bulkOperations: false,
            apiAccess: false,
          },
          pro: {
            monthlyCredits: 1000,
            maxSearches: 100,
            maxLeadsPerSearch: 500,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
          enterprise: {
            monthlyCredits: 10000,
            maxSearches: 1000,
            maxLeadsPerSearch: 5000,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
        },
        orchestrationSettings: {
          leadGenerationEnabled: false,
          maintenanceMode: false,
          maxConcurrentSearches: 10,
          pauseReason: args.reason || "Emergency stop by administrator",
          pausedAt: Date.now(),
          pausedBy: adminUser._id,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: adminUser._id,
      });
      
      systemConfig = await ctx.db.get(configId);
    } else {
      // Update existing config to pause
      await ctx.db.patch(systemConfig._id, {
        orchestrationSettings: {
          leadGenerationEnabled: false,
          maintenanceMode: systemConfig.orchestrationSettings?.maintenanceMode || false,
          maxConcurrentSearches: systemConfig.orchestrationSettings?.maxConcurrentSearches || 10,
          pauseReason: args.reason || "Emergency stop by administrator",
          pausedAt: Date.now(),
          pausedBy: adminUser._id,
        },
        updatedAt: Date.now(),
        updatedBy: adminUser._id,
      });
    }

    // Cancel all active searches
    const activeSearches = await ctx.db
      .query("searches")
      .filter((q) => 
        q.or(
          q.eq(q.field("status"), "in_progress"),
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "processing")
        )
      )
      .collect();

    let totalRefunded = 0;
    
    for (const search of activeSearches) {
      await ctx.db.patch(search._id, {
        status: "cancelled",
        error: "Lead generation paused by administrator",
        completedAt: Date.now(),
      });

      // Refund credits if any were used
      if (search.creditsUsed && search.creditsUsed > 0) {
        const refundResult = await ctx.runMutation(internal.credits.transactions.refundCredits, {
          userId: search.userId,
          amount: search.creditsUsed,
          reason: "Search cancelled due to emergency stop",
          relatedEntityType: "search",
          relatedEntityId: search._id,
        });
        
        if (refundResult.success) {
          totalRefunded += search.creditsUsed;
        }
      }
    }

    // Log the action
    await ctx.db.insert("systemLogs", {
      type: "system_control",
      action: "pause_lead_generation",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        message: "All lead generation has been paused by admin",
        reason: args.reason || "Emergency stop by administrator",
        cancelledSearches: activeSearches.length,
        creditsRefunded: totalRefunded,
        adminName: adminUser.name || adminUser.email,
      },
    });

    return { 
      success: true, 
      message: "Lead generation paused successfully",
      cancelledSearches: activeSearches.length,
      creditsRefunded: totalRefunded,
    };
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

    if (!systemConfig) {
      // Create initial config with enabled state
      const configId = await ctx.db.insert("systemConfiguration", {
        creditCosts: {
          LEAD_DISCOVERY: 1,
          EMAIL_ENRICHMENT: 1,
          AI_ANALYSIS: 2,
          EMAIL_GENERATION: 3,
          BULK_ANALYSIS: 5,
        },
        planLimits: {
          free: {
            monthlyCredits: 100,
            maxSearches: 10,
            maxLeadsPerSearch: 50,
            emailGeneration: true,
            bulkOperations: false,
            apiAccess: false,
          },
          pro: {
            monthlyCredits: 1000,
            maxSearches: 100,
            maxLeadsPerSearch: 500,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
          enterprise: {
            monthlyCredits: 10000,
            maxSearches: 1000,
            maxLeadsPerSearch: 5000,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
        },
        orchestrationSettings: {
          leadGenerationEnabled: true,
          maintenanceMode: false,
          maxConcurrentSearches: 10,
          pauseReason: undefined,
          pausedAt: undefined,
          pausedBy: undefined,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: adminUser._id,
      });
    } else {
      // Update existing config to resume
      await ctx.db.patch(systemConfig._id, {
        orchestrationSettings: {
          leadGenerationEnabled: true,
          maintenanceMode: systemConfig.orchestrationSettings?.maintenanceMode || false,
          maxConcurrentSearches: systemConfig.orchestrationSettings?.maxConcurrentSearches || 10,
          pauseReason: undefined,
          pausedAt: undefined,
          pausedBy: undefined,
        },
        updatedAt: Date.now(),
        updatedBy: adminUser._id,
      });
    }

    // Log the action
    await ctx.db.insert("systemLogs", {
      type: "system_control",
      action: "resume_lead_generation",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        message: "Lead generation has been resumed by admin",
        adminName: adminUser.name || adminUser.email,
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