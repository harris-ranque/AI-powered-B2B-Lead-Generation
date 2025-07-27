import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Handle Stripe subscription webhook events
export const handleSubscriptionUpdate = internalMutation({
  args: {
    subscription: v.any(),
    eventType: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = args.subscription;
    
    if (!subscription.customer || !subscription.id) {
      console.error("Invalid subscription data:", subscription);
      return;
    }

    try {
      // Find user by Stripe customer ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), subscription.customer))
        .unique();

      if (!user) {
        console.error(`User not found for customer ID: ${subscription.customer}`);
        return;
      }

      // Get or create billing record
      let billing = await ctx.db
        .query("billing")
        .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", subscription.id))
        .unique();

      // Map Stripe price ID to our plan
      const planMapping: Record<string, { plan: string; billingCycle: string; amount: number }> = {
        "price_pro_monthly": { plan: "pro", billingCycle: "monthly", amount: 2900 },
        "price_pro_yearly": { plan: "pro", billingCycle: "yearly", amount: 29000 },
        "price_enterprise_monthly": { plan: "enterprise", billingCycle: "monthly", amount: 9900 },
        "price_enterprise_yearly": { plan: "enterprise", billingCycle: "yearly", amount: 99000 },
      };

      const priceId = subscription.items?.data?.[0]?.price?.id;
      const planData = planMapping[priceId];

      if (!planData) {
        console.error(`Unknown price ID: ${priceId}`);
        return;
      }

      const subscriptionData = {
        userId: user._id,
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        plan: planData.plan as "pro" | "enterprise",
        billingCycle: planData.billingCycle as "monthly" | "yearly",
        amount: planData.amount,
        currency: subscription.currency || "usd",
        status: mapStripeStatus(subscription.status),
        currentPeriodStart: subscription.current_period_start * 1000,
        currentPeriodEnd: subscription.current_period_end * 1000,
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        updatedAt: Date.now(),
      };

      if (billing) {
        // Update existing billing record
        await ctx.db.patch(billing._id, subscriptionData);
      } else {
        // Create new billing record
        await ctx.db.insert("billing", {
          ...subscriptionData,
          createdAt: Date.now(),
        });
      }

      // Update user plan
      await ctx.db.patch(user._id, {
        plan: planData.plan as "pro" | "enterprise",
        updatedAt: Date.now(),
      });

      // Send notification for new subscriptions
      if (args.eventType === "customer.subscription.created") {
        await ctx.db.insert("notifications", {
          userId: user._id,
          type: "plan_upgraded",
          title: `Welcome to ${planData.plan.charAt(0).toUpperCase() + planData.plan.slice(1)}! 🎉`,
          message: `Your subscription is now active. Enjoy your enhanced features and increased limits!`,
          data: { 
            plan: planData.plan,
            billingCycle: planData.billingCycle,
            subscriptionId: subscription.id,
          },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });
      }

    } catch (error) {
      console.error("Error processing subscription webhook:", error);
    }
  },
});

// Handle subscription cancellation
export const handleSubscriptionCancellation = internalMutation({
  args: {
    subscription: v.any(),
  },
  handler: async (ctx, args) => {
    const subscription = args.subscription;

    try {
      // Find billing record
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", subscription.id))
        .unique();

      if (!billing) {
        console.error(`Billing record not found for subscription: ${subscription.id}`);
        return;
      }

      // Update billing record
      await ctx.db.patch(billing._id, {
        status: "cancelled",
        updatedAt: Date.now(),
      });

      // Downgrade user to free plan
      await ctx.db.patch(billing.userId, {
        plan: "free",
        updatedAt: Date.now(),
      });

      // Send notification
      await ctx.db.insert("notifications", {
        userId: billing.userId,
        type: "system_alert",
        title: "Subscription Cancelled",
        message: "Your subscription has been cancelled and you've been moved to the free plan. Your data remains safe and accessible.",
        data: { 
          subscriptionId: subscription.id,
          cancelledAt: Date.now(),
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

    } catch (error) {
      console.error("Error processing subscription cancellation:", error);
    }
  },
});

// Handle successful payment
export const handlePaymentSuccess = internalMutation({
  args: {
    invoice: v.any(),
  },
  handler: async (ctx, args) => {
    const invoice = args.invoice;

    try {
      // Find user by customer ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), invoice.customer))
        .unique();

      if (!user) {
        console.error(`User not found for customer ID: ${invoice.customer}`);
        return;
      }

      // Add credits for yearly subscriptions (bonus credits)
      if (invoice.subscription) {
        const billing = await ctx.db
          .query("billing")
          .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", invoice.subscription))
          .unique();

        if (billing && billing.billingCycle === "yearly") {
          const bonusCredits = billing.plan === "pro" ? 1000 : 4000; // 2 extra months worth
          
          await ctx.db.patch(user._id, {
            credits: user.credits + bonusCredits,
            updatedAt: Date.now(),
          });

          // Record bonus credit transaction
          await ctx.db.insert("creditTransactions", {
            userId: user._id,
            type: "bonus",
            amount: bonusCredits,
            description: `Yearly subscription bonus - ${bonusCredits} credits`,
            balanceAfter: user.credits + bonusCredits,
            createdAt: Date.now(),
          });
        }
      }

      // Send payment confirmation notification
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Payment Successful! 💳",
        message: `Your payment of $${(invoice.amount_paid / 100).toFixed(2)} has been processed successfully.`,
        data: { 
          invoiceId: invoice.id,
          amountPaid: invoice.amount_paid,
          currency: invoice.currency,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

    } catch (error) {
      console.error("Error processing payment success:", error);
    }
  },
});

// Handle failed payment
export const handlePaymentFailure = internalMutation({
  args: {
    invoice: v.any(),
  },
  handler: async (ctx, args) => {
    const invoice = args.invoice;

    try {
      // Find user by customer ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), invoice.customer))
        .unique();

      if (!user) {
        console.error(`User not found for customer ID: ${invoice.customer}`);
        return;
      }

      // Update billing status if subscription exists
      if (invoice.subscription) {
        const billing = await ctx.db
          .query("billing")
          .withIndex("by_stripe_subscription", (q) => q.eq("stripeSubscriptionId", invoice.subscription))
          .unique();

        if (billing) {
          await ctx.db.patch(billing._id, {
            status: "past_due",
            updatedAt: Date.now(),
          });
        }
      }

      // Send payment failure notification
      await ctx.db.insert("notifications", {
        userId: user._id,
        type: "system_alert",
        title: "Payment Failed ⚠️",
        message: `Your payment of $${(invoice.amount_due / 100).toFixed(2)} could not be processed. Please update your payment method to continue using premium features.`,
        data: { 
          invoiceId: invoice.id,
          amountDue: invoice.amount_due,
          currency: invoice.currency,
          nextPaymentAttempt: invoice.next_payment_attempt,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

    } catch (error) {
      console.error("Error processing payment failure:", error);
    }
  },
});

// Helper function to map Stripe subscription status to our status
function mapStripeStatus(stripeStatus: string): "active" | "cancelled" | "past_due" | "unpaid" {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    default:
      return "unpaid";
  }
}