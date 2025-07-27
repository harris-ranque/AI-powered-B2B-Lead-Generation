import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { auth } from "../auth.config";
import { updateUserValidator } from "../lib/validators";
import { ERROR_CODES } from "../lib/constants";
import { createError, isAdmin } from "../lib/helpers";

// Update user profile
export const updateProfile = mutation({
  args: updateUserValidator,
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const user = await ctx.db.get(userId);
    
    if (!user) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    const updateData = {
      ...args,
      updatedAt: Date.now(),
    };

    await ctx.db.patch(userId, updateData);

    // Create activity notification for profile update
    await ctx.db.insert("notifications", {
      userId,
      type: "system_alert",
      title: "Profile Updated",
      message: "Your profile has been successfully updated.",
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// Update user preferences
export const updatePreferences = mutation({
  args: {
    emailNotifications: v.optional(v.boolean()),
    language: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const user = await ctx.db.get(userId);
    
    if (!user) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    const currentPreferences = user.preferences || {
      emailNotifications: true,
      language: "en",
      timezone: "UTC",
    };

    const newPreferences = {
      ...currentPreferences,
      ...args,
    };

    await ctx.db.patch(userId, {
      preferences: newPreferences,
      updatedAt: Date.now(),
    });

    return { success: true, preferences: newPreferences };
  },
});

// Deduct credits from user account
export const deductCredits = mutation({
  args: {
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(v.object({
      type: v.string(),
      id: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const user = await ctx.db.get(userId);
    
    if (!user) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    if (user.credits < args.amount) {
      throw createError(
        "Insufficient credits",
        ERROR_CODES.INSUFFICIENT_CREDITS,
        400
      );
    }

    const newBalance = user.credits - args.amount;

    // Update user credits
    await ctx.db.patch(userId, {
      credits: newBalance,
      updatedAt: Date.now(),
    });

    // Record transaction
    await ctx.db.insert("creditTransactions", {
      userId,
      type: "usage",
      amount: -args.amount,
      description: args.description,
      relatedEntity: args.relatedEntity,
      balanceAfter: newBalance,
      createdAt: Date.now(),
    });

    // Check if credits are low and send notification
    if (newBalance <= 10 && newBalance > 0) {
      await ctx.db.insert("notifications", {
        userId,
        type: "credits_low",
        title: "Credits Running Low",
        message: `You have ${newBalance} credits remaining. Consider purchasing more to continue using Lead Eternity.`,
        data: { creditsRemaining: newBalance },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });
    }

    return { success: true, newBalance };
  },
});

// Add credits to user account
export const addCredits = mutation({
  args: {
    amount: v.number(),
    description: v.string(),
    type: v.union(
      v.literal("purchase"),
      v.literal("bonus"),
      v.literal("refund")
    ),
    stripePaymentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const user = await ctx.db.get(userId);
    
    if (!user) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    const newBalance = user.credits + args.amount;

    // Update user credits
    await ctx.db.patch(userId, {
      credits: newBalance,
      updatedAt: Date.now(),
    });

    // Record transaction
    await ctx.db.insert("creditTransactions", {
      userId,
      type: args.type,
      amount: args.amount,
      description: args.description,
      stripePaymentId: args.stripePaymentId,
      balanceAfter: newBalance,
      createdAt: Date.now(),
    });

    // Send notification
    await ctx.db.insert("notifications", {
      userId,
      type: "system_alert",
      title: "Credits Added",
      message: `${args.amount} credits have been added to your account. New balance: ${newBalance}`,
      data: { 
        creditsAdded: args.amount,
        newBalance,
        type: args.type,
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true, newBalance };
  },
});

// Upgrade user plan
export const upgradePlan = mutation({
  args: {
    plan: v.union(v.literal("pro"), v.literal("enterprise")),
    stripeSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const user = await ctx.db.get(userId);
    
    if (!user) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    // Update user plan
    await ctx.db.patch(userId, {
      plan: args.plan,
      updatedAt: Date.now(),
    });

    // Create billing record if Stripe subscription provided
    if (args.stripeSubscriptionId) {
      await ctx.db.insert("billing", {
        userId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        plan: args.plan,
        billingCycle: "monthly", // Default, will be updated by webhook
        amount: 0, // Will be updated by webhook
        currency: "usd",
        status: "active",
        currentPeriodStart: Date.now(),
        currentPeriodEnd: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
        cancelAtPeriodEnd: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Send welcome notification
    await ctx.db.insert("notifications", {
      userId,
      type: "plan_upgraded",
      title: `Welcome to ${args.plan.charAt(0).toUpperCase() + args.plan.slice(1)}!`,
      message: `Your account has been upgraded to ${args.plan}. Enjoy your new features and increased limits!`,
      data: { 
        newPlan: args.plan,
        previousPlan: user.plan,
      },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true, newPlan: args.plan };
  },
});

// Delete user account (soft delete by deactivating)
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const user = await ctx.db.get(userId);
    
    if (!user) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    // Soft delete by deactivating the account
    await ctx.db.patch(userId, {
      isActive: false,
      email: `deleted_${Date.now()}_${user.email}`, // Prevent email conflicts
      updatedAt: Date.now(),
    });

    // Cancel any active billing
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    if (billing) {
      await ctx.db.patch(billing._id, {
        status: "cancelled",
        cancelAtPeriodEnd: true,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Reset user password (admin only)
export const resetUserPassword = mutation({
  args: {
    userId: v.id("users"),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUserId = await auth.getUserId(ctx);
    
    if (!currentUserId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const currentUser = await ctx.db.get(currentUserId);
    
    if (!currentUser || !isAdmin(currentUser)) {
      throw createError("Admin access required", ERROR_CODES.FORBIDDEN, 403);
    }

    const targetUser = await ctx.db.get(args.userId);
    
    if (!targetUser) {
      throw createError("User not found", ERROR_CODES.USER_NOT_FOUND, 404);
    }

    // In a real implementation, you would hash the password
    // This is just a placeholder for the auth system integration
    await ctx.db.patch(args.userId, {
      updatedAt: Date.now(),
    });

    // Send notification to user
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: "system_alert",
      title: "Password Reset",
      message: "Your password has been reset by an administrator. Please check your email for new login instructions.",
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});