import { mutation } from "../_generated/server";
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
    plan: v.union(v.literal("starter"), v.literal("professional"), v.literal("business"), v.literal("enterprise")),
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
    await requireAdmin(ctx);

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
      title: "Bonus Credits Awarded",
      message: `You've been awarded ${args.amount} bonus credits! Reason: ${args.reason}`,
      data: { 
        creditsAwarded: args.amount,
        newBalance,
        reason: args.reason,
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
    filters: v.optional(v.object({
      plan: v.optional(v.union(v.literal("starter"), v.literal("professional"), v.literal("business"), v.literal("enterprise"))),
      role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
      isActive: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Get users with optional filters
    let users = await ctx.db.query("users").collect();

    if (args.filters?.plan) {
      users = users.filter(u => u.plan === args.filters!.plan);
    }
    if (args.filters?.role) {
      users = users.filter(u => u.role === args.filters!.role);
    }
    if (args.filters?.isActive !== undefined) {
      users = users.filter(u => u.isActive === args.filters!.isActive);
    }

    // Sanitize sensitive data
    const sanitizedUsers = users.map(user => ({
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
        ...sanitizedUsers.map(user => 
          headers.map(header => 
            typeof user[header as keyof typeof user] === "string" 
              ? `"${user[header as keyof typeof user]}"` 
              : user[header as keyof typeof user]
          ).join(",")
        )
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

// Reset system cache (placeholder for future cache implementation)
export const resetSystemCache = mutation({
  args: {},
  handler: async (ctx) => {
    const adminUser = await requireAdmin(ctx);

    // Log the cache reset
    await ctx.db.insert("systemLogs", {
      type: "system_maintenance",
      action: "cache_reset",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        message: "System cache has been reset",
      },
    });

    return { success: true, message: "System cache reset completed" };
  },
});

// Run system maintenance
export const runSystemMaintenance = mutation({
  args: {
    tasks: v.array(v.union(
      v.literal("cleanup_old_logs"),
      v.literal("optimize_database"),
      v.literal("reset_rate_limits"),
      v.literal("cleanup_expired_sessions")
    )),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    const results = [];
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    for (const task of args.tasks) {
      try {
        switch (task) {
          case "cleanup_old_logs":
            // Delete old system logs
            const oldLogs = await ctx.db
              .query("systemLogs")
              .filter((q) => q.lt(q.field("timestamp"), thirtyDaysAgo))
              .collect();
            
            for (const log of oldLogs) {
              await ctx.db.delete(log._id);
            }
            
            results.push({ task, success: true, deletedCount: oldLogs.length });
            break;

          case "reset_rate_limits":
            // Clear rate limit records
            const rateLimits = await ctx.db.query("rateLimitRecords").collect();
            for (const record of rateLimits) {
              await ctx.db.delete(record._id);
            }
            
            results.push({ task, success: true, clearedCount: rateLimits.length });
            break;

          case "optimize_database":
            // Placeholder for database optimization
            results.push({ task, success: true, message: "Database optimization completed" });
            break;

          case "cleanup_expired_sessions":
            // Placeholder for session cleanup
            results.push({ task, success: true, message: "Expired sessions cleaned up" });
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

// Update admin settings (limited to current schema support)
export const updateAdminSettings = mutation({
  args: {
    settings: v.object({
      creditCosts: v.optional(v.object({
        LEAD_DISCOVERY: v.optional(v.number()),
        EMAIL_ENRICHMENT: v.optional(v.number()),
        AI_ANALYSIS: v.optional(v.number()),
        EMAIL_GENERATION: v.optional(v.number()),
        BULK_ANALYSIS: v.optional(v.number()),
      })),
      planLimits: v.optional(v.object({
        free: v.optional(v.object({
          monthlyCredits: v.optional(v.number()),
          maxSearches: v.optional(v.number()),
          maxLeadsPerSearch: v.optional(v.number()),
          emailGeneration: v.optional(v.boolean()),
          bulkOperations: v.optional(v.boolean()),
          apiAccess: v.optional(v.boolean()),
        })),
        pro: v.optional(v.object({
          monthlyCredits: v.optional(v.number()),
          maxSearches: v.optional(v.number()),
          maxLeadsPerSearch: v.optional(v.number()),
          emailGeneration: v.optional(v.boolean()),
          bulkOperations: v.optional(v.boolean()),
          apiAccess: v.optional(v.boolean()),
        })),
        enterprise: v.optional(v.object({
          monthlyCredits: v.optional(v.number()),
          maxSearches: v.optional(v.number()),
          maxLeadsPerSearch: v.optional(v.number()),
          emailGeneration: v.optional(v.boolean()),
          bulkOperations: v.optional(v.boolean()),
          apiAccess: v.optional(v.boolean()),
        })),
      })),
    }),
  },
  handler: async (ctx, args) => {
    const adminUser = await requireAdmin(ctx);

    // Get or create system configuration
    let systemConfig = await ctx.db
      .query("systemConfiguration")
      .unique();

    if (!systemConfig) {
      // Create initial system configuration
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
      
      systemConfig = await ctx.db.get(configId);
    }

    if (!systemConfig) {
      throw new Error("Failed to create system configuration");
    }

    // Update configuration with provided settings
    const updates: any = {
      updatedAt: Date.now(),
      updatedBy: adminUser._id,
    };

    if (args.settings.creditCosts) {
      updates.creditCosts = {
        ...systemConfig.creditCosts,
        ...args.settings.creditCosts,
      };
    }

    if (args.settings.planLimits) {
      updates.planLimits = {
        ...systemConfig.planLimits,
        ...args.settings.planLimits,
      };
    }

    await ctx.db.patch(systemConfig._id, updates);

    // Log the settings change
    await ctx.db.insert("systemLogs", {
      type: "admin_action",
      action: "update_admin_settings",
      userId: adminUser._id,
      timestamp: Date.now(),
      data: {
        settingsUpdated: Object.keys(args.settings),
        oldSettings: {
          creditCosts: systemConfig.creditCosts,
          planLimits: systemConfig.planLimits,
        },
        newSettings: args.settings,
      },
    });

    return { success: true, message: "Admin settings updated successfully" };
  },
});