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
    // Stub implementation - will be restored later
    console.log(`Subscription created: ${args.subscriptionId}`);
    return { success: true };
  },
});

// Handle Stripe subscription updated
export const handleSubscriptionUpdated = internalMutation({
  args: {
    subscriptionId: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation - will be restored later
    console.log(`Subscription updated: ${args.subscriptionId}`);
    return { success: true };
  },
});

// Handle Stripe subscription deleted
export const handleSubscriptionDeleted = internalMutation({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation - will be restored later
    console.log(`Subscription deleted: ${args.subscriptionId}`);
    return { success: true };
  },
});

// Handle Stripe payment succeeded
export const handlePaymentSucceeded = internalMutation({
  args: {
    paymentIntentId: v.string(),
    amount: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation - will be restored later
    console.log(`Payment succeeded: ${args.paymentIntentId}`);
    return { success: true };
  },
});

// Additional webhook handlers referenced in http.ts
export const handleSubscriptionUpdate = internalMutation({
  args: {
    subscriptionId: v.string(),
    plan: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Subscription update: ${args.subscriptionId}`);
    return { success: true };
  },
});

export const handleSubscriptionCancellation = internalMutation({
  args: {
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Subscription cancelled: ${args.subscriptionId}`);
    return { success: true };
  },
});

export const handlePaymentSuccess = internalMutation({
  args: {
    paymentIntentId: v.string(),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Payment success: ${args.paymentIntentId}`);
    return { success: true };
  },
});

export const handlePaymentFailure = internalMutation({
  args: {
    paymentIntentId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Payment failure: ${args.paymentIntentId}`);
    return { success: true };
  },
});