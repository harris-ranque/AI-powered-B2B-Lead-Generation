import { mutation, action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api } from "../_generated/api";

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
    const user = await requireAuth(ctx);
    
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      // Create checkout session with Stripe API - properly form-encode nested objects
      const params = new URLSearchParams();
      params.set('mode', 'subscription');
      params.set('payment_method_types[0]', 'card');
      params.set('line_items[0][price]', args.priceId);
      params.set('line_items[0][quantity]', '1');
      params.set('success_url', args.successUrl || `${process.env.APP_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`);
      params.set('cancel_url', args.cancelUrl || `${process.env.APP_URL}/pricing`);
      
      if (user.stripeCustomerId) {
        params.set('customer', user.stripeCustomerId);
      } else {
        params.set('customer_email', user.email);
      }
      
      params.set('metadata[userId]', user._id);
      params.set('metadata[planId]', args.planId);
      params.set('metadata[billingCycle]', args.billingCycle);
      params.set('subscription_data[metadata][userId]', user._id);
      params.set('subscription_data[metadata][planId]', args.planId);

      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe checkout error:', error);
        throw new Error('Failed to create checkout session');
      }

      const session: any = await response.json();
      
      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (error) {
      console.error('Error creating Stripe checkout session:', error);
      throw new Error('Failed to create checkout session');
    }
  },
});

// Create Stripe customer portal session
export const createPortalSession = action({
  args: {
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    if (!user.stripeCustomerId) {
      throw new Error("No Stripe customer ID found for user");
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      const portalData = {
        customer: user.stripeCustomerId,
        return_url: args.returnUrl || `${process.env.APP_URL}/billing`,
      };

      const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(portalData).toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe portal error:', error);
        throw new Error('Failed to create portal session');
      }

      const session: any = await response.json();
      
      return {
        url: session.url,
      };
    } catch (error) {
      console.error('Error creating Stripe portal session:', error);
      throw new Error('Failed to create portal session');
    }
  },
});

// Create Stripe customer if doesn't exist
export const createStripeCustomer = action({
  args: {},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    
    if (user.stripeCustomerId) {
      return { customerId: user.stripeCustomerId };
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      const customerData = {
        email: user.email,
        name: user.name || "",
        "metadata[userId]": user._id,
      };

      const response = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(customerData).toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe customer creation error:', error);
        throw new Error('Failed to create Stripe customer');
      }

      const customer: any = await response.json();

      // Update user with Stripe customer ID
      await ctx.runMutation(api.users.mutations.updateStripeCustomerId, {
        customerId: customer.id,
      });
      
      return {
        customerId: customer.id,
      };
    } catch (error) {
      console.error('Error creating Stripe customer:', error);
      throw new Error('Failed to create Stripe customer');
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
    const user = await requireAuth(ctx);
    
    if (!user.stripeSubscriptionId) {
      throw new Error("No active subscription found");
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    try {
      const updateData = {
        cancel_at_period_end: args.cancelAtPeriodEnd.toString(),
      };

      const response = await fetch(`https://api.stripe.com/v1/subscriptions/${user.stripeSubscriptionId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(updateData).toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Stripe subscription update error:', error);
        throw new Error('Failed to update subscription');
      }

      const subscription: any = await response.json();
      
      return {
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end * 1000,
      };
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw new Error('Failed to update subscription');
    }
  },
});