/**
 * Stripe Custom Subscription Mutations
 *
 * Admin-facing mutations for creating and managing custom subscriptions.
 * Uses dual-price strategy for ACH (no fee) vs Card (3% convenience fee).
 */

import { v } from "convex/values";
import { action, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import {
  getStripeClient,
  calculateConvenienceFee,
  CHECKOUT_EXPIRATION_SECONDS,
  getCustomProductId,
} from "./client";

/**
 * Create a custom subscription for a customer (Admin only)
 *
 * Flow:
 * 1. Create/find Stripe Customer
 * 2. Create dual prices (ACH & Card with 3% fee)
 * 3. Create customSubscription record in pending_checkout state
 * 4. Generate Stripe Checkout session
 * 5. Return checkout URL for admin to send to customer
 */
export const createCustomSubscription = action({
  args: {
    customerEmail: v.string(),
    customerName: v.optional(v.string()),
    monthlyPriceCents: v.number(),
    monthlyCredits: v.number(),
    allowExtraCredits: v.boolean(),
    extraCreditPriceCents: v.optional(v.number()),
    extraCreditPackSize: v.optional(v.number()),
    adminNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get admin identity
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized: Must be logged in");
    }

    // Verify admin role
    const adminUser: Doc<"users"> | null = await ctx.runQuery(internal.users.internal.getUserByClerkId, {
      clerkId: identity.subject,
    });
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    // Validate pricing
    if (args.monthlyPriceCents < 50000) {
      throw new Error("Minimum subscription price is $500/month");
    }
    if (args.monthlyPriceCents > 200000) {
      throw new Error("Maximum subscription price is $2000/month");
    }
    if (args.monthlyCredits < 100) {
      throw new Error("Minimum monthly credits is 100");
    }

    // Validate extra credit config
    if (args.allowExtraCredits) {
      if (!args.extraCreditPriceCents || args.extraCreditPriceCents <= 0) {
        throw new Error("Extra credit price required when allowing extra credits");
      }
      if (!args.extraCreditPackSize || args.extraCreditPackSize <= 0) {
        throw new Error("Extra credit pack size required when allowing extra credits");
      }
    }

    const stripe = getStripeClient();

    // Step 1: Find or create user by email
    let user: Doc<"users"> | null = await ctx.runQuery(internal.users.internal.getUserByEmail, {
      email: args.customerEmail,
    });

    let userId: Id<"users">;
    let stripeCustomerId: string;

    if (user) {
      userId = user._id;

      // Check for existing active subscription
      const existingSub: Doc<"customSubscriptions"> | null = await ctx.runQuery(internal.billing.stripe.internal.getActiveSubscriptionForUser, {
        userId,
      });
      if (existingSub) {
        throw new Error("User already has an active custom subscription");
      }

      // Use existing Stripe customer or create new one
      if (user.stripeCustomerId) {
        stripeCustomerId = user.stripeCustomerId;
      } else {
        const customer = await stripe.customers.create({
          email: args.customerEmail,
          name: args.customerName || args.customerEmail,
          metadata: {
            userId: userId,
            createdBy: adminUser._id,
          },
        });
        stripeCustomerId = customer.id;

        // Update user with Stripe customer ID
        await ctx.runMutation(internal.users.internal.updateStripeCustomerId, {
          userId,
          stripeCustomerId,
        });
      }
    } else {
      // Create new user account
      userId = await ctx.runMutation(internal.users.internal.createUserForSubscription, {
        email: args.customerEmail,
        name: args.customerName || args.customerEmail,
      });

      // Create Stripe customer
      const customer = await stripe.customers.create({
        email: args.customerEmail,
        name: args.customerName || args.customerEmail,
        metadata: {
          userId: userId,
          createdBy: adminUser._id,
        },
      });
      stripeCustomerId = customer.id;

      // Update user with Stripe customer ID
      await ctx.runMutation(internal.users.internal.updateStripeCustomerId, {
        userId,
        stripeCustomerId,
      });
    }

    // Step 2: Create Stripe Customer record
    await ctx.runMutation(internal.billing.stripe.internal.createStripeCustomerRecord, {
      userId,
      stripeCustomerId,
      email: args.customerEmail,
    });

    // Step 3: Get or create product
    let productId = getCustomProductId();
    if (!productId) {
      const product = await stripe.products.create({
        name: "Genni Custom Subscription",
        description: "Custom lead generation subscription with monthly credits",
        metadata: {
          type: "custom_subscription",
        },
      });
      productId = product.id;
      console.log(`Created Stripe product: ${productId}. Set STRIPE_CUSTOM_PRODUCT_ID env var.`);
    }

    // Step 4: Create dual prices (ACH and Card with 3% fee)
    const cardPriceCents = args.monthlyPriceCents + calculateConvenienceFee(args.monthlyPriceCents);

    const achPrice = await stripe.prices.create({
      product: productId,
      unit_amount: args.monthlyPriceCents,
      currency: "usd",
      recurring: {
        interval: "month",
      },
      metadata: {
        type: "custom_subscription",
        paymentMethod: "ach",
        monthlyCredits: args.monthlyCredits.toString(),
        userId: userId,
      },
    });

    const cardPrice = await stripe.prices.create({
      product: productId,
      unit_amount: cardPriceCents,
      currency: "usd",
      recurring: {
        interval: "month",
      },
      metadata: {
        type: "custom_subscription",
        paymentMethod: "card",
        monthlyCredits: args.monthlyCredits.toString(),
        userId: userId,
        convenienceFeeCents: calculateConvenienceFee(args.monthlyPriceCents).toString(),
      },
    });

    // Step 5: Create customSubscription record
    const subscriptionId: Id<"customSubscriptions"> = await ctx.runMutation(
      internal.billing.stripe.internal.createCustomSubscriptionRecord,
      {
        userId,
        stripeCustomerId,
        stripeProductId: productId,
        stripePriceIdAch: achPrice.id,
        stripePriceIdCard: cardPrice.id,
        monthlyPriceCents: args.monthlyPriceCents,
        monthlyCredits: args.monthlyCredits,
        allowExtraCredits: args.allowExtraCredits,
        extraCreditPriceCents: args.extraCreditPriceCents,
        extraCreditPackSize: args.extraCreditPackSize,
        adminNotes: args.adminNotes,
        createdBy: adminUser._id,
      }
    );

    // Step 6: Create Stripe Checkout session
    // Use ACH as default, customer can switch to card at checkout
    const appUrl = process.env.APP_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price: achPrice.id,
          quantity: 1,
        },
      ],
      payment_method_types: ["us_bank_account", "card"],
      payment_method_options: {
        us_bank_account: {
          financial_connections: {
            permissions: ["payment_method"],
          },
          verification_method: "instant",
        },
      },
      subscription_data: {
        metadata: {
          userId: userId,
          subscriptionId: subscriptionId,
          monthlyCredits: args.monthlyCredits.toString(),
          achPriceId: achPrice.id,
          cardPriceId: cardPrice.id,
        },
      },
      metadata: {
        userId: userId,
        subscriptionId: subscriptionId,
        type: "custom_subscription",
      },
      success_url: `${appUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscription/cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRATION_SECONDS,
    });

    // Step 7: Update subscription with checkout URL and session ID
    await ctx.runMutation(internal.billing.stripe.internal.updateCheckoutUrl, {
      subscriptionId,
      checkoutUrl: session.url!,
      checkoutExpiresAt: session.expires_at * 1000, // Convert to ms
      checkoutSessionId: session.id, // Required for webhook lookup
    });

    return {
      success: true,
      subscriptionId,
      checkoutUrl: session.url,
      customerId: stripeCustomerId,
      achPriceId: achPrice.id,
      cardPriceId: cardPrice.id,
    };
  },
});

/**
 * Get active subscription for a user (public query)
 */
export const getActiveSubscriptionForUser = query({
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

/**
 * Get subscription by Stripe subscription ID
 */
export const getByStripeSubscriptionId = query({
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

/**
 * List all custom subscriptions (Admin only)
 */
export const listAllSubscriptions = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending_checkout"),
        v.literal("active"),
        v.literal("past_due"),
        v.literal("cancelled"),
        v.literal("paused")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let subscriptions;

    if (args.status) {
      subscriptions = await ctx.db
        .query("customSubscriptions")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(args.limit || 50);
    } else {
      subscriptions = await ctx.db
        .query("customSubscriptions")
        .order("desc")
        .take(args.limit || 50);
    }

    // Enrich with user data
    const enriched = await Promise.all(
      subscriptions.map(async (sub) => {
        const user = await ctx.db.get(sub.userId);
        return {
          ...sub,
          user: user
            ? {
                email: user.email,
                name: user.name,
                plan: user.plan,
              }
            : null,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get subscription details with credit allocations
 */
export const getSubscriptionDetails = query({
  args: {
    subscriptionId: v.id("customSubscriptions"),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) {
      return null;
    }

    const user = await ctx.db.get(subscription.userId);

    // Get current credit allocation
    const currentAllocation = await ctx.db
      .query("subscriptionCreditAllocations")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", subscription.userId).eq("status", "active")
      )
      .first();

    // Get recent allocations
    const recentAllocations = await ctx.db
      .query("subscriptionCreditAllocations")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", args.subscriptionId))
      .order("desc")
      .take(12);

    return {
      subscription,
      user: user
        ? {
            email: user.email,
            name: user.name,
            plan: user.plan,
            credits: user.credits,
            subscriptionCredits: user.subscriptionCredits,
          }
        : null,
      currentAllocation,
      recentAllocations,
    };
  },
});

/**
 * Get subscription by ID (public query)
 */
export const getSubscriptionById = query({
  args: {
    subscriptionId: v.id("customSubscriptions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.subscriptionId);
  },
});

/**
 * Cancel a custom subscription (Admin only)
 */
export const cancelSubscription = action({
  args: {
    subscriptionId: v.id("customSubscriptions"),
    cancelImmediately: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Verify admin
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const adminUser: Doc<"users"> | null = await ctx.runQuery(internal.users.internal.getUserByClerkId, {
      clerkId: identity.subject,
    });
    if (!adminUser || adminUser.role !== "admin") {
      throw new Error("Admin access required");
    }

    const subscription: Doc<"customSubscriptions"> | null = await ctx.runQuery(
      internal.billing.stripe.internal.getSubscriptionById,
      { subscriptionId: args.subscriptionId }
    );
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (!subscription.stripeSubscriptionId) {
      // No Stripe subscription yet, just update status
      await ctx.runMutation(internal.billing.stripe.internal.updateSubscriptionStatus, {
        subscriptionId: args.subscriptionId,
        status: "cancelled",
      });
      return { success: true };
    }

    const stripe = getStripeClient();

    if (args.cancelImmediately) {
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
    } else {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    await ctx.runMutation(internal.billing.stripe.internal.updateSubscriptionStatus, {
      subscriptionId: args.subscriptionId,
      status: "cancelled",
    });

    return { success: true };
  },
});
