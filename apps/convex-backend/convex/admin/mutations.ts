import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAdmin } from "../auth";

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

// Export users data
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
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Get users with optional filters
    let users = await ctx.db.query("users").collect();

    if (args.filters?.plan) {
      users = users.filter((u) => u.plan === args.filters!.plan);
    }
    if (args.filters?.role) {
      users = users.filter((u) => u.role === args.filters!.role);
    }
    if (args.filters?.isActive !== undefined) {
      users = users.filter((u) => u.isActive === args.filters!.isActive);
    }

    // Sanitize sensitive data
    const sanitizedUsers = users.map((user) => ({
      id: user._id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      role: user.role,
      credits: user.credits,
      isActive: user.isActive,
      createdAt: new Date(user.createdAt).toISOString(),
      updatedAt: new Date(user.updatedAt || user.createdAt).toISOString(),
    }));

    let exportData: string;

    if (args.format === "csv") {
      // Convert to CSV
      const headers = Object.keys(sanitizedUsers[0] || {});
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
    };
  },
});

// Note: Admin settings functionality removed due to schema incompatibility
// Current systemConfiguration schema only supports creditCosts and planLimits
// Would need schema update to add flexible settings field for admin configuration

// Reset system cache by clearing provider caches used during lead enrichment
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

    const clearedCaches: Array<{ table: string; cleared: number }> = [];

    for (const { table, label } of cacheTables) {
      let cleared = 0;
      // Delete in batches to avoid hitting query limits with large caches
      while (true) {
        const batch = await ctx.db.query(table).take(100);
        if (batch.length === 0) {
          break;
        }
        for (const record of batch) {
          await ctx.db.delete(record._id);
        }
        cleared += batch.length;
      }

      clearedCaches.push({ table: label, cleared });
    }

    const totalCleared = clearedCaches.reduce((sum, entry) => sum + entry.cleared, 0);
    const timestamp = Date.now();

    // Log the cache reset
    await ctx.db.insert("systemLogs", {
      type: "system_maintenance",
      action: "cache_reset",
      userId: adminUser._id,
      timestamp,
      data: {
        message: "System cache has been reset",
        clearedCaches,
        totalCleared,
      },
    });

    return {
      success: true,
      message:
        totalCleared > 0
          ? `System cache reset completed (${totalCleared} entries cleared)`
          : "System cache reset completed",
      clearedCaches,
      totalCleared,
    };
  },
});

