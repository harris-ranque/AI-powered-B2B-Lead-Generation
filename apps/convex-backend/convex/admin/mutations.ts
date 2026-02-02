import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAdmin } from "../auth";

// Constants for query limits
const MAX_ITERATION_COUNT = 100000;
const DEFAULT_EXPORT_LIMIT = 10000;
const BATCH_DELETE_SIZE = 100;

// Update user status (suspend/reactivate)
export const updateUserStatus = mutation({
  args: {
    userId: v.id("users"),
    isActive: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new Error("User not found");
    }

    // Cannot suspend another admin
    if (!args.isActive && targetUser.role === "admin") {
      throw new Error("Cannot suspend admin users");
    }

    await ctx.db.patch(args.userId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: args.isActive ? "Account Reactivated" : "Account Suspended",
      message: args.isActive
        ? "Your account has been reactivated. You can now access all features of Genni."
        : `Your account has been suspended. ${args.reason ? `Reason: ${args.reason}. ` : ""}Please contact support if you believe this is an error.`,
      data: {
        reason: args.reason,
        statusChange: args.isActive ? "reactivated" : "suspended",
        timestamp: Date.now(),
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Update user plan
export const updateUserPlan = mutation({
  args: {
    userId: v.id("users"),
    plan: v.union(
      v.literal("starter"),
      v.literal("professional"),
      v.literal("business"),
      v.literal("enterprise"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new Error("User not found");
    }

    const oldPlan = targetUser.plan;

    await ctx.db.patch(args.userId, {
      plan: args.plan,
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Plan Updated",
      message: `Your plan has been updated from ${oldPlan} to ${args.plan} by an administrator.`,
      data: {
        oldPlan,
        newPlan: args.plan,
        updatedBy: "admin",
        timestamp: Date.now(),
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Add credits to user account
export const addUserCredits = mutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new Error("User not found");
    }

    if (args.amount <= 0) {
      throw new Error("Credit amount must be positive");
    }

    const newBalance = targetUser.credits + args.amount;

    // Update user credits
    await ctx.db.patch(args.userId, {
      credits: newBalance,
      updatedAt: Date.now(),
    });

    // Record transaction
    await ctx.db.insert("creditTransactions", {
      userId: args.userId,
      type: "bonus",
      amount: args.amount,
      description: `Admin bonus: ${args.reason}`,
      balanceAfter: newBalance,
      createdAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Credits Added",
      message: `You've been awarded ${args.amount} bonus credits! Reason: ${args.reason}`,
      data: {
        creditsAdded: args.amount,
        newBalance,
        reason: args.reason,
        addedBy: adminUser._id,
        awardedBy: adminUser._id,
        timestamp: Date.now(),
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true, newBalance };
  },
});

/**
 * Export users data - OPTIMIZED VERSION
 * Uses indexes and streaming with limits to avoid memory issues
 */
export const exportUsers = mutation({
  args: {
    format: v.union(v.literal("csv"), v.literal("json")),
    filters: v.optional(
      v.object({
        plan: v.optional(
          v.union(
            v.literal("starter"),
            v.literal("professional"),
            v.literal("business"),
            v.literal("enterprise"),
          ),
        ),
        role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
        isActive: v.optional(v.boolean()),
      }),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const exportLimit = Math.min(args.limit || DEFAULT_EXPORT_LIMIT, DEFAULT_EXPORT_LIMIT);

    // Build query with appropriate index
    let query;
    if (args.filters?.plan !== undefined) {
      query = ctx.db
        .query("users")
        .withIndex("by_plan", (q) => q.eq("plan", args.filters!.plan!));
    } else if (args.filters?.isActive !== undefined) {
      query = ctx.db
        .query("users")
        .withIndex("by_active", (q) => q.eq("isActive", args.filters!.isActive!));
    } else {
      query = ctx.db.query("users");
    }

    // Stream users with limit and filter
    const sanitizedUsers: Array<{
      id: string;
      email: string;
      name: string | undefined;
      plan: string;
      role: string;
      credits: number;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }> = [];

    let processed = 0;
    for await (const user of query) {
      // Apply additional filters that couldn't use index
      if (args.filters?.role && user.role !== args.filters.role) continue;
      if (args.filters?.plan && user.plan !== args.filters.plan) continue;
      if (args.filters?.isActive !== undefined && user.isActive !== args.filters.isActive) continue;

      sanitizedUsers.push({
        id: user._id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        role: user.role,
        credits: user.credits,
        isActive: user.isActive,
        createdAt: new Date(user.createdAt).toISOString(),
        updatedAt: new Date(user.updatedAt || user.createdAt).toISOString(),
      });

      processed++;
      if (processed >= exportLimit || processed >= MAX_ITERATION_COUNT) break;
    }

    let exportData: string;

    if (args.format === "csv") {
      // Convert to CSV
      const headers = sanitizedUsers.length > 0 && sanitizedUsers[0]
        ? Object.keys(sanitizedUsers[0])
        : ["id", "email", "name", "plan", "role", "credits", "isActive", "createdAt", "updatedAt"];
      const csvContent = [
        headers.join(","),
        ...sanitizedUsers.map((user) =>
          headers
            .map((header) =>
              typeof user[header as keyof typeof user] === "string"
                ? `"${user[header as keyof typeof user]}"`
                : user[header as keyof typeof user],
            )
            .join(","),
        ),
      ].join("\n");
      exportData = csvContent;
    } else {
      // JSON format
      exportData = JSON.stringify(sanitizedUsers, null, 2);
    }

    return {
      data: exportData,
      count: sanitizedUsers.length,
      timestamp: Date.now(),
      hasMore: processed >= exportLimit,
    };
  },
});

// Note: Admin settings functionality removed due to schema incompatibility
// Current systemConfiguration schema only supports creditCosts and planLimits
// Would need schema update to add flexible settings field for admin configuration

/**
 * Reset system cache by clearing provider caches - OPTIMIZED VERSION
 * Uses batch deletion with iteration safeguards
 */
export const resetSystemCache = mutation({
  args: {},
  handler: async (ctx) => {
    const adminUser = await requireAdmin(ctx);

    const cacheTables = [
      {
        table: "findymailDomainCache" as const,
        label: "findymailDomainCache",
      },
      { table: "enrichmentCache" as const, label: "enrichmentCache" },
    ];

    const clearedCaches: Array<{ table: string; cleared: number; limitReached: boolean }> = [];

    for (const { table, label } of cacheTables) {
      let cleared = 0;
      let iterations = 0;
      const maxIterations = MAX_ITERATION_COUNT / BATCH_DELETE_SIZE;

      // Delete in batches with iteration safeguard
      while (iterations < maxIterations) {
        const batch = await ctx.db.query(table).take(BATCH_DELETE_SIZE);
        if (batch.length === 0) {
          break;
        }
        for (const record of batch) {
          await ctx.db.delete(record._id);
        }
        cleared += batch.length;
        iterations++;
      }

      clearedCaches.push({
        table: label,
        cleared,
        limitReached: iterations >= maxIterations,
      });
    }

    const totalCleared = clearedCaches.reduce((sum, entry) => sum + entry.cleared, 0);
    const anyLimitReached = clearedCaches.some((entry) => entry.limitReached);
    const timestamp = Date.now();

    // Log the cache reset
    await ctx.db.insert("systemLogs", {
      type: "system_maintenance",
      action: "cache_reset",
      userId: adminUser._id,
      timestamp,
      data: {
        message: anyLimitReached
          ? "System cache partially reset (iteration limit reached)"
          : "System cache has been reset",
        clearedCaches,
        totalCleared,
      },
    });

    return {
      success: true,
      message:
        totalCleared > 0
          ? `System cache reset completed (${totalCleared} entries cleared)${anyLimitReached ? " - some tables hit limit, run again if needed" : ""}`
          : "System cache reset completed",
      clearedCaches,
      totalCleared,
      anyLimitReached,
    };
  },
});

/**
 * Run system maintenance - OPTIMIZED VERSION
 * All loops have iteration safeguards to prevent runaway execution
 */
export const runSystemMaintenance = mutation({
  args: {
    tasks: v.array(
      v.union(
        v.literal("cleanup_old_logs"),
        v.literal("optimize_database"),
        v.literal("reset_rate_limits"),
        v.literal("cleanup_expired_sessions"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const results: Array<Record<string, unknown>> = [];
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const reservationRetentionMs = 30 * 24 * 60 * 60 * 1000;
    const langgraphRetentionMs = 30 * 24 * 60 * 60 * 1000;
    const rateLimitRetentionMs = 24 * 60 * 60 * 1000;
    const maxIterations = MAX_ITERATION_COUNT / BATCH_DELETE_SIZE;

    for (const task of args.tasks) {
      try {
        switch (task) {
          case "cleanup_old_logs":
            {
              // Delete old system logs in batches using timestamp index
              let deletedLogs = 0;
              let iterations = 0;
              while (iterations < maxIterations) {
                const batch = await ctx.db
                  .query("systemLogs")
                  .withIndex("by_timestamp", (q) => q.lt("timestamp", thirtyDaysAgo))
                  .take(BATCH_DELETE_SIZE);

                if (batch.length === 0) {
                  break;
                }

                for (const log of batch) {
                  await ctx.db.delete(log._id);
                }
                deletedLogs += batch.length;
                iterations++;
              }

              results.push({
                task,
                success: true,
                deletedCount: deletedLogs,
                limitReached: iterations >= maxIterations,
              });
            }
            break;

          case "reset_rate_limits":
            {
              // Clear rate limit records and violations outside the active window
              let clearedRateLimits = 0;
              let rateLimitIterations = 0;
              while (rateLimitIterations < maxIterations) {
                const batch = await ctx.db
                  .query("rateLimitRecords")
                  .withIndex("by_window", (q) => q.lt("windowStart", now - rateLimitRetentionMs))
                  .take(BATCH_DELETE_SIZE);

                if (batch.length === 0) {
                  break;
                }

                for (const record of batch) {
                  await ctx.db.delete(record._id);
                }
                clearedRateLimits += batch.length;
                rateLimitIterations++;
              }

              let clearedViolations = 0;
              let violationIterations = 0;
              while (violationIterations < maxIterations) {
                const batch = await ctx.db
                  .query("rateLimitViolations")
                  .withIndex("by_timestamp", (q) => q.lt("timestamp", thirtyDaysAgo))
                  .take(BATCH_DELETE_SIZE);

                if (batch.length === 0) {
                  break;
                }

                for (const violation of batch) {
                  await ctx.db.delete(violation._id);
                }
                clearedViolations += batch.length;
                violationIterations++;
              }

              results.push({
                task,
                success: true,
                clearedRateLimits,
                clearedViolations,
                limitReached:
                  rateLimitIterations >= maxIterations ||
                  violationIterations >= maxIterations,
              });
            }
            break;

          case "optimize_database":
            {
              let expiredReservations = 0;
              let removedReservations = 0;
              let totalIterations = 0;

              // Mark any lingering pending reservations as rolled back
              let expireIterations = 0;
              while (expireIterations < maxIterations) {
                const batch = await ctx.db
                  .query("creditReservations")
                  .withIndex("by_status", (q) => q.eq("status", "pending"))
                  .filter((q) => q.lt(q.field("expiresAt"), now))
                  .take(BATCH_DELETE_SIZE);

                if (batch.length === 0) {
                  break;
                }

                for (const reservation of batch) {
                  await ctx.db.patch(reservation._id, {
                    status: "rolled_back",
                    completedAt: now,
                  });
                  expiredReservations += 1;
                }
                expireIterations++;
              }
              totalIterations += expireIterations;

              const reservationStatusesToPurge = ["rolled_back", "committed"] as const;
              for (const status of reservationStatusesToPurge) {
                let statusIterations = 0;
                while (statusIterations < maxIterations / 2) {
                  const batch = await ctx.db
                    .query("creditReservations")
                    .withIndex("by_status", (q) => q.eq("status", status))
                    .filter((q) => q.lt(q.field("expiresAt"), now - reservationRetentionMs))
                    .take(BATCH_DELETE_SIZE);

                  if (batch.length === 0) {
                    break;
                  }

                  let deletedInBatch = 0;
                  for (const reservation of batch) {
                    const completedAt = reservation.completedAt ?? reservation.createdAt;
                    if (completedAt <= now - reservationRetentionMs) {
                      await ctx.db.delete(reservation._id);
                      removedReservations += 1;
                      deletedInBatch += 1;
                    }
                  }

                  if (deletedInBatch === 0) {
                    break;
                  }
                  statusIterations++;
                }
                totalIterations += statusIterations;
              }

              // Remove stale LangGraph request history beyond retention window
              let removedLanggraphRequests = 0;
              const staleStatuses = ["completed", "failed"] as const;
              for (const status of staleStatuses) {
                let lgIterations = 0;
                while (lgIterations < maxIterations / 2) {
                  const batch = await ctx.db
                    .query("langgraphRequests")
                    .withIndex("by_status", (q) => q.eq("status", status))
                    .filter((q) => q.lt(q.field("createdAt"), now - langgraphRetentionMs))
                    .take(BATCH_DELETE_SIZE);

                  if (batch.length === 0) {
                    break;
                  }

                  let deletedInBatch = 0;
                  for (const request of batch) {
                    await ctx.db.delete(request._id);
                    removedLanggraphRequests += 1;
                    deletedInBatch += 1;
                  }

                  if (deletedInBatch === 0) {
                    break;
                  }
                  lgIterations++;
                }
                totalIterations += lgIterations;
              }

              results.push({
                task,
                success: true,
                expiredReservations,
                removedReservations,
                removedLanggraphRequests,
                limitReached: totalIterations >= maxIterations,
              });
            }
            break;

          case "cleanup_expired_sessions":
            {
              const cacheTables = [
                {
                  table: "findymailDomainCache" as const,
                  label: "findymailDomainCache",
                },
                { table: "enrichmentCache" as const, label: "enrichmentCache" },
              ];

              const cacheResults: Array<{ table: string; cleared: number; limitReached: boolean }> = [];

              for (const { table, label } of cacheTables) {
                let cleared = 0;
                let cacheIterations = 0;
                while (cacheIterations < maxIterations / 2) {
                  const batch = await ctx.db
                    .query(table)
                    .withIndex("by_expires", (q) => q.lt("expiresAt", now))
                    .take(BATCH_DELETE_SIZE);

                  if (batch.length === 0) {
                    break;
                  }

                  for (const record of batch) {
                    await ctx.db.delete(record._id);
                  }
                  cleared += batch.length;
                  cacheIterations++;
                }

                cacheResults.push({
                  table: label,
                  cleared,
                  limitReached: cacheIterations >= maxIterations / 2,
                });
              }

              let expiredReservations = 0;
              let resIterations = 0;
              while (resIterations < maxIterations) {
                const batch = await ctx.db
                  .query("creditReservations")
                  .withIndex("by_status", (q) => q.eq("status", "pending"))
                  .filter((q) => q.lt(q.field("expiresAt"), now))
                  .take(BATCH_DELETE_SIZE);

                if (batch.length === 0) {
                  break;
                }

                for (const reservation of batch) {
                  await ctx.db.patch(reservation._id, {
                    status: "rolled_back",
                    completedAt: now,
                  });
                  expiredReservations += 1;
                }
                resIterations++;
              }

              results.push({
                task,
                success: true,
                cacheResults,
                expiredReservations,
                limitReached:
                  resIterations >= maxIterations ||
                  cacheResults.some((r) => r.limitReached),
              });
            }
            break;

          default:
            results.push({ task, success: false, error: "Unknown task" });
        }
      } catch (error) {
        results.push({ task, success: false, error: String(error) });
      }
    }

    // Log the maintenance run
    await ctx.db.insert("systemLogs", {
      type: "system_maintenance",
      action: "maintenance_run",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        tasks: args.tasks,
        results,
      },
    });

    return { success: true, results };
  },
});

// Update admin settings and synchronize key system configuration flags
export const updateAdminSettings = mutation({
  args: {
    settings: v.object({
      maintenanceMode: v.optional(v.boolean()),
      systemNotifications: v.optional(v.boolean()),
      debugMode: v.optional(v.boolean()),
      rateLimitEnabled: v.optional(v.boolean()),
      registrationEnabled: v.optional(v.boolean()),
      maxDailySearches: v.optional(v.number()),
      systemMessage: v.optional(v.string()),
      creditCosts: v.optional(
        v.object({
          LEAD_DISCOVERY: v.optional(v.number()),
          EMAIL_ENRICHMENT: v.optional(v.number()),
          AI_ANALYSIS: v.optional(v.number()),
          EMAIL_GENERATION: v.optional(v.number()),
          BULK_ANALYSIS: v.optional(v.number()),
        }),
      ),
      planLimits: v.optional(
        v.object({
          free: v.optional(
            v.object({
              monthlyCredits: v.optional(v.number()),
              maxSearches: v.optional(v.number()),
              maxLeadsPerSearch: v.optional(v.number()),
              emailGeneration: v.optional(v.boolean()),
              bulkOperations: v.optional(v.boolean()),
              apiAccess: v.optional(v.boolean()),
            }),
          ),
          pro: v.optional(
            v.object({
              monthlyCredits: v.optional(v.number()),
              maxSearches: v.optional(v.number()),
              maxLeadsPerSearch: v.optional(v.number()),
              emailGeneration: v.optional(v.boolean()),
              bulkOperations: v.optional(v.boolean()),
              apiAccess: v.optional(v.boolean()),
            }),
          ),
          enterprise: v.optional(
            v.object({
              monthlyCredits: v.optional(v.number()),
              maxSearches: v.optional(v.number()),
              maxLeadsPerSearch: v.optional(v.number()),
              emailGeneration: v.optional(v.boolean()),
              bulkOperations: v.optional(v.boolean()),
              apiAccess: v.optional(v.boolean()),
            }),
          ),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);
    const now = Date.now();

    const existingSettings = await ctx.db.query("adminSettings").unique();
    const defaults = {
      maintenanceMode: false,
      systemNotifications: true,
      debugMode: false,
      rateLimitEnabled: true,
      registrationEnabled: true,
      maxDailySearches: 100,
      systemMessage: "",
    } as const;

    const maintenanceMode =
      args.settings.maintenanceMode ??
      existingSettings?.maintenanceMode ??
      defaults.maintenanceMode;
    const systemNotifications =
      args.settings.systemNotifications ??
      existingSettings?.systemNotifications ??
      defaults.systemNotifications;
    const debugMode =
      args.settings.debugMode ?? existingSettings?.debugMode ?? defaults.debugMode;
    const rateLimitEnabled =
      args.settings.rateLimitEnabled ??
      existingSettings?.rateLimitEnabled ??
      defaults.rateLimitEnabled;
    const registrationEnabled =
      args.settings.registrationEnabled ??
      existingSettings?.registrationEnabled ??
      defaults.registrationEnabled;
    const maxDailySearches =
      args.settings.maxDailySearches !== undefined
        ? args.settings.maxDailySearches
        : existingSettings?.maxDailySearches ?? defaults.maxDailySearches;
    const systemMessage =
      args.settings.systemMessage !== undefined
        ? args.settings.systemMessage
        : existingSettings?.systemMessage ?? defaults.systemMessage;

    const settingsToPersist = {
      maintenanceMode,
      systemNotifications,
      debugMode,
      rateLimitEnabled,
      registrationEnabled,
      maxDailySearches,
      systemMessage,
      updatedAt: now,
      updatedBy: adminUser._id,
    };

    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, settingsToPersist);
    } else {
      await ctx.db.insert("adminSettings", settingsToPersist);
    }

    // Ensure system configuration exists for dependent settings
    let systemConfig = await ctx.db.query("systemConfiguration").unique();

    if (!systemConfig) {
      const configId = await ctx.db.insert("systemConfiguration", {
        creditCosts: {
          LEAD_DISCOVERY: 1,
          EMAIL_ENRICHMENT: 2,
          AI_ANALYSIS: 3,
          EMAIL_GENERATION: 5,
          BULK_ANALYSIS: 10,
        },
        planLimits: {
          free: {
            monthlyCredits: 100,
            maxSearches: 10,
            maxLeadsPerSearch: 50,
            emailGeneration: false,
            bulkOperations: false,
            apiAccess: false,
          },
          pro: {
            monthlyCredits: 1000,
            maxSearches: 100,
            maxLeadsPerSearch: 200,
            emailGeneration: true,
            bulkOperations: false,
            apiAccess: true,
          },
          enterprise: {
            monthlyCredits: 10000,
            maxSearches: 1000,
            maxLeadsPerSearch: 1000,
            emailGeneration: true,
            bulkOperations: true,
            apiAccess: true,
          },
        },
        orchestrationSettings: {
          leadGenerationEnabled: true,
          maintenanceMode,
          maxConcurrentSearches: 10,
          pauseReason: undefined,
          pausedAt: undefined,
          pausedBy: undefined,
        },
        createdAt: now,
        updatedAt: now,
        updatedBy: adminUser._id,
      });

      systemConfig = await ctx.db.get(configId);
    }

    if (!systemConfig) {
      throw new Error("Failed to load system configuration");
    }

    const configUpdates: Record<string, any> = {
      updatedAt: now,
      updatedBy: adminUser._id,
    };
    let shouldPatchConfig = false;

    if (args.settings.creditCosts) {
      configUpdates.creditCosts = {
        ...systemConfig.creditCosts,
        ...args.settings.creditCosts,
      };
      shouldPatchConfig = true;
    }

    if (args.settings.planLimits) {
      configUpdates.planLimits = {
        ...systemConfig.planLimits,
        ...args.settings.planLimits,
      };
      shouldPatchConfig = true;
    }

    const existingOrchestration =
      systemConfig.orchestrationSettings ?? {
        leadGenerationEnabled: true,
        maintenanceMode: false,
        maxConcurrentSearches: 10,
        pauseReason: undefined,
        pausedAt: undefined,
        pausedBy: undefined,
      };

    if (
      args.settings.maintenanceMode !== undefined ||
      !systemConfig.orchestrationSettings ||
      existingOrchestration.maintenanceMode !== maintenanceMode
    ) {
      configUpdates.orchestrationSettings = {
        ...existingOrchestration,
        maintenanceMode,
      };
      shouldPatchConfig = true;
    }

    if (shouldPatchConfig) {
      await ctx.db.patch(systemConfig._id, configUpdates);
    }

    await ctx.db.insert("systemLogs", {
      type: "admin_settings",
      action: "update_settings",
      userId: adminUser._id,
      timestamp: now,
      data: {
        updatedSettings: args.settings,
        persistedSettings: settingsToPersist,
      },
    });

    return { success: true };
  },
});

// Pause enrichment for a specific search
export const pauseSearchEnrichment = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    await ctx.db.patch(args.searchId, {
      enrichmentPaused: true,
      pausedBy: adminUser._id,
      pausedAt: Date.now(),
    });

    // Log the pause action
    await ctx.db.insert("systemLogs", {
      type: "admin_enrichment_control",
      action: "pause_enrichment",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        searchId: args.searchId,
        searchName: search.name,
        userId: search.userId,
      },
    });

    return { success: true };
  },
});

// Resume enrichment for a specific search
export const resumeSearchEnrichment = mutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    await ctx.db.patch(args.searchId, {
      enrichmentPaused: false,
      pausedBy: undefined,
      pausedAt: undefined,
    });

    // Log the resume action
    await ctx.db.insert("systemLogs", {
      type: "admin_enrichment_control",
      action: "resume_enrichment",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        searchId: args.searchId,
        searchName: search.name,
        userId: search.userId,
      },
    });

    return { success: true };
  },
});

/**
 * Recovery function for stuck enrichment pipeline - OPTIMIZED VERSION
 * Uses streaming with limits instead of .collect()
 */
export const recoverStuckEnrichment = mutation({
  args: {
    searchId: v.id("searches"),
    apiKeyHash: v.optional(v.string()), // Optional: specific API key hash to reset
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const results: {
      slotsReleased: number;
      leadsRequeued: number;
      analysisTriggered: boolean;
      leadsProcessed: number;
    } = {
      slotsReleased: 0,
      leadsRequeued: 0,
      analysisTriggered: false,
      leadsProcessed: 0,
    };

    // 1. Stream leads and find stuck ones
    let allEnrichmentComplete = true;
    let analysisAlreadyTriggered = false;
    const leadsToAnalyze: Array<{ _id: any }> = [];
    let processed = 0;

    for await (const lead of ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))) {
      processed++;

      // Reset stuck in_progress leads back to pending
      if (lead.enrichmentStatus === "in_progress") {
        await ctx.db.patch(lead._id, {
          enrichmentStatus: "pending",
          enrichmentQueuedAt: Date.now(),
          updatedAt: Date.now(),
        });
        results.leadsRequeued++;
      }

      // Track enrichment completion status
      if (
        lead.enrichmentStatus !== "completed" &&
        lead.enrichmentStatus !== "completed_fallback" &&
        lead.enrichmentStatus !== "no_contacts_found" &&
        lead.enrichmentStatus !== "failed"
      ) {
        allEnrichmentComplete = false;
      }

      // Track analysis status
      if (
        lead.analysisStatus === "scheduled" ||
        lead.analysisStatus === "processing" ||
        lead.analysisStatus === "completed"
      ) {
        analysisAlreadyTriggered = true;
      }

      // Track leads ready for analysis
      if (
        lead.enrichmentStatus === "completed" ||
        lead.enrichmentStatus === "completed_fallback"
      ) {
        leadsToAnalyze.push({ _id: lead._id });
      }

      if (processed >= MAX_ITERATION_COUNT) break;
    }
    results.leadsProcessed = processed;

    // 2. Clear semaphore slots if apiKeyHash provided
    if (args.apiKeyHash) {
      const apiKeyHashValue = args.apiKeyHash;
      let slotProcessed = 0;
      for await (const slot of ctx.db
        .query("enrichmentApiKeySlots")
        .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", apiKeyHashValue))) {
        if (slot.claimedBy) {
          await ctx.db.patch(slot._id, {
            claimedBy: undefined,
            claimedAt: undefined,
          });
          results.slotsReleased++;
        }
        slotProcessed++;
        if (slotProcessed >= 1000) break; // Reasonable limit for slots
      }
    }

    // 3. If all enrichment is complete, trigger analysis
    if (allEnrichmentComplete && !analysisAlreadyTriggered && leadsToAnalyze.length > 0) {
      for (const lead of leadsToAnalyze) {
        await ctx.db.patch(lead._id, {
          analysisStatus: "pending",
          updatedAt: Date.now(),
        });
      }
      results.analysisTriggered = true;
    }

    // Log the recovery action
    await ctx.db.insert("systemLogs", {
      type: "admin_recovery",
      action: "recover_stuck_enrichment",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        searchId: args.searchId,
        searchName: search.name,
        apiKeyHash: args.apiKeyHash,
        results,
      },
    });

    return { success: true, ...results };
  },
});

/**
 * Internal version - OPTIMIZED VERSION
 * Uses streaming with limits instead of .collect()
 */
export const recoverStuckEnrichmentInternal = internalMutation({
  args: {
    searchId: v.id("searches"),
    apiKeyHash: v.optional(v.string()),
    triggerAnalysis: v.optional(v.boolean()), // If true, schedule analyzeLeads action
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    const results: {
      slotsReleased: number;
      leadsRequeued: number;
      analysisTriggered: boolean;
      leadsMarkedPending: number;
      totalLeads: number;
    } = {
      slotsReleased: 0,
      leadsRequeued: 0,
      analysisTriggered: false,
      leadsMarkedPending: 0,
      totalLeads: 0,
    };

    // Stats tracking
    const enrichmentStats = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      no_contacts: 0,
    };

    // Track leads needing analysis
    const leadsToAnalyze: Array<{ _id: any }> = [];
    let allEnrichmentComplete = true;
    let analysisAlreadyTriggered = false;

    // 1. Stream leads and process
    for await (const lead of ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))) {
      results.totalLeads++;

      // Reset stuck in_progress leads
      if (lead.enrichmentStatus === "in_progress") {
        await ctx.db.patch(lead._id, {
          enrichmentStatus: "pending",
          enrichmentQueuedAt: Date.now(),
          updatedAt: Date.now(),
        });
        results.leadsRequeued++;
        enrichmentStats.pending++;
      } else {
        // Count enrichment status
        switch (lead.enrichmentStatus) {
          case "pending":
            enrichmentStats.pending++;
            allEnrichmentComplete = false;
            break;
          case "completed":
          case "completed_fallback":
            enrichmentStats.completed++;
            leadsToAnalyze.push({ _id: lead._id });
            break;
          case "failed":
            enrichmentStats.failed++;
            break;
          case "no_contacts_found":
            enrichmentStats.no_contacts++;
            break;
          default:
            allEnrichmentComplete = false;
        }
      }

      // Track analysis status
      if (
        lead.analysisStatus === "scheduled" ||
        lead.analysisStatus === "processing" ||
        lead.analysisStatus === "completed"
      ) {
        analysisAlreadyTriggered = true;
      }

      if (results.totalLeads >= MAX_ITERATION_COUNT) break;
    }

    console.log(`[Recovery] Found ${results.totalLeads} leads for search ${args.searchId}`);
    console.log(`[Recovery] Found ${results.leadsRequeued} stuck in_progress leads`);
    console.log(`[Recovery] Enrichment stats:`, enrichmentStats);

    // 2. Clear semaphore slots if apiKeyHash provided
    if (args.apiKeyHash) {
      const apiKeyHashValue = args.apiKeyHash;
      let slotCount = 0;
      for await (const slot of ctx.db
        .query("enrichmentApiKeySlots")
        .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", apiKeyHashValue))) {
        slotCount++;
        if (slot.claimedBy) {
          await ctx.db.patch(slot._id, {
            claimedBy: undefined,
            claimedAt: undefined,
          });
          results.slotsReleased++;
        }
        if (slotCount >= 1000) break;
      }
      console.log(`[Recovery] Found ${slotCount} slots for API key ${args.apiKeyHash.substring(0, 8)}...`);
    }

    console.log(`[Recovery] All enrichment complete: ${allEnrichmentComplete}, Analysis already triggered: ${analysisAlreadyTriggered}`);

    // 3. Trigger analysis if ready
    if (allEnrichmentComplete && !analysisAlreadyTriggered && leadsToAnalyze.length > 0) {
      console.log(`[Recovery] Marking ${leadsToAnalyze.length} leads for analysis`);

      for (const lead of leadsToAnalyze) {
        await ctx.db.patch(lead._id, {
          analysisStatus: "pending",
          updatedAt: Date.now(),
        });
        results.leadsMarkedPending++;
      }

      results.analysisTriggered = true;

      // Schedule the analysis action if requested
      if (args.triggerAnalysis) {
        console.log(`[Recovery] Scheduling analyzeLeads action for search ${args.searchId}`);
        await ctx.scheduler.runAfter(
          0,
          (internal.leads as any).actions.analyzeLeads,
          { searchId: args.searchId }
        );
      }
    }

    console.log(`[Recovery] Results:`, results);

    return { success: true, ...results, enrichmentStats };
  },
});

