import { internalMutation } from "../_generated/server";
import { BUSINESS_RULES } from "../lib/constants";
import { internal } from "../_generated/api";

// Refresh monthly credits (called by cron job)
export const refreshMonthlyCredits = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all active users with paid plans
    const users = await ctx.db
      .query("users")
      .filter((q) => q.and(
        q.eq(q.field("isActive"), true),
        q.or(
          q.eq(q.field("plan"), "pro"),
          q.eq(q.field("plan"), "enterprise")
        )
      ))
      .collect();

    let refreshed = 0;

    for (const user of users) {
      try {
        // Get current billing info
        const billing = await ctx.db
          .query("billing")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .filter((q) => q.eq(q.field("status"), "active"))
          .first();

        if (!billing) {
          continue;
        }

        // Determine monthly credit allotment based on plan
        let monthlyCredits = 0;
        switch (user.plan) {
          case "pro":
            monthlyCredits = 1000; // Pro plan gets 1000 credits/month
            break;
          case "enterprise":
            monthlyCredits = 5000; // Enterprise gets 5000 credits/month
            break;
          default:
            continue; // Skip free users
        }

        // Add credits using atomic transaction system
        const transactionResult = await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
          userId: user._id,
          type: "bonus",
          amount: monthlyCredits,
          description: `Monthly credit refresh for ${user.plan} plan`,
          relatedEntity: {
            type: "billing",
            id: billing._id,
          },
        });

        const newBalance = transactionResult.newBalance;

        // Send notification
        await ctx.runMutation(internal.notifications.internal.createSystemNotification, {
          userId: user._id,
          title: "Credits Refreshed",
          message: `Your ${user.plan} plan credits have been refreshed. You now have ${newBalance} credits available.`,
          type: "credit_alert",
          data: {
            creditsAdded: monthlyCredits,
            newBalance,
            plan: user.plan,
          },
        });

        refreshed++;

      } catch (error) {
        console.error(`Error refreshing credits for user ${user._id}:`, error);
      }
    }

    return { refreshed };
  },
});