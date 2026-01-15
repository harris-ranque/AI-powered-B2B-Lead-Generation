/**
 * Billing Mutations
 *
 * Core billing mutations for subscription and credits management.
 * Checkout flows are handled via billing/fastspring.ts actions.
 */

import { mutation, action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api } from "../_generated/api";

/**
 * Get current subscription status
 * Returns the user's plan, billing info, and usage stats
 */
export const getSubscriptionStatus = mutation({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Get billing record
    const billing = await ctx.db
      .query("billing")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    // Get current usage
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_current", (q) =>
        q.eq("userId", user._id).eq("isCurrentPeriod", true)
      )
      .unique();

    return {
      plan: user.plan,
      billing,
      usage,
      hasActiveSubscription: !!billing && billing.status === "active",
      isTrialing: billing?.isTrialing || false,
      cancelAtPeriodEnd: billing?.cancelAtPeriodEnd || false,
      currentPeriodEnd: billing?.currentPeriodEnd,
    };
  },
});

/**
 * Cancel subscription
 * Uses FastSpring API via fastspring.ts actions
 *
 * @param immediately - If true, cancels immediately. If false, cancels at period end.
 */
export const cancelSubscription = action({
  args: {
    immediately: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; message?: string }> => {
    const user = await requireAuth(ctx);

    if (!user.fastspringSubscriptionId) {
      throw new Error("No active subscription found");
    }

    // Call FastSpring management action
    const result: { success: boolean; message?: string } = await ctx.runAction(
      api.billing.fastspring.manageSubscription,
      {
        action: args.immediately ? "cancel_immediately" : "cancel",
      }
    );

    return result;
  },
});

/**
 * Reactivate a cancelled subscription
 * Subscription must be in cancelled (but not yet deactivated) state
 */
export const reactivateSubscription = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; message?: string }> => {
    const user = await requireAuth(ctx);

    if (!user.fastspringSubscriptionId) {
      throw new Error("No subscription found to reactivate");
    }

    // Call FastSpring management action
    const result: { success: boolean; message?: string } = await ctx.runAction(
      api.billing.fastspring.manageSubscription,
      {
        action: "reactivate",
      }
    );

    return result;
  },
});

/**
 * Get billing portal URL
 * Returns a pre-authenticated URL to the FastSpring account management portal
 * where users can update payment methods, view invoices, etc.
 */
export const getBillingPortalUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string } | { error: string }> => {
    // Delegate to FastSpring action
    const result: { url: string } | { error: string } = await ctx.runAction(
      api.billing.fastspring.getManagementUrl,
      {}
    );
    return result;
  },
});

/**
 * Get subscription details from payment provider
 * Returns detailed subscription information including next charge date
 */
export const getSubscriptionDetails = action({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown> | null> => {
    // Delegate to FastSpring action
    const result: Record<string, unknown> | null = await ctx.runAction(
      api.billing.fastspring.getSubscriptionDetails,
      {}
    );
    return result;
  },
});

/**
 * Create subscription checkout
 * Generates secure checkout data for FastSpring popup
 */
export const createSubscriptionCheckout = action({
  args: {
    planId: v.string(),
    billingCycle: v.union(v.literal("monthly"), v.literal("yearly")),
  },
  handler: async (ctx, args): Promise<{ securePayload: string; secureKey: string }> => {
    // Delegate to FastSpring action
    const result: { securePayload: string; secureKey: string } = await ctx.runAction(
      api.billing.fastspring.createSubscriptionCheckout,
      {
        planId: args.planId,
        billingCycle: args.billingCycle,
      }
    );
    return result;
  },
});

/**
 * Create credits checkout
 * Generates secure checkout data for FastSpring popup
 */
export const createCreditsCheckout = action({
  args: {
    credits: v.number(),
  },
  handler: async (ctx, args): Promise<{ securePayload: string; secureKey: string }> => {
    // Delegate to FastSpring action
    const result: { securePayload: string; secureKey: string } = await ctx.runAction(
      api.billing.fastspring.createCreditsCheckout,
      {
        credits: args.credits,
      }
    );
    return result;
  },
});

/**
 * Validate completed order
 * Called after FastSpring checkout completion to verify the order
 */
export const validateOrder = action({
  args: {
    orderId: v.string(),
    orderReference: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ valid: boolean; credits?: number; plan?: string }> => {
    // Delegate to FastSpring action
    const result: { valid: boolean; credits?: number; plan?: string } = await ctx.runAction(
      api.billing.fastspring.validateOrder,
      {
        orderId: args.orderId,
        orderReference: args.orderReference,
      }
    );
    return result;
  },
});