/**
 * Fix search where all leads have no_contacts_found - OPTIMIZED VERSION
 * Uses streaming with limits instead of .collect()
 */
export const markNoContactsLeadsAsSkipped = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      throw new Error("Search not found");
    }

    let totalLeads = 0;
    let skippedCount = 0;

    for await (const lead of ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))) {
      totalLeads++;

      // Mark no_contacts_found leads as "skipped" for analysis
      if (
        lead.enrichmentStatus === "no_contacts_found" &&
        (!lead.analysisStatus || lead.analysisStatus === "pending")
      ) {
        await ctx.db.patch(lead._id, {
          analysisStatus: "skipped",
          analysisError: "No email contacts found for this business",
          updatedAt: Date.now(),
        });
        skippedCount++;
      }

      // Also mark failed enrichment leads as "skipped"
      if (
        lead.enrichmentStatus === "failed" &&
        (!lead.analysisStatus || lead.analysisStatus === "pending")
      ) {
        await ctx.db.patch(lead._id, {
          analysisStatus: "skipped",
          analysisError: "Enrichment failed - unable to find contact information",
          updatedAt: Date.now(),
        });
        skippedCount++;
      }

      if (totalLeads >= MAX_ITERATION_COUNT) break;
    }

    console.log(`[Recovery] Marked ${skippedCount}/${totalLeads} leads as skipped for analysis in search ${args.searchId}`);

    return {
      success: true,
      totalLeads,
      skippedCount,
      searchId: args.searchId,
    };
  },
});
