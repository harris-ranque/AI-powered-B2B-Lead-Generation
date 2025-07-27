import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { auth } from "../auth.config";
import { ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";
import { creditTransactionValidator } from "../lib/validators";

// Purchase credits with Stripe
export const purchaseCredits = mutation({
  args: {
    amount: v.number(),
    stripePaymentIntentId: v.string(),
    priceId: v.string(),
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

    // Validate credit amount
    if (args.amount <= 0 || args.amount > 10000) {
      throw createError("Invalid credit amount", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    const newBalance = user.credits + args.amount;

    try {
      // Update user credits
      await ctx.db.patch(userId, {
        credits: newBalance,
        updatedAt: Date.now(),
      });

      // Record transaction
      await ctx.db.insert("creditTransactions", {
        userId,
        type: "purchase",
        amount: args.amount,
        description: `Credit purchase - ${args.amount} credits`,
        stripePaymentId: args.stripePaymentIntentId,
        balanceAfter: newBalance,
        createdAt: Date.now(),
      });

      // Send notification
      await ctx.db.insert("notifications", {
        userId,
        type: "system_alert",
        title: "Credits Purchased Successfully! 💳",
        message: `${args.amount} credits have been added to your account. New balance: ${newBalance} credits.`,
        data: { 
          creditsAdded: args.amount,
          newBalance,
          paymentId: args.stripePaymentIntentId,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return { 
        success: true,
        newBalance,
        transactionId: args.stripePaymentIntentId,
      };

    } catch (error) {
      console.error("Credit purchase error:", error);
      throw createError("Failed to process credit purchase", ERROR_CODES.PAYMENT_FAILED, 500);
    }
  },
});

// Create Stripe checkout session for credit purchase
export const createCheckoutSession = mutation({
  args: {
    creditPackage: v.union(
      v.literal("starter_100"),
      v.literal("growth_500"),
      v.literal("pro_1000"),
      v.literal("enterprise_2500")
    ),
    successUrl: v.string(),
    cancelUrl: v.string(),
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

    // Credit packages with pricing
    const packages = {
      starter_100: { credits: 100, price: 1900, name: "Starter Pack" }, // $19.00
      growth_500: { credits: 500, price: 7900, name: "Growth Pack" }, // $79.00
      pro_1000: { credits: 1000, price: 14900, name: "Pro Pack" }, // $149.00
      enterprise_2500: { credits: 2500, price: 29900, name: "Enterprise Pack" }, // $299.00
    };

    const package = packages[args.creditPackage];
    
    if (!package) {
      throw createError("Invalid credit package", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    try {
      // Here you would integrate with Stripe to create a checkout session
      // For now, we'll return the package details
      return {
        success: true,
        packageDetails: {
          ...package,
          packageId: args.creditPackage,
        },
        userId,
        successUrl: args.successUrl,
        cancelUrl: args.cancelUrl,
        // In real implementation, you'd return the Stripe checkout URL
        checkoutUrl: `${args.successUrl}?session_id=mock_session_${args.creditPackage}`,
      };

    } catch (error) {
      console.error("Checkout session creation error:", error);
      throw createError("Failed to create checkout session", ERROR_CODES.PAYMENT_FAILED, 500);
    }
  },
});

// Create Stripe subscription for plan upgrade
export const createSubscription = mutation({
  args: {
    plan: v.union(v.literal("pro"), v.literal("enterprise")),
    billingCycle: v.union(v.literal("monthly"), v.literal("yearly")),
    successUrl: v.string(),
    cancelUrl: v.string(),
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

    // Check if user already has this plan or higher
    if (user.plan === args.plan || (user.plan === "enterprise" && args.plan === "pro")) {
      throw createError("User already has this plan or higher", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    // Plan pricing
    const pricing = {
      pro: {
        monthly: { price: 2900, credits: 500 }, // $29/month
        yearly: { price: 29000, credits: 6000 }, // $290/year (2 months free)
      },
      enterprise: {
        monthly: { price: 9900, credits: 2000 }, // $99/month
        yearly: { price: 99000, credits: 24000 }, // $990/year (2 months free)
      },
    };

    const planDetails = pricing[args.plan][args.billingCycle];

    try {
      // Here you would integrate with Stripe to create a subscription
      // For now, we'll return the plan details
      return {
        success: true,
        planDetails: {
          ...planDetails,
          plan: args.plan,
          billingCycle: args.billingCycle,
        },
        userId,
        successUrl: args.successUrl,
        cancelUrl: args.cancelUrl,
        // In real implementation, you'd return the Stripe checkout URL
        checkoutUrl: `${args.successUrl}?session_id=mock_subscription_${args.plan}_${args.billingCycle}`,
      };

    } catch (error) {
      console.error("Subscription creation error:", error);
      throw createError("Failed to create subscription", ERROR_CODES.PAYMENT_FAILED, 500);
    }
  },
});

// Cancel subscription
export const cancelSubscription = mutation({
  args: { 
    cancelAtPeriodEnd: v.optional(v.boolean()),
    reason: v.optional(v.string()),
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

    // Get active billing record
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    if (!billing) {
      throw createError("No active subscription found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    const cancelAtPeriodEnd = args.cancelAtPeriodEnd ?? true;

    try {
      // Update billing record
      await ctx.db.patch(billing._id, {
        cancelAtPeriodEnd,
        status: cancelAtPeriodEnd ? "active" : "cancelled",
        updatedAt: Date.now(),
      });

      // If immediate cancellation, downgrade to free plan
      if (!cancelAtPeriodEnd) {
        await ctx.db.patch(userId, {
          plan: "free",
          updatedAt: Date.now(),
        });
      }

      // Send notification
      await ctx.db.insert("notifications", {
        userId,
        type: "system_alert",
        title: cancelAtPeriodEnd ? "Subscription Will Cancel" : "Subscription Cancelled",
        message: cancelAtPeriodEnd 
          ? `Your subscription will cancel at the end of the current billing period (${new Date(billing.currentPeriodEnd).toLocaleDateString()}).`
          : "Your subscription has been cancelled immediately. You've been downgraded to the free plan.",
        data: { 
          cancelAtPeriodEnd,
          reason: args.reason,
          billingPeriodEnd: billing.currentPeriodEnd,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return { 
        success: true,
        cancelAtPeriodEnd,
        billingPeriodEnd: billing.currentPeriodEnd,
      };

    } catch (error) {
      console.error("Subscription cancellation error:", error);
      throw createError("Failed to cancel subscription", ERROR_CODES.PAYMENT_FAILED, 500);
    }
  },
});

// Update subscription (change plan or billing cycle)
export const updateSubscription = mutation({
  args: {
    plan: v.optional(v.union(v.literal("pro"), v.literal("enterprise"))),
    billingCycle: v.optional(v.union(v.literal("monthly"), v.literal("yearly"))),
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

    // Get active billing record
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    if (!billing) {
      throw createError("No active subscription found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    const newPlan = args.plan || billing.plan;
    const newBillingCycle = args.billingCycle || billing.billingCycle;

    // Validate the change
    if (newPlan === billing.plan && newBillingCycle === billing.billingCycle) {
      throw createError("No changes specified", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    try {
      // Update billing record
      await ctx.db.patch(billing._id, {
        plan: newPlan,
        billingCycle: newBillingCycle,
        updatedAt: Date.now(),
      });

      // Update user plan
      if (newPlan !== user.plan) {
        await ctx.db.patch(userId, {
          plan: newPlan,
          updatedAt: Date.now(),
        });
      }

      // Send notification
      await ctx.db.insert("notifications", {
        userId,
        type: "plan_upgraded",
        title: "Subscription Updated! 🎉",
        message: `Your subscription has been updated to ${newPlan} (${newBillingCycle}). Changes will take effect on your next billing cycle.`,
        data: { 
          newPlan,
          newBillingCycle,
          previousPlan: billing.plan,
          previousBillingCycle: billing.billingCycle,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return { 
        success: true,
        newPlan,
        newBillingCycle,
      };

    } catch (error) {
      console.error("Subscription update error:", error);
      throw createError("Failed to update subscription", ERROR_CODES.PAYMENT_FAILED, 500);
    }
  },
});

// Process refund
export const processRefund = mutation({
  args: {
    transactionId: v.string(),
    amount: v.number(),
    reason: v.string(),
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

    // Find the original transaction
    const originalTransaction = await ctx.db
      .query("creditTransactions")
      .filter((q) => 
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("stripePaymentId"), args.transactionId),
          q.eq(q.field("type"), "purchase")
        )
      )
      .unique();

    if (!originalTransaction) {
      throw createError("Original transaction not found", ERROR_CODES.RESOURCE_NOT_FOUND, 404);
    }

    // Validate refund amount
    if (args.amount <= 0 || args.amount > originalTransaction.amount) {
      throw createError("Invalid refund amount", ERROR_CODES.VALIDATION_ERROR, 400);
    }

    const newBalance = Math.max(0, user.credits - args.amount);

    try {
      // Update user credits
      await ctx.db.patch(userId, {
        credits: newBalance,
        updatedAt: Date.now(),
      });

      // Record refund transaction
      await ctx.db.insert("creditTransactions", {
        userId,
        type: "refund",
        amount: -args.amount,
        description: `Refund: ${args.reason}`,
        stripePaymentId: args.transactionId,
        balanceAfter: newBalance,
        createdAt: Date.now(),
      });

      // Send notification
      await ctx.db.insert("notifications", {
        userId,
        type: "system_alert",
        title: "Refund Processed 💰",
        message: `A refund of ${args.amount} credits has been processed. Your account balance has been adjusted.`,
        data: { 
          refundAmount: args.amount,
          newBalance,
          reason: args.reason,
          originalTransactionId: args.transactionId,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return { 
        success: true,
        refundAmount: args.amount,
        newBalance,
      };

    } catch (error) {
      console.error("Refund processing error:", error);
      throw createError("Failed to process refund", ERROR_CODES.PAYMENT_FAILED, 500);
    }
  },
});