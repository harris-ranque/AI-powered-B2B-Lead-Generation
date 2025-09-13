import { mutation, action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api } from "../_generated/api";
import Stripe from "stripe";

// Create Stripe checkout session
export const createCheckoutSession = action({
  args: {
    priceId: v.string(),
    planId: v.string(),
    billingCycle: v.union(v.literal("monthly"), v.literal("yearly")),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    "use node";
    const user = await requireAuth(ctx);

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    // Ensure success/cancel URLs are properly set
    const appUrl = process.env.APP_URL;
    if (!args.successUrl && !appUrl) {
      throw new Error(
        "Missing successUrl and APP_URL; cannot construct redirect URLs",
      );
    }

    try {
      const stripe = new Stripe(stripeSecretKey);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: args.priceId, quantity: 1 }],
        success_url:
          args.successUrl ||
          `${appUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: args.cancelUrl || `${appUrl}/pricing`,
        customer: user.stripeCustomerId,
        customer_email: user.stripeCustomerId ? undefined : user.email,
        metadata: {
          userId: user._id,
          planId: args.planId,
          billingCycle: args.billingCycle,
        },
        subscription_data: {
          metadata: {
            userId: user._id,
            planId: args.planId,
          },
        },
      });

      return {
        sessionId: session.id,
        url: session.url!,
      };
    } catch (error) {
      console.error("Error creating Stripe checkout session:", error);
      throw new Error("Failed to create checkout session");
    }
  },
});

// Create Stripe customer portal session
export const createPortalSession = action({
  args: {
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    "use node";
    const user = await requireAuth(ctx);

    if (!user.stripeCustomerId) {
      throw new Error("No Stripe customer ID found for user");
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      const stripe = new Stripe(stripeSecretKey);
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: args.returnUrl || `${process.env.APP_URL}/billing`,
      });

      return { url: session.url };
    } catch (error) {
      console.error("Error creating Stripe portal session:", error);
      throw new Error("Failed to create portal session");
    }
  },
});

// Create Stripe customer if doesn't exist
export const createStripeCustomer = action({
  args: {},
  handler: async (ctx, args) => {
    "use node";
    const user = await requireAuth(ctx);

    if (user.stripeCustomerId) {
      return { customerId: user.stripeCustomerId };
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      const stripe = new Stripe(stripeSecretKey);
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: user._id },
      });

      // Update user with Stripe customer ID
      await ctx.runMutation(api.users.mutations.updateStripeCustomerId, {
        customerId: customer.id,
      });

      return {
        customerId: customer.id,
      };
    } catch (error) {
      console.error("Error creating Stripe customer:", error);
      throw new Error("Failed to create Stripe customer");
    }
  },
});

// Get current subscription status
export const getSubscriptionStatus = mutation({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Get billing record
    const billing = await ctx.db
      .query("billing")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .unique();

    // Get current usage
    const usage = await ctx.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
      .unique();

    return {
      plan: user.plan,
      billing,
      usage,
      hasActiveSubscription: !!billing && billing.status === "active",
      isTrialing: billing?.isTrialing || false,
    };
  },
});

// Cancel subscription at period end
export const cancelSubscription = action({
  args: {
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    "use node";
    const user = await requireAuth(ctx);

    if (!user.stripeSubscriptionId) {
      throw new Error("No active subscription found");
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      const stripe = new Stripe(stripeSecretKey);
      const subscription = await stripe.subscriptions.update(
        user.stripeSubscriptionId,
        { cancel_at_period_end: args.cancelAtPeriodEnd },
      );

      return {
        cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
        currentPeriodEnd:
          ((subscription as any).current_period_end || 0) * 1000,
      };
    } catch (error) {
      console.error("Error updating subscription:", error);
      throw new Error("Failed to update subscription");
    }
  },
});
