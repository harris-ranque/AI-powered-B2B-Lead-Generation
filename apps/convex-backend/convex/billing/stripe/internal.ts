/**
 * Stripe Subscription Internal Mutations
 *
 * Internal mutations for subscription management.
 * Separated from main subscriptions.ts to avoid circular type references.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

// Internal Queries

export const getActiveSubscriptionForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("customSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "active"),
          q.eq(q.field("status"), "pending_checkout"),
          q.eq(q.field("status"), "past_due")
        )
      )
      .first();

    return subscription;
  },
});

export const getSubscriptionById = internalQuery({
  args: {
    subscriptionId: v.id("customSubscriptions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.subscriptionId);
  },
});

export const getByStripeSubscriptionId = internalQuery({
  args: {
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("customSubscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .first();
  },
});

// Internal Mutations

export const createStripeCustomerRecord = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if record already exists
    const existing = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("stripeCustomers", {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      email: args.email,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createCustomSubscriptionRecord = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    stripeProductId: v.string(),
    stripePriceIdAch: v.string(),
    stripePriceIdCard: v.string(),
    monthlyPriceCents: v.number(),
    monthlyCredits: v.number(),
    allowExtraCredits: v.boolean(),
    extraCreditPriceCents: v.optional(v.number()),
    extraCreditPackSize: v.optional(v.number()),
    adminNotes: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("customSubscriptions", {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      stripeProductId: args.stripeProductId,
      stripePriceIdAch: args.stripePriceIdAch,
      stripePriceIdCard: args.stripePriceIdCard,
      monthlyPriceCents: args.monthlyPriceCents,
      monthlyCredits: args.monthlyCredits,
      allowExtraCredits: args.allowExtraCredits,
      extraCreditPriceCents: args.extraCreditPriceCents,
      extraCreditPackSize: args.extraCreditPackSize,
      status: "pending_checkout",
      adminNotes: args.adminNotes,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Legacy: Update single checkout URL (deprecated - use updateCheckoutUrls)
 */
export const updateCheckoutUrl = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
    checkoutUrl: v.string(),
    checkoutExpiresAt: v.number(),
    checkoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      checkoutUrl: args.checkoutUrl,
      checkoutExpiresAt: args.checkoutExpiresAt,
      checkoutSessionId: args.checkoutSessionId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update dual checkout URLs (ACH and Card with different prices)
 */
export const updateCheckoutUrls = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
    checkoutUrlAch: v.string(),
    checkoutUrlCard: v.string(),
    checkoutExpiresAt: v.number(),
    checkoutSessionIdAch: v.string(),
    checkoutSessionIdCard: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      checkoutUrlAch: args.checkoutUrlAch,
      checkoutUrlCard: args.checkoutUrlCard,
      checkoutExpiresAt: args.checkoutExpiresAt,
      checkoutSessionIdAch: args.checkoutSessionIdAch,
      checkoutSessionIdCard: args.checkoutSessionIdCard,
      // Also set legacy field for backward compatibility
      checkoutUrl: args.checkoutUrlAch,
      checkoutSessionId: args.checkoutSessionIdAch,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Delete a pending checkout subscription (admin only)
 * Only allows deletion of pending_checkout status subscriptions
 */
export const deletePendingSubscription = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (subscription.status !== "pending_checkout") {
      throw new Error("Can only delete subscriptions with pending_checkout status");
    }

    await ctx.db.delete(args.subscriptionId);
    return { success: true };
  },
});

export const activateSubscription = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
    stripeSubscriptionId: v.string(),
    paymentMethodType: v.union(v.literal("card"), v.literal("us_bank_account")),
    convenienceFeeCents: v.optional(v.number()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const now = Date.now();

    // Update subscription status
    await ctx.db.patch(args.subscriptionId, {
      status: "active",
      stripeSubscriptionId: args.stripeSubscriptionId,
      paymentMethodType: args.paymentMethodType,
      convenienceFeeCents: args.convenienceFeeCents,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      updatedAt: now,
    });

    // Update user plan to custom
    await ctx.db.patch(subscription.userId, {
      plan: "custom",
      subscriptionCredits: subscription.monthlyCredits,
      updatedAt: now,
    });

    // Create initial credit allocation
    await ctx.db.insert("subscriptionCreditAllocations", {
      userId: subscription.userId,
      subscriptionId: args.subscriptionId,
      periodStart: args.currentPeriodStart,
      periodEnd: args.currentPeriodEnd,
      creditsAllocated: subscription.monthlyCredits,
      creditsUsed: 0,
      creditsExpired: 0,
      status: "active",
      createdAt: now,
    });

    return { success: true };
  },
});

export const updateSubscriptionStatus = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
    status: v.union(
      v.literal("pending_checkout"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("cancelled"),
      v.literal("paused")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const renewSubscriptionCredits = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const now = Date.now();

    // Expire previous credit allocation
    const previousAllocation = await ctx.db
      .query("subscriptionCreditAllocations")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", subscription.userId).eq("status", "active")
      )
      .first();

    if (previousAllocation) {
      const unusedCredits =
        previousAllocation.creditsAllocated - previousAllocation.creditsUsed;
      await ctx.db.patch(previousAllocation._id, {
        status: "expired",
        creditsExpired: unusedCredits,
        expiredAt: now,
      });
    }

    // Update subscription period
    await ctx.db.patch(args.subscriptionId, {
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      updatedAt: now,
    });

    // Reset user subscription credits
    await ctx.db.patch(subscription.userId, {
      subscriptionCredits: subscription.monthlyCredits,
      updatedAt: now,
    });

    // Create new credit allocation
    await ctx.db.insert("subscriptionCreditAllocations", {
      userId: subscription.userId,
      subscriptionId: args.subscriptionId,
      periodStart: args.currentPeriodStart,
      periodEnd: args.currentPeriodEnd,
      creditsAllocated: subscription.monthlyCredits,
      creditsUsed: 0,
      creditsExpired: 0,
      status: "active",
      createdAt: now,
    });

    return { success: true };
  },
});

export const pauseSubscriptionCredits = internalMutation({
  args: {
    subscriptionId: v.id("customSubscriptions"),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    // Set subscription credits to 0 (paused)
    await ctx.db.patch(subscription.userId, {
      subscriptionCredits: 0,
      updatedAt: Date.now(),
    });

    await ctx.db.patch(args.subscriptionId, {
      status: "paused",
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
