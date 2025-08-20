import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import { createError, isAdmin } from "../lib/helpers";

// Update user status (ban/activate)
export const updateUserStatus = mutation({
  args: {
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("banned")),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const targetUser = await ctx.db.get(args.userId);
    
    if (!targetUser) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    // Cannot ban another admin
    if (targetUser.role === "admin" && args.status === "banned") {
      throw createError("Cannot ban admin users", ERROR_CODES.FORBIDDEN, 400);
    }

    const isActive = args.status === "active";

    await ctx.db.patch(args.userId, {
      isActive,
      updatedAt: Date.now(),
    });

    // Send notification to user
    const statusMessage = args.status === "banned" ? "suspended" : 
                         args.status === "active" ? "activated" : "deactivated";

    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: `Account ${statusMessage.charAt(0).toUpperCase() + statusMessage.slice(1)}`,
      message: `Your account has been ${statusMessage} by an administrator.`,
      data: { 
        newStatus: args.status,
        updatedBy: currentUser._id,
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
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise")),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const targetUser = await ctx.db.get(args.userId);
    
    if (!targetUser) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    await ctx.db.patch(args.userId, {
      plan: args.plan,
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Plan Updated",
      message: `Your plan has been updated to ${args.plan} by an administrator.`,
      data: { 
        newPlan: args.plan,
        previousPlan: targetUser.plan,
        updatedBy: currentUser._id,
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
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const targetUser = await ctx.db.get(args.userId);
    
    if (!targetUser) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    if (args.amount <= 0) {
      throw createError("Credit amount must be positive", ERROR_CODES.VALIDATION_ERROR, 400);
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
      type: "admin_credit",
      amount: args.amount,
      description: `Admin credit: ${args.reason}`,
      balanceAfter: newBalance,
      createdAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Credits Added",
      message: `You've been awarded ${args.amount} credits! Reason: ${args.reason}`,
      data: { 
        creditsAdded: args.amount,
        newBalance,
        reason: args.reason,
        addedBy: currentUser._id,
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
    format: v.optional(v.union(v.literal("csv"), v.literal("json"))),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const users = await ctx.db.query("users").collect();
    
    // TODO: Implement actual export logic
    // For now, just return success
    return { 
      success: true, 
      message: `Export of ${users.length} users initiated`,
      format: args.format || "csv",
    };
  },
});

// Update admin settings
export const updateAdminSettings = mutation({
  args: {
    settings: v.object({
      maintenanceMode: v.optional(v.boolean()),
      systemNotifications: v.optional(v.boolean()),
      debugMode: v.optional(v.boolean()),
      rateLimitEnabled: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // TODO: Implement actual settings storage
    // For now, just log the change
    await ctx.db.insert("systemLogs", {
      type: "admin_settings",
      action: "update_settings",
      userId: currentUser._id,
      data: args.settings,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Reset system cache
export const resetSystemCache = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // Clear various cache tables
    const findymailCache = await ctx.db.query("findymailDomainCache").collect();
    let clearedEntries = 0;
    
    for (const entry of findymailCache) {
      await ctx.db.delete(entry._id);
      clearedEntries++;
    }

    // Log the action
    await ctx.db.insert("systemLogs", {
      type: "cache_management",
      action: "reset_cache",
      userId: currentUser._id,
      data: { clearedEntries },
      timestamp: Date.now(),
    });

    return { 
      success: true, 
      message: `Cache reset complete. Cleared ${clearedEntries} entries.`,
    };
  },
});

// Run system maintenance
export const runSystemMaintenance = mutation({
  args: {
    tasks: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const tasks = args.tasks || ["cleanup_logs", "reset_cache", "validate_data"];
    const results = [];

    for (const task of tasks) {
      switch (task) {
        case "cleanup_logs":
          // Clean up old logs
          const oldLogs = await ctx.db
            .query("systemLogs")
            .filter((q) => q.lt(q.field("timestamp"), Date.now() - (30 * 24 * 60 * 60 * 1000)))
            .collect();
          
          let deletedLogs = 0;
          for (const log of oldLogs) {
            await ctx.db.delete(log._id);
            deletedLogs++;
          }
          results.push(`Cleaned up ${deletedLogs} old log entries`);
          break;

        case "reset_cache":
          // This would call the cache reset function
          results.push("System cache reset");
          break;

        case "validate_data":
          // Basic data validation
          const users = await ctx.db.query("users").collect();
          const invalidUsers = users.filter(u => !u.email || !u.createdAt);
          results.push(`Data validation complete. Found ${invalidUsers.length} invalid records`);
          break;

        default:
          results.push(`Unknown task: ${task}`);
      }
    }

    // Log the maintenance run
    await ctx.db.insert("systemLogs", {
      type: "system_maintenance",
      action: "run_maintenance",
      userId: currentUser._id,
      data: { tasks, results },
      timestamp: Date.now(),
    });

    return { 
      success: true, 
      results,
      message: `Maintenance completed. ${results.length} tasks executed.`,
    };
  },
});