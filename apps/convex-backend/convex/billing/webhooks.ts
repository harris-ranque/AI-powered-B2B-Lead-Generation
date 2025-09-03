import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Handle Stripe subscription created
export const handleSubscriptionCreated = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    subscriptionId: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Find user by Stripe customer ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), args.stripeCustomerId))
        .unique();

      if (!user) {
        console.error(`User not found for Stripe customer ID: ${args.stripeCustomerId}`);
        return { success: false, error: "User not found" };
      }

      // Update user's plan
      let newPlan: "free" | "pro" | "enterprise" = "free";
      if (args.plan.includes("pro")) {
        newPlan = "pro";
      } else if (args.plan.includes("enterprise")) {
        newPlan = "enterprise";
      }

      await ctx.db.patch(user._id, {
        plan: newPlan,
        stripeSubscriptionId: args.subscriptionId,
        isActive: true,
        updatedAt: Date.now(),
      });

      // Create a credit transaction for subscription
      let creditsToAdd = 0;
      if (newPlan === "pro") {
        creditsToAdd = 500; // Pro plan credits
      } else if (newPlan === "enterprise") {
        creditsToAdd = 2000; // Enterprise plan credits
      }

      if (creditsToAdd > 0) {
        await ctx.db.insert("creditTransactions", {
          userId: user._id,
          type: "purchase",
          amount: creditsToAdd,
          description: `${newPlan.toUpperCase()} plan subscription`,
          relatedEntity: {
            type: "subscription",
            id: args.subscriptionId,
          },
          createdAt: Date.now(),
        });

        // Update user's credit balance
        await ctx.db.patch(user._id, {
          credits: (user.credits || 0) + creditsToAdd,
        });
      }

      console.log(`Subscription created for user ${user._id}: ${args.subscriptionId} (${newPlan})`);
      return { success: true, plan: newPlan, creditsAdded: creditsToAdd };
    } catch (error) {
      console.error(`Error handling subscription created: ${args.subscriptionId}`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Handle Stripe subscription updated
export const handleSubscriptionUpdated = internalMutation({
  args: {
    subscriptionId: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeSubscriptionId"), args.subscriptionId))
        .unique();

      if (!user) {
        console.error(`User not found for subscription ID: ${args.subscriptionId}`);
        return { success: false, error: "User not found" };
      }

      // Determine new plan
      let newPlan: "free" | "pro" | "enterprise" = "free";
      if (args.plan.includes("pro")) {
        newPlan = "pro";
      } else if (args.plan.includes("enterprise")) {
        newPlan = "enterprise";
      }

      const oldPlan = user.plan;

      // Update user's plan
      await ctx.db.patch(user._id, {
        plan: newPlan,
        updatedAt: Date.now(),
      });

      // Handle plan change credit adjustments if needed
      let creditAdjustment = 0;
      if (oldPlan === "free" && newPlan === "pro") {
        creditAdjustment = 500;
      } else if (oldPlan === "free" && newPlan === "enterprise") {
        creditAdjustment = 2000;
      } else if (oldPlan === "pro" && newPlan === "enterprise") {
        creditAdjustment = 1500;
      }

      if (creditAdjustment > 0) {
        await ctx.db.insert("creditTransactions", {
          userId: user._id,
          type: "purchase",
          amount: creditAdjustment,
          description: `Plan upgrade: ${oldPlan} to ${newPlan}`,
          relatedEntity: {
            type: "subscription",
            id: args.subscriptionId,
          },
          createdAt: Date.now(),
        });

        await ctx.db.patch(user._id, {
          credits: (user.credits || 0) + creditAdjustment,
        });
      }

      console.log(`Subscription updated for user ${user._id}: ${oldPlan} -> ${newPlan}`);
      return { success: true, oldPlan, newPlan, creditAdjustment };
    } catch (error) {
      console.error(`Error handling subscription updated: ${args.subscriptionId}`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Handle Stripe subscription deleted
export const handleSubscriptionDeleted = internalMutation({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeSubscriptionId"), args.subscriptionId))
        .unique();

      if (!user) {
        console.error(`User not found for subscription ID: ${args.subscriptionId}`);
        return { success: false, error: "User not found" };
      }

      // Downgrade user to free plan
      await ctx.db.patch(user._id, {
        plan: "free",
        stripeSubscriptionId: undefined,
        updatedAt: Date.now(),
      });

      // Record the subscription cancellation
      await ctx.db.insert("creditTransactions", {
        userId: user._id,
        type: "refund", // Using refund to indicate subscription ended
        amount: 0,
        description: "Subscription cancelled",
        relatedEntity: {
          type: "subscription",
          id: args.subscriptionId,
        },
        createdAt: Date.now(),
      });

      console.log(`Subscription deleted for user ${user._id}: ${args.subscriptionId}`);
      return { success: true, downgradedToFree: true };
    } catch (error) {
      console.error(`Error handling subscription deleted: ${args.subscriptionId}`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Handle Stripe payment succeeded
export const handlePaymentSucceeded = internalMutation({
  args: {
    paymentIntentId: v.string(),
    amount: v.number(),
    currency: v.string(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Find user by Stripe customer ID if provided
      let user = null;
      if (args.stripeCustomerId) {
        user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("stripeCustomerId"), args.stripeCustomerId))
          .unique();
      }

      if (!user) {
        console.log(`Payment succeeded but no user found for customer ${args.stripeCustomerId}`);
        return { success: true, userNotFound: true };
      }

      // Convert amount from cents to credits (example: $10 = 1000 cents = 100 credits)
      const creditsToAdd = Math.floor(args.amount / 10); // 10 cents per credit

      // Create credit transaction
      await ctx.db.insert("creditTransactions", {
        userId: user._id,
        type: "purchase",
        amount: creditsToAdd,
        description: `Credit purchase - $${(args.amount / 100).toFixed(2)}`,
        relatedEntity: {
          type: "payment",
          id: args.paymentIntentId,
        },
        createdAt: Date.now(),
      });

      // Update user's credit balance
      await ctx.db.patch(user._id, {
        credits: (user.credits || 0) + creditsToAdd,
        updatedAt: Date.now(),
      });

      console.log(`Payment succeeded for user ${user._id}: ${args.paymentIntentId} (+${creditsToAdd} credits)`);
      return { success: true, creditsAdded: creditsToAdd };
    } catch (error) {
      console.error(`Error handling payment succeeded: ${args.paymentIntentId}`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Additional webhook handlers referenced in http.ts
export const handleSubscriptionUpdate = internalMutation({
  args: {
    subscriptionId: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    // This is a duplicate of handleSubscriptionUpdated, call that function
    return await ctx.runMutation("billing/webhooks:handleSubscriptionUpdated", {
      subscriptionId: args.subscriptionId,
      plan: args.plan,
    });
  },
});

export const handleSubscriptionCancellation = internalMutation({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    // This is a duplicate of handleSubscriptionDeleted, call that function
    return await ctx.runMutation("billing/webhooks:handleSubscriptionDeleted", {
      subscriptionId: args.subscriptionId,
    });
  },
});

export const handlePaymentSuccess = internalMutation({
  args: {
    paymentIntentId: v.string(),
    amount: v.number(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // This is a duplicate of handlePaymentSucceeded, call that function
    return await ctx.runMutation("billing/webhooks:handlePaymentSucceeded", {
      paymentIntentId: args.paymentIntentId,
      amount: args.amount,
      currency: "usd", // Default currency
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

export const handlePaymentFailure = internalMutation({
  args: {
    paymentIntentId: v.string(),
    error: v.string(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      // Find user by Stripe customer ID if provided
      let user = null;
      if (args.stripeCustomerId) {
        user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("stripeCustomerId"), args.stripeCustomerId))
          .unique();
      }

      // Log the payment failure
      if (user) {
        await ctx.db.insert("creditTransactions", {
          userId: user._id,
          type: "refund", // Using refund type to indicate failed payment
          amount: 0,
          description: `Payment failed: ${args.error}`,
          relatedEntity: {
            type: "payment",
            id: args.paymentIntentId,
          },
          createdAt: Date.now(),
        });

        console.log(`Payment failed for user ${user._id}: ${args.paymentIntentId} - ${args.error}`);
      } else {
        console.log(`Payment failed: ${args.paymentIntentId} - ${args.error}`);
      }

      return { success: true, logged: true };
    } catch (error) {
      console.error(`Error handling payment failure: ${args.paymentIntentId}`, error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});