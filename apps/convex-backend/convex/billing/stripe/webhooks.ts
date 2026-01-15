/**
 * Stripe Webhook Handlers
 *
 * Handles Stripe webhook events for custom subscriptions:
 * - checkout.session.completed: Activate subscription, allocate initial credits
 * - invoice.paid: Renew period, reset/allocate credits
 * - invoice.payment_failed: Pause credits, notify admin
 * - customer.subscription.updated: Track plan/payment method changes
 * - customer.subscription.deleted: Handle cancellation
 * - payment_intent.succeeded: Handle extra credit purchases
 */

import { internalMutation, internalAction, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";
import Stripe from "stripe";
import { getStripeClient, getWebhookSecret } from "./client";

// ============================================================================
// IDEMPOTENCY PROTECTION
// ============================================================================

/**
 * Check if a webhook event has already been processed.
 * Prevents duplicate processing if Stripe retries the webhook.
 */
export const isEventProcessed = internalQuery({
  args: {
    eventId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("processedWebhooks")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    return { processed: !!existing, result: existing?.result };
  },
});

/**
 * Atomically try to claim a webhook event for processing.
 *
 * This combines the check-and-mark operation into a single atomic mutation
 * to prevent race conditions where two concurrent requests both think they
 * should process the same event.
 *
 * Returns:
 * - { claimed: true } if this request successfully claimed the event
 * - { claimed: false, result: string } if event was already processed
 */
export const tryClaimEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if already processed - this is atomic within Convex mutations
    const existing = await ctx.db
      .query("processedWebhooks")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (existing) {
      // Event already claimed/processed by another request
      return { claimed: false, result: existing.result };
    }

    // Claim the event by inserting a "processing" record
    // This prevents other concurrent requests from also claiming it
    await ctx.db.insert("processedWebhooks", {
      eventId: args.eventId,
      eventType: args.eventType,
      processedAt: Date.now(),
      result: "processing" as "success" | "skipped" | "failed", // Will be updated when done
    });

    return { claimed: true };
  },
});

/**
 * Update the result of a claimed webhook event after processing.
 * Called after successfully or unsuccessfully handling an event.
 */
export const markEventProcessed = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    result: v.union(v.literal("success"), v.literal("skipped"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find the existing record (should exist from tryClaimEvent)
    const existing = await ctx.db
      .query("processedWebhooks")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();

    if (existing) {
      // Update the existing record with the final result
      await ctx.db.patch(existing._id, {
        result: args.result,
        error: args.error,
        processedAt: Date.now(),
      });
      return { alreadyExists: false, updated: true };
    }

    // Fallback: insert if somehow the claim record doesn't exist
    // This handles edge cases and backward compatibility
    await ctx.db.insert("processedWebhooks", {
      eventId: args.eventId,
      eventType: args.eventType,
      processedAt: Date.now(),
      result: args.result,
      error: args.error,
    });

    return { alreadyExists: false, updated: false };
  },
});

// ============================================================================
// WEBHOOK HANDLERS
// ============================================================================

/**
 * Verify Stripe webhook signature and parse event.
 * Called from the HTTP handler.
 * Uses constructEventAsync for Convex's SubtleCrypto environment.
 */
