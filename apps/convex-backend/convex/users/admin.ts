import { query, mutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { ERROR_CODES } from "../lib/constants";
import {
  createError,
  isAdmin,
  CREDIT_COSTS,
  PLAN_LIMITS,
} from "../lib/helpers";

// Get all users (admin only)
export const getAllUsers = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
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
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);

    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const limit = args.limit || 50;
    const offset = args.offset || 0;

    // Apply filters and get users
    let users;
    if (args.plan !== undefined) {
      const planFilter = args.plan;
      users = await ctx.db
        .query("users")
        .withIndex("by_plan", (q) => q.eq("plan", planFilter))
        .collect();
    } else if (args.role !== undefined) {
      const roleFilter = args.role;
      users = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", roleFilter))
        .collect();
    } else {
      users = await ctx.db.query("users").collect();
    }

    // Apply additional filters
    if (args.isActive !== undefined) {
      users = users.filter((user) => user.isActive === args.isActive);
    }

    // Apply pagination
    const paginatedUsers = users.slice(offset, offset + limit);

    return {
      users: paginatedUsers,
      total: users.length,
      hasMore: offset + limit < users.length,
    };
  },
});

// Get user statistics for admin dashboard
export const getUserStatistics = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);

    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const users = await ctx.db.query("users").collect();

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const activeUsers = users.filter((u) => u.isActive);
    const newUsersThisMonth = users.filter((u) => u.createdAt > thirtyDaysAgo);
    const newUsersThisWeek = users.filter((u) => u.createdAt > sevenDaysAgo);

    const planDistribution = {
      starter: users.filter((u) => u.plan === "starter").length,
      professional: users.filter((u) => u.plan === "professional").length,
      business: users.filter((u) => u.plan === "business").length,
      enterprise: users.filter((u) => u.plan === "enterprise").length,
    };

    const roleDistribution = {
      user: users.filter((u) => u.role === "user").length,
      admin: users.filter((u) => u.role === "admin").length,
    };

    return {
      totalUsers: users.length,
      activeUsers: activeUsers.length,
      inactiveUsers: users.length - activeUsers.length,
      newUsersThisMonth: newUsersThisMonth.length,
      newUsersThisWeek: newUsersThisWeek.length,
      planDistribution,
      roleDistribution,
    };
  },
});