// Run system maintenance
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

    for (const task of args.tasks) {
      try {
        switch (task) {
          case "cleanup_old_logs":
            // Delete old system logs in batches using timestamp index
            let deletedLogs = 0;
            while (true) {
              const batch = await ctx.db
                .query("systemLogs")
                .withIndex("by_timestamp", (q) => q.lt("timestamp", thirtyDaysAgo))
                .take(100);

              if (batch.length === 0) {
                break;
              }

              for (const log of batch) {
                await ctx.db.delete(log._id);
              }
              deletedLogs += batch.length;
            }

            results.push({ task, success: true, deletedCount: deletedLogs });
            break;

          case "reset_rate_limits":
            // Clear rate limit records and violations outside the active window
            let clearedRateLimits = 0;
            while (true) {
              const batch = await ctx.db
                .query("rateLimitRecords")
                .withIndex("by_window", (q) => q.lt("windowStart", now - rateLimitRetentionMs))
                .take(100);

              if (batch.length === 0) {
                break;
              }

              for (const record of batch) {
                await ctx.db.delete(record._id);
              }
              clearedRateLimits += batch.length;
            }

            let clearedViolations = 0;
            while (true) {
              const batch = await ctx.db
                .query("rateLimitViolations")
                .withIndex("by_timestamp", (q) => q.lt("timestamp", thirtyDaysAgo))
                .take(100);

              if (batch.length === 0) {
                break;
              }

              for (const violation of batch) {
                await ctx.db.delete(violation._id);
              }
              clearedViolations += batch.length;
            }

            results.push({
              task,
              success: true,
              clearedRateLimits,
              clearedViolations,
            });
            break;

          case "optimize_database":
            {
              let expiredReservations = 0;
              let removedReservations = 0;

              // Mark any lingering pending reservations as rolled back
              while (true) {
                const batch = await ctx.db
                  .query("creditReservations")
                  .withIndex("by_status", (q) => q.eq("status", "pending"))
                  .filter((q) => q.lt(q.field("expiresAt"), now))
                  .take(100);

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
              }

              const reservationStatusesToPurge = ["rolled_back", "committed"] as const;
              for (const status of reservationStatusesToPurge) {
                while (true) {
                  const batch = await ctx.db
                    .query("creditReservations")
                    .withIndex("by_status", (q) => q.eq("status", status))
                    .filter((q) => q.lt(q.field("expiresAt"), now - reservationRetentionMs))
                    .take(100);

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
                }
              }

              // Remove stale LangGraph request history beyond retention window
              let removedLanggraphRequests = 0;
              const staleStatuses = ["completed", "failed"] as const;
              for (const status of staleStatuses) {
                while (true) {
                  const batch = await ctx.db
                    .query("langgraphRequests")
                    .withIndex("by_status", (q) => q.eq("status", status))
                    .filter((q) => q.lt(q.field("createdAt"), now - langgraphRetentionMs))
                    .take(100);

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
                }
              }

              results.push({
                task,
                success: true,
                expiredReservations,
                removedReservations,
                removedLanggraphRequests,
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

              const cacheResults: Array<{ table: string; cleared: number }> = [];

              for (const { table, label } of cacheTables) {
                let cleared = 0;
                while (true) {
                  const batch = await ctx.db
                    .query(table)
                    .withIndex("by_expires", (q) => q.lt("expiresAt", now))
                    .take(100);

                  if (batch.length === 0) {
                    break;
                  }

                  for (const record of batch) {
                    await ctx.db.delete(record._id);
                  }
                  cleared += batch.length;
                }

                cacheResults.push({ table: label, cleared });
              }

              let expiredReservations = 0;
              while (true) {
                const batch = await ctx.db
                  .query("creditReservations")
                  .withIndex("by_status", (q) => q.eq("status", "pending"))
                  .filter((q) => q.lt(q.field("expiresAt"), now))
                  .take(100);

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
              }

              results.push({
                task,
                success: true,
                cacheResults,
                expiredReservations,
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

// Recovery function for stuck enrichment pipeline
// Clears leaked semaphore slots and requeues stuck in_progress leads
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
    } = {
      slotsReleased: 0,
      leadsRequeued: 0,
      analysisTriggered: false,
    };

    // 1. Get all leads for this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    // 2. Find and reset stuck in_progress leads back to pending
    const stuckLeads = leads.filter((lead) => lead.enrichmentStatus === "in_progress");

    for (const lead of stuckLeads) {
      await ctx.db.patch(lead._id, {
        enrichmentStatus: "pending",
        enrichmentQueuedAt: Date.now(),
        updatedAt: Date.now(),
      });
      results.leadsRequeued++;
    }

    // 3. Clear semaphore slots if apiKeyHash provided
    if (args.apiKeyHash) {
      const slots = await ctx.db
        .query("enrichmentApiKeySlots")
        .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", args.apiKeyHash))
        .collect();

      for (const slot of slots) {
        if (slot.claimedBy) {
          await ctx.db.patch(slot._id, {
            claimedBy: undefined,
            claimedAt: undefined,
          });
          results.slotsReleased++;
        }
      }
    }

    // 4. Check if all enrichment is actually complete and trigger analysis if needed
    const refreshedLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const allEnrichmentComplete = refreshedLeads.every((lead) =>
      lead.enrichmentStatus === "completed" ||
      lead.enrichmentStatus === "completed_fallback" ||
      lead.enrichmentStatus === "no_contacts_found" ||
      lead.enrichmentStatus === "failed"
    );

    const analysisAlreadyTriggered = refreshedLeads.some((lead) =>
      lead.analysisStatus === "scheduled" ||
      lead.analysisStatus === "processing" ||
      lead.analysisStatus === "completed"
    );

    if (allEnrichmentComplete && !analysisAlreadyTriggered) {
      // Mark leads as pending for analysis
      const leadsToAnalyze = refreshedLeads.filter(
        (lead) =>
          lead.enrichmentStatus === "completed" ||
          lead.enrichmentStatus === "completed_fallback"
      );

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

// Internal version - can be run directly from Convex dashboard without auth
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
    } = {
      slotsReleased: 0,
      leadsRequeued: 0,
      analysisTriggered: false,
      leadsMarkedPending: 0,
    };

    // 1. Get all leads for this search
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    console.log(`[Recovery] Found ${leads.length} leads for search ${args.searchId}`);

    // 2. Find and reset stuck in_progress leads back to pending
    const stuckLeads = leads.filter((lead) => lead.enrichmentStatus === "in_progress");
    console.log(`[Recovery] Found ${stuckLeads.length} stuck in_progress leads`);

    for (const lead of stuckLeads) {
      await ctx.db.patch(lead._id, {
        enrichmentStatus: "pending",
        enrichmentQueuedAt: Date.now(),
        updatedAt: Date.now(),
      });
      results.leadsRequeued++;
    }

    // 3. Clear ALL semaphore slots if apiKeyHash provided
    if (args.apiKeyHash) {
      const slots = await ctx.db
        .query("enrichmentApiKeySlots")
        .withIndex("by_key_hash", (q) => q.eq("apiKeyHash", args.apiKeyHash))
        .collect();

      console.log(`[Recovery] Found ${slots.length} slots for API key ${args.apiKeyHash.substring(0, 8)}...`);

      for (const slot of slots) {
        if (slot.claimedBy) {
          await ctx.db.patch(slot._id, {
            claimedBy: undefined,
            claimedAt: undefined,
          });
          results.slotsReleased++;
        }
      }
    }

    // 4. Check enrichment status after requeue
    const refreshedLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const enrichmentStats = {
      pending: refreshedLeads.filter((l) => l.enrichmentStatus === "pending").length,
      in_progress: refreshedLeads.filter((l) => l.enrichmentStatus === "in_progress").length,
      completed: refreshedLeads.filter((l) => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback").length,
      failed: refreshedLeads.filter((l) => l.enrichmentStatus === "failed").length,
      no_contacts: refreshedLeads.filter((l) => l.enrichmentStatus === "no_contacts_found").length,
    };

    console.log(`[Recovery] Enrichment stats:`, enrichmentStats);

    const allEnrichmentComplete = refreshedLeads.every((lead) =>
      lead.enrichmentStatus === "completed" ||
      lead.enrichmentStatus === "completed_fallback" ||
      lead.enrichmentStatus === "no_contacts_found" ||
      lead.enrichmentStatus === "failed"
    );

    const analysisAlreadyTriggered = refreshedLeads.some((lead) =>
      lead.analysisStatus === "scheduled" ||
      lead.analysisStatus === "processing" ||
      lead.analysisStatus === "completed"
    );

    console.log(`[Recovery] All enrichment complete: ${allEnrichmentComplete}, Analysis already triggered: ${analysisAlreadyTriggered}`);

    if (allEnrichmentComplete && !analysisAlreadyTriggered) {
      // Mark leads as pending for analysis
      const leadsToAnalyze = refreshedLeads.filter(
        (lead) =>
          lead.enrichmentStatus === "completed" ||
          lead.enrichmentStatus === "completed_fallback"
      );

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
          internal.leads.actions.analyzeLeads,
          { searchId: args.searchId }
        );
      }
    }

    console.log(`[Recovery] Results:`, results);

    return { success: true, ...results, enrichmentStats };
  },
});

/**
 * Fix search where all leads have no_contacts_found - mark them as "skipped" for analysis
 * This provides clear UI feedback about why no emails were generated
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

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    let skippedCount = 0;

    for (const lead of leads) {
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
    }

    console.log(`[Recovery] Marked ${skippedCount}/${leads.length} leads as skipped for analysis in search ${args.searchId}`);

    return {
      success: true,
      totalLeads: leads.length,
      skippedCount,
      searchId: args.searchId,
    };
  },
});