export const verifyAndParseWebhook = internalAction({
  args: {
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; event?: Stripe.Event; error?: string }> => {
    try {
      const stripe = getStripeClient();
      const webhookSecret = getWebhookSecret();

      // IMPORTANT: Use constructEventAsync for environments with SubtleCrypto (like Convex)
      const event = await stripe.webhooks.constructEventAsync(
        args.payload,
        args.signature,
        webhookSecret
      );

      return { success: true, event };
    } catch (error) {
      console.error("[Stripe Webhook] Signature verification failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle checkout.session.completed event.
 * Activates subscription and allocates initial credits.
 */
export const handleCheckoutCompleted = internalMutation({
  args: {
    sessionId: v.string(),
    subscriptionId: v.string(),
    customerId: v.string(),
    paymentMethodType: v.optional(v.string()),
    metadata: v.optional(v.any()),
    // Stripe subscription period dates (seconds, from subscription object)
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    console.log("[Stripe Webhook] checkout.session.completed", {
      sessionId: args.sessionId,
      subscriptionId: args.subscriptionId,
    });

    // Find the custom subscription by checkout session ID
    const customSub = await ctx.db
      .query("customSubscriptions")
      .withIndex("by_checkout_session", (q) =>
        q.eq("checkoutSessionId", args.sessionId)
      )
      .unique();

    if (!customSub) {
      console.error("[Stripe Webhook] Custom subscription not found for session:", args.sessionId);
      return { success: false, error: "Subscription not found" };
    }

    // Determine payment method type
    const paymentMethodType =
      args.paymentMethodType === "us_bank_account" ? "us_bank_account" : "card";

    // Calculate convenience fee if card
    const convenienceFeeCents =
      paymentMethodType === "card"
        ? Math.round(customSub.monthlyPriceCents * 0.03)
        : 0;

    // Use Stripe's actual period dates if provided, otherwise fall back to 30-day estimate
    const now = Date.now();
    const periodStart = args.currentPeriodStart ? args.currentPeriodStart * 1000 : now;
    const periodEnd = args.currentPeriodEnd
      ? args.currentPeriodEnd * 1000
      : now + 30 * 24 * 60 * 60 * 1000; // Fallback: 30 days

    // Update subscription to active
    await ctx.db.patch(customSub._id, {
      status: "active",
      stripeSubscriptionId: args.subscriptionId,
      paymentMethodType,
      convenienceFeeCents,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      creditsAllocatedAt: now,
      updatedAt: now,
    });

    // Create initial credit allocation
    await ctx.db.insert("subscriptionCreditAllocations", {
      userId: customSub.userId,
      subscriptionId: customSub._id,
      periodStart: periodStart,
      periodEnd: periodEnd,
      creditsAllocated: customSub.monthlyCredits,
      creditsUsed: 0,
      creditsExpired: 0,
      status: "active",
      createdAt: now,
    });

    // Update user with subscription credits and plan
    const user = await ctx.db.get(customSub.userId);
    if (user) {
      await ctx.db.patch(customSub.userId, {
        subscriptionCredits: customSub.monthlyCredits,
        plan: "custom",
        stripeCustomerId: args.customerId,
        updatedAt: now,
      });
    }

    // Log subscription event
    await ctx.db.insert("subscriptionEvents", {
      userId: customSub.userId,
      eventType: "subscription_created",
      newPlan: "custom",
      amount: customSub.monthlyPriceCents + convenienceFeeCents,
      currency: "USD",
      metadata: {
        stripeSubscriptionId: args.subscriptionId,
        sessionId: args.sessionId,
        paymentMethodType,
        monthlyCredits: customSub.monthlyCredits,
      },
      createdAt: now,
    });

    // Create notification for admin
    await ctx.db.insert("notifications", {
      userId: customSub.createdBy,
      type: "system_alert",
      title: "Subscription Activated",
      message: `Custom subscription for ${user?.email || "unknown"} is now active.`,
      data: {
        subscriptionId: customSub._id,
        userId: customSub.userId,
        monthlyPriceCents: customSub.monthlyPriceCents,
        monthlyCredits: customSub.monthlyCredits,
      },
      read: false,
      sent: false,
      createdAt: now,
    });

    console.log("[Stripe Webhook] Subscription activated successfully", {
      subscriptionId: customSub._id,
      userId: customSub.userId,
      credits: customSub.monthlyCredits,
    });

    return { success: true, subscriptionId: customSub._id };
  },
});

/**
 * Handle invoice.paid event.
 * Renews subscription period and allocates new credits.
 */
export const handleInvoicePaid = internalMutation({
  args: {
    invoiceId: v.string(),
    subscriptionId: v.string(),
    customerId: v.string(),
    amountPaid: v.number(),
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    console.log("[Stripe Webhook] invoice.paid", {
      invoiceId: args.invoiceId,
      subscriptionId: args.subscriptionId,
    });

    // Find custom subscription by Stripe subscription ID
    const customSub = await ctx.db
      .query("customSubscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.subscriptionId)
      )
      .unique();

    if (!customSub) {
      // This might be the first invoice after checkout - already handled by checkout.session.completed
      console.log("[Stripe Webhook] No custom subscription found - may be handled by checkout event");
      return { success: true, skipped: true };
    }

    const now = Date.now();

    // Expire previous period credits
    const previousAllocation = await ctx.db
      .query("subscriptionCreditAllocations")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", customSub._id)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    if (previousAllocation) {
      const unusedCredits =
        previousAllocation.creditsAllocated - previousAllocation.creditsUsed;

      await ctx.db.patch(previousAllocation._id, {
        status: "expired",
        creditsExpired: unusedCredits,
        expiredAt: now,
      });

      console.log("[Stripe Webhook] Expired previous allocation", {
        allocationId: previousAllocation._id,
        unusedCredits,
      });
    }

    // Convert Stripe timestamps (seconds) to milliseconds
    const periodStartMs = args.periodStart * 1000;
    const periodEndMs = args.periodEnd * 1000;

    // Create new credit allocation
    await ctx.db.insert("subscriptionCreditAllocations", {
      userId: customSub.userId,
      subscriptionId: customSub._id,
      periodStart: periodStartMs,
      periodEnd: periodEndMs,
      creditsAllocated: customSub.monthlyCredits,
      creditsUsed: 0,
      creditsExpired: 0,
      status: "active",
      createdAt: now,
    });

    // Update subscription period
    await ctx.db.patch(customSub._id, {
      currentPeriodStart: periodStartMs,
      currentPeriodEnd: periodEndMs,
      creditsAllocatedAt: now,
      status: "active", // Ensure active after successful payment
      updatedAt: now,
    });

    // Reset user subscription credits
    await ctx.db.patch(customSub.userId, {
      subscriptionCredits: customSub.monthlyCredits,
      updatedAt: now,
    });

    // Log subscription event
    await ctx.db.insert("subscriptionEvents", {
      userId: customSub.userId,
      eventType: "payment_succeeded",
      amount: args.amountPaid,
      currency: "USD",
      metadata: {
        invoiceId: args.invoiceId,
        stripeSubscriptionId: args.subscriptionId,
        creditsAllocated: customSub.monthlyCredits,
      },
      createdAt: now,
    });

    console.log("[Stripe Webhook] Credits renewed", {
      subscriptionId: customSub._id,
      userId: customSub.userId,
      credits: customSub.monthlyCredits,
    });

    return { success: true };
  },
});

/**
 * Handle invoice.payment_failed event.
 * Pauses credits immediately and notifies admin.
 */
export const handleInvoicePaymentFailed = internalMutation({
  args: {
    invoiceId: v.string(),
    subscriptionId: v.string(),
    customerId: v.string(),
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    console.log("[Stripe Webhook] invoice.payment_failed", {
      invoiceId: args.invoiceId,
      subscriptionId: args.subscriptionId,
      attemptCount: args.attemptCount,
    });

    // Find custom subscription
    const customSub = await ctx.db
      .query("customSubscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.subscriptionId)
      )
      .unique();

    if (!customSub) {
      console.error("[Stripe Webhook] Subscription not found for payment failure");
      return { success: false, error: "Subscription not found" };
    }

    const now = Date.now();

    // Mark subscription as past_due
    await ctx.db.patch(customSub._id, {
      status: "past_due",
      updatedAt: now,
    });

    // IMMEDIATE PAUSE: Set subscription credits to 0
    await ctx.db.patch(customSub.userId, {
      subscriptionCredits: 0,
      updatedAt: now,
    });

    // Get user for notification
    const user = await ctx.db.get(customSub.userId);

    // Log subscription event
    await ctx.db.insert("subscriptionEvents", {
      userId: customSub.userId,
      eventType: "payment_failed",
      metadata: {
        invoiceId: args.invoiceId,
        stripeSubscriptionId: args.subscriptionId,
        attemptCount: args.attemptCount,
        nextAttemptAt: args.nextAttemptAt,
      },
      createdAt: now,
    });

    // Notify admin (who created the subscription)
    await ctx.db.insert("notifications", {
      userId: customSub.createdBy,
      type: "credit_alert",
      title: "Payment Failed - Credits Paused",
      message: `Payment failed for ${user?.email || "customer"}. Subscription credits have been paused.`,
      data: {
        subscriptionId: customSub._id,
        userId: customSub.userId,
        invoiceId: args.invoiceId,
        attemptCount: args.attemptCount,
        nextAttemptAt: args.nextAttemptAt,
      },
      read: false,
      sent: false,
      createdAt: now,
    });

    // Also notify the customer
    await ctx.db.insert("notifications", {
      userId: customSub.userId,
      type: "credit_alert",
      title: "Payment Failed",
      message: "Your subscription payment failed. Please update your payment method to restore access.",
      data: {
        subscriptionId: customSub._id,
        invoiceId: args.invoiceId,
      },
      read: false,
      sent: false,
      createdAt: now,
    });

    console.log("[Stripe Webhook] Payment failed - credits paused", {
      subscriptionId: customSub._id,
      userId: customSub.userId,
    });

    return { success: true };
  },
});

/**
 * Handle customer.subscription.updated event.
 * Tracks payment method changes and status updates.
 */
export const handleSubscriptionUpdated = internalMutation({
  args: {
    subscriptionId: v.string(),
    status: v.string(),
    cancelAtPeriodEnd: v.boolean(),
    currentPeriodEnd: v.number(),
    defaultPaymentMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("[Stripe Webhook] customer.subscription.updated", {
      subscriptionId: args.subscriptionId,
      status: args.status,
    });

    const customSub = await ctx.db
      .query("customSubscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.subscriptionId)
      )
      .unique();

    if (!customSub) {
      console.log("[Stripe Webhook] No custom subscription found for update");
      return { success: true, skipped: true };
    }

    const now = Date.now();

    // Map Stripe status to our status
    let internalStatus: "active" | "past_due" | "cancelled" | "paused" = "active";
    if (args.status === "past_due") {
      internalStatus = "past_due";
    } else if (args.status === "canceled" || args.status === "unpaid") {
      internalStatus = "cancelled";
    } else if (args.status === "paused") {
      internalStatus = "paused";
    }

    // Update subscription
    await ctx.db.patch(customSub._id, {
      status: internalStatus,
      currentPeriodEnd: args.currentPeriodEnd * 1000, // Convert to ms
      updatedAt: now,
    });

    // Log event
    await ctx.db.insert("subscriptionEvents", {
      userId: customSub.userId,
      eventType: "subscription_updated",
      metadata: {
        stripeSubscriptionId: args.subscriptionId,
        status: args.status,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      },
      createdAt: now,
    });

    return { success: true };
  },
});

/**
 * Handle customer.subscription.deleted event.
 * Marks subscription as cancelled and handles credit expiration.
 */
export const handleSubscriptionDeleted = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[Stripe Webhook] customer.subscription.deleted", {
      subscriptionId: args.subscriptionId,
    });

    const customSub = await ctx.db
      .query("customSubscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.subscriptionId)
      )
      .unique();

    if (!customSub) {
      console.log("[Stripe Webhook] No custom subscription found for deletion");
      return { success: true, skipped: true };
    }

    const now = Date.now();

    // Mark subscription as cancelled
    await ctx.db.patch(customSub._id, {
      status: "cancelled",
      updatedAt: now,
    });

    // Expire any active credit allocation
    const activeAllocation = await ctx.db
      .query("subscriptionCreditAllocations")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", customSub._id)
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .unique();

    if (activeAllocation) {
      const unusedCredits =
        activeAllocation.creditsAllocated - activeAllocation.creditsUsed;

      await ctx.db.patch(activeAllocation._id, {
        status: "expired",
        creditsExpired: unusedCredits,
        expiredAt: now,
      });
    }

    // Set user subscription credits to 0
    await ctx.db.patch(customSub.userId, {
      subscriptionCredits: 0,
      plan: "free", // Downgrade to free
      updatedAt: now,
    });

    // Log event
    await ctx.db.insert("subscriptionEvents", {
      userId: customSub.userId,
      eventType: "subscription_cancelled",
      metadata: {
        stripeSubscriptionId: args.subscriptionId,
      },
      createdAt: now,
    });

    // Get user for notification
    const user = await ctx.db.get(customSub.userId);

    // Notify admin
    await ctx.db.insert("notifications", {
      userId: customSub.createdBy,
      type: "system_alert",
      title: "Subscription Cancelled",
      message: `Subscription for ${user?.email || "customer"} has been cancelled.`,
      data: {
        subscriptionId: customSub._id,
        userId: customSub.userId,
      },
      read: false,
      sent: false,
      createdAt: now,
    });

    console.log("[Stripe Webhook] Subscription cancelled", {
      subscriptionId: customSub._id,
      userId: customSub.userId,
    });

    return { success: true };
  },
});

