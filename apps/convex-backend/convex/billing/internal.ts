import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Check for failed payments (called by cron job)
export const checkFailedPayments = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get billing records with failed payment status
    const failedPayments = await ctx.db
      .query("billing")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();

    let processed = 0;

    for (const billing of failedPayments) {
      try {
        const user = await ctx.db.get(billing.userId);
        
        if (!user) {
          continue;
        }

        // Check how long payment has been overdue
        const daysSinceFailure = billing.currentPeriodEnd 
          ? Math.floor((Date.now() - billing.currentPeriodEnd) / (24 * 60 * 60 * 1000))
          : 0;

        if (daysSinceFailure > 7) {
          // Downgrade to free plan after 7 days
          await ctx.db.patch(user._id, {
            plan: "free",
            updatedAt: Date.now(),
          });

          await ctx.db.patch(billing._id, {
            status: "cancelled",
            updatedAt: Date.now(),
          });

          // Send notification
          await ctx.runMutation(internal.notifications.internal.createSystemNotification, {
            userId: user._id,
            title: "Account Downgraded",
            message: "Your account has been downgraded to free due to payment failure. Please update your payment method to restore premium features.",
            type: "plan_updated",
            data: { 
              oldPlan: billing.plan,
              newPlan: "free",
              reason: "payment_failure",
            },
          });

        } else if (daysSinceFailure > 3) {
          // Send reminder after 3 days
          await ctx.runMutation(internal.notifications.internal.createSystemNotification, {
            userId: user._id,
            title: "Payment Past Due",
            message: `Your payment is ${daysSinceFailure} days overdue. Please update your payment method to avoid service interruption.`,
            type: "system_alert",
            data: { 
              daysPastDue: daysSinceFailure,
              amount: billing.amount,
            },
          });
        }

        processed++;

      } catch (error) {
        console.error(`Error processing failed payment for billing ${billing._id}:`, error);
      }
    }

    return { processed };
  },
});

// Process webhook retries
export const processWebhookRetries = internalMutation({
  args: {},
  handler: async (ctx) => {
    // This would handle webhook retry logic
    // For now, just return a placeholder
    return { processed: 0 };
  },
});