// Update user role (admin only)
export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("admin")),
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

    // Prevent removing the last admin
    if (currentUser.role === "admin" && args.role === "user") {
      const adminCount = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .collect();

      if (adminCount.length <= 1) {
        throw createError(
          "Cannot remove the last admin user",
          ERROR_CODES.FORBIDDEN,
          400,
        );
      }
    }

    await ctx.db.patch(args.userId, {
      role: args.role,
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Role Updated",
      message: `Your role has been updated to ${args.role} by an administrator.`,
      data: {
        newRole: args.role,
        previousRole: targetUser.role,
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Suspend user account (admin only)
export const suspendUser = mutation({
  args: {
    userId: v.id("users"),
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

    // Cannot suspend another admin
    if (targetUser.role === "admin") {
      throw createError(
        "Cannot suspend admin users",
        ERROR_CODES.FORBIDDEN,
        400,
      );
    }

    await ctx.db.patch(args.userId, {
      isActive: false,
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Account Suspended",
      message: `Your account has been suspended. Reason: ${args.reason}. Please contact support if you believe this is an error.`,
      data: {
        reason: args.reason,
        suspendedBy: currentUser._id,
        suspendedAt: Date.now(),
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Reactivate user account (admin only)
export const reactivateUser = mutation({
  args: {
    userId: v.id("users"),
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
      isActive: true,
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Account Reactivated",
      message:
        "Your account has been reactivated. You can now access all features of Genni.",
      data: {
        reactivatedBy: currentUser._id,
        reactivatedAt: Date.now(),
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Grant bonus credits (admin only)
export const grantBonusCredits = mutation({
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
        awardedBy: currentUser._id,
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true, newBalance };
  },
});

// Search users by email or name (admin only)
export const searchUsers = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);

    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const limit = args.limit || 20;
    const searchQuery = args.query.toLowerCase();

    const users = await ctx.db.query("users").collect();

    const filteredUsers = users
      .filter(
        (user) =>
          user.email.toLowerCase().includes(searchQuery) ||
          (user.name && user.name.toLowerCase().includes(searchQuery)),
      )
      .slice(0, limit);

    return filteredUsers;
  },
});

// Get current system configuration (admin only)
export const getSystemConfiguration = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);

    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // Try to get configuration from database, fallback to constants
    const config = await ctx.db.query("systemConfiguration").unique();

    if (config) {
      return {
        creditCosts: config.creditCosts,
        planLimits: config.planLimits,
        creditPacks: config.creditPacks || null,
        lastUpdated: config.updatedAt,
        updatedBy: config.updatedBy,
      };
    }

    // Return default configuration
    return {
      creditCosts: CREDIT_COSTS,
      planLimits: PLAN_LIMITS,
      creditPacks: null,
      lastUpdated: null,
      updatedBy: null,
    };
  },
});

// Update credit costs (admin only)
export const updateCreditCosts = mutation({
  args: {
    creditCosts: v.object({
      LEAD_DISCOVERY: v.number(),
      EMAIL_ENRICHMENT: v.number(),
      AI_ANALYSIS: v.number(),
      EMAIL_GENERATION: v.number(),
      BULK_ANALYSIS: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);

    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // Validate that all costs are positive
    const costs = Object.values(args.creditCosts);
    if (costs.some((cost) => cost < 0)) {
      throw createError(
        "Credit costs must be non-negative",
        ERROR_CODES.VALIDATION_ERROR,
        400,
      );
    }

    // Get existing configuration or create new one
    let config = await ctx.db.query("systemConfiguration").unique();

    if (config) {
      // Update existing configuration
      await ctx.db.patch(config._id, {
        creditCosts: args.creditCosts,
        updatedAt: Date.now(),
        updatedBy: currentUser._id,
      });
    } else {
      // Create new configuration
      await ctx.db.insert("systemConfiguration", {
        creditCosts: args.creditCosts,
        planLimits: PLAN_LIMITS, // Use default plan limits for now
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
        updatedBy: currentUser._id,
      });
    }

    // Log the configuration change
    await ctx.db.insert("systemLogs", {
      type: "configuration_change",
      action: "update_credit_costs",
      userId: currentUser._id,
      data: {
        oldCosts: CREDIT_COSTS,
        newCosts: args.creditCosts,
      },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Update plan limits (admin only)
export const updatePlanLimits = mutation({
  args: {
    planLimits: v.object({
      free: v.object({
        monthlyCredits: v.number(),
        maxSearches: v.number(),
        maxLeadsPerSearch: v.number(),
        emailGeneration: v.boolean(),
        bulkOperations: v.boolean(),
        apiAccess: v.boolean(),
      }),
      pro: v.object({
        monthlyCredits: v.number(),
        maxSearches: v.number(),
        maxLeadsPerSearch: v.number(),
        emailGeneration: v.boolean(),
        bulkOperations: v.boolean(),
        apiAccess: v.boolean(),
      }),
      enterprise: v.object({
        monthlyCredits: v.number(),
        maxSearches: v.number(),
        maxLeadsPerSearch: v.number(),
        emailGeneration: v.boolean(),
        bulkOperations: v.boolean(),
        apiAccess: v.boolean(),
      }),
    }),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);

    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    // Validate plan limits
    const plans = Object.values(args.planLimits);
    for (const plan of plans) {
      if (plan.monthlyCredits < 0 || plan.maxLeadsPerSearch < 0) {
        throw createError(
          "Plan limits must be non-negative",
          ERROR_CODES.VALIDATION_ERROR,
          400,
        );
      }
      if (plan.maxSearches < -1) {
        throw createError(
          "Max searches must be -1 (unlimited) or positive",
          ERROR_CODES.VALIDATION_ERROR,
          400,
        );
      }
    }

    // Get existing configuration or create new one
    let config = await ctx.db.query("systemConfiguration").unique();

    if (config) {
      // Update existing configuration
      await ctx.db.patch(config._id, {
        planLimits: args.planLimits,
        updatedAt: Date.now(),
        updatedBy: currentUser._id,
      });
    } else {
      // Create new configuration
      await ctx.db.insert("systemConfiguration", {
        creditCosts: CREDIT_COSTS, // Use default credit costs for now
        planLimits: args.planLimits,
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
        updatedBy: currentUser._id,
      });
    }

    // Log the configuration change
    await ctx.db.insert("systemLogs", {
      type: "configuration_change",
      action: "update_plan_limits",
      userId: currentUser._id,
      data: {
        oldLimits: PLAN_LIMITS,
        newLimits: args.planLimits,
      },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Update credit packs (admin only)
export const updateCreditPacks = mutation({
  args: {
    creditPacks: v.array(
      v.object({
        id: v.string(),
        credits: v.number(),
        priceCents: v.number(),
        bonus: v.optional(v.number()),
        active: v.boolean(),
        stripePriceId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }
    // Basic validation
    for (const p of args.creditPacks) {
      if (p.credits <= 0 || p.priceCents < 0) {
        throw createError(
          "Invalid credit pack values",
          ERROR_CODES.VALIDATION_ERROR,
          400,
        );
      }
    }
    let config = await ctx.db.query("systemConfiguration").unique();
    if (config) {
      await ctx.db.patch(config._id, {
        creditPacks: args.creditPacks,
        updatedAt: Date.now(),
        updatedBy: currentUser._id,
      });
    } else {
      await ctx.db.insert("systemConfiguration", {
        creditCosts: CREDIT_COSTS,
        planLimits: PLAN_LIMITS,
        creditPacks: args.creditPacks,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: currentUser._id,
      });
    }
    await ctx.db.insert("systemLogs", {
      type: "configuration_change",
      action: "update_credit_packs",
      userId: currentUser._id,
      data: { creditPacks: args.creditPacks },
      timestamp: Date.now(),
    });
    return { success: true };
  },
});

// Upsert a plan configuration (admin only)
export const upsertPlanConfiguration = mutation({
  args: {
    planId: v.string(),
    planName: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.number(),
    stripePriceIdMonthly: v.optional(v.string()),
    stripePriceIdYearly: v.optional(v.string()),
    limits: v.object({
      monthlySearches: v.number(),
      maxLeadsPerSearch: v.number(),
      monthlyEnrichments: v.number(),
      monthlyExports: v.number(),
      emailGeneration: v.boolean(),
      bulkOperations: v.boolean(),
      apiAccess: v.boolean(),
      requiresOwnApiKeys: v.boolean(),
      supportLevel: v.string(),
    }),
    features: v.array(v.string()),
    isActive: v.boolean(),
    isVisible: v.boolean(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }
    const existing = await ctx.db
      .query("planConfigurations")
      .withIndex("by_plan_id", (q) => q.eq("planId", args.planId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: Date.now(),
        updatedBy: currentUser._id,
      } as any);
    } else {
      await ctx.db.insert("planConfigurations", {
        ...args,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: currentUser._id,
      } as any);
    }
    await ctx.db.insert("systemLogs", {
      type: "configuration_change",
      action: "upsert_plan_configuration",
      userId: currentUser._id,
      data: { planId: args.planId },
      timestamp: Date.now(),
    });
    return { success: true };
  },
});

// List all plan configurations (admin only)
export const listPlanConfigurations = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }
    const plans = await ctx.db
      .query("planConfigurations")
      .withIndex("by_sort_order")
      .collect();
    return plans;
  },
});

// Internal query to get user by ID (for internal actions)
export const getUserByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  },
});

// Pause a user's processing (admin only)
export const pauseUserProcessing = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const user = await ctx.db.get(args.userId);
    if (!user)
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);

    await ctx.db.patch(args.userId, {
      processingPaused: true,
      pauseReason: args.reason || "Paused by admin",
      pausedAt: Date.now(),
      pausedBy: currentUser._id,
      updatedAt: Date.now(),
    });

    // Optionally cancel in-progress searches for this user
    const activeSearches = await ctx.db
      .query("searches")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "in_progress"),
          q.eq(q.field("status"), "processing"),
        ),
      )
      .collect();

    for (const s of activeSearches) {
      await ctx.db.patch(s._id, {
        status: "cancelled",
        error: args.reason || "User processing paused by admin",
        completedAt: Date.now(),
      });
    }

    await ctx.db.insert("systemLogs", {
      type: "user_control",
      action: "pause_processing",
      userId: currentUser._id,
      data: { targetUserId: args.userId, reason: args.reason },
      timestamp: Date.now(),
    });

    return { success: true, cancelledSearches: activeSearches.length };
  },
});

// Resume a user's processing (admin only)
export const resumeUserProcessing = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const user = await ctx.db.get(args.userId);
    if (!user)
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);

    await ctx.db.patch(args.userId, {
      processingPaused: false,
      pauseReason: undefined,
      pausedAt: undefined,
      pausedBy: undefined,
      updatedAt: Date.now(),
    });

    await ctx.db.insert("systemLogs", {
      type: "user_control",
      action: "resume_processing",
      userId: currentUser._id,
      data: { targetUserId: args.userId },
      timestamp: Date.now(),
    });

    return { success: true };
  },
});