/**
 * Handle payment_intent.succeeded event for extra credit purchases.
 */
export const handleExtraCreditPayment = internalMutation({
  args: {
    paymentIntentId: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    console.log("[Stripe Webhook] payment_intent.succeeded (extra credits)", {
      paymentIntentId: args.paymentIntentId,
    });

    // Check if this is an extra credit purchase via metadata
    const metadata = args.metadata as Record<string, string> | undefined;
    if (!metadata || metadata.type !== "extra_credits") {
      // Not an extra credit purchase - ignore
      return { success: true, skipped: true };
    }

    const userId = metadata.userId as Id<"users"> | undefined;
    const credits = parseInt(metadata.credits || "0", 10);

    if (!userId || !credits) {
      console.error("[Stripe Webhook] Invalid extra credit metadata");
      return { success: false, error: "Invalid metadata" };
    }

    // Find the pending purchase
    const purchase = await ctx.db
      .query("extraCreditPurchases")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId)
      )
      .unique();

    if (!purchase) {
      console.error("[Stripe Webhook] Extra credit purchase not found");
      return { success: false, error: "Purchase not found" };
    }

    const now = Date.now();

    // Mark purchase as completed
    await ctx.db.patch(purchase._id, {
      status: "completed",
      completedAt: now,
    });

    // Add credits to user (to purchased credits, not subscription credits)
    const user = await ctx.db.get(userId);
    if (user) {
      await ctx.db.patch(userId, {
        credits: (user.credits || 0) + credits,
        updatedAt: now,
      });
    }

    // Record credit transaction
    await ctx.db.insert("creditTransactions", {
      userId,
      type: "purchase",
      amount: credits,
      description: `Extra credit purchase - ${credits} credits`,
      balanceAfter: (user?.credits || 0) + credits,
      createdAt: now,
    });

    console.log("[Stripe Webhook] Extra credits added", {
      userId,
      credits,
      paymentIntentId: args.paymentIntentId,
    });

    return { success: true, credits };
  },
});
