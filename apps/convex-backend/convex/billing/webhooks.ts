import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createOperationLogger } from "../lib/logger";
import { Doc, Id } from "../_generated/dataModel";
import { DatabaseReader } from "../_generated/server";

// Helper: robust plan resolution using planConfigurations mapping; falls back to heuristic
async function resolvePlanFromPriceId(
  db: DatabaseReader,
  priceId?: string,
): Promise<{
  plan: "starter" | "professional" | "business" | "enterprise";
  billingCycle?: "monthly" | "yearly";
}> {
  if (!priceId) return { plan: "starter" };
  try {
    const plans = await db.query("planConfigurations").collect();
    for (const cfg of plans) {
      if (cfg.stripePriceIdMonthly === priceId) {
        return { plan: cfg.planId as any, billingCycle: "monthly" };
      }
      if (cfg.stripePriceIdYearly === priceId) {
        return { plan: cfg.planId as any, billingCycle: "yearly" };
      }
    }
  } catch {}
  // Fallback heuristic
  const lower = priceId.toLowerCase();
  if (lower.includes("enterprise")) return { plan: "enterprise" };
  if (lower.includes("business")) return { plan: "business" };
  if (lower.includes("professional") || lower.includes("pro"))
    return { plan: "professional" };
  return { plan: "starter" };
}

// Helper function to get plan limits
function getPlanLimits(plan: string) {
  switch (plan) {
    case "professional":
      return {
        monthlySearches: 50,
        maxLeadsPerSearch: 500,
        monthlyEnrichments: 25000,
        monthlyExports: 100,
        emailGeneration: true,
        bulkOperations: true,
        apiAccess: true,
        requiresOwnApiKeys: false,
      };
    case "business":
      return {
        monthlySearches: 200,
        maxLeadsPerSearch: 2000,
        monthlyEnrichments: 100000,
        monthlyExports: 500,
        emailGeneration: true,
        bulkOperations: true,
        apiAccess: true,
        requiresOwnApiKeys: false,
      };
    case "enterprise":
      return {
        monthlySearches: -1, // Unlimited
        maxLeadsPerSearch: -1,
        monthlyEnrichments: -1,
        monthlyExports: -1,
        emailGeneration: true,
        bulkOperations: true,
        apiAccess: true,
        requiresOwnApiKeys: false,
      };
    default: // starter
      return {
        monthlySearches: 10,
        maxLeadsPerSearch: 25,
        monthlyEnrichments: 500,
        monthlyExports: 10,
        emailGeneration: false,
        bulkOperations: false,
        apiAccess: false,
        requiresOwnApiKeys: true,
      };
  }
}

// Handle Stripe checkout session completed
export const handleCheckoutCompleted = internalMutation({
  args: {
    sessionId: v.string(),
    customerId: v.string(),
    subscriptionId: v.optional(v.string()),
    mode: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Processing checkout completion: ${args.sessionId}`);

      // Find user by customer ID first
      let user: Doc<"users"> | null = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), args.customerId))
        .unique();

      // If not found, try metadata.userId
      if (!user && args.metadata?.userId) {
        try {
          user = await ctx.db.get(args.metadata.userId as Id<"users">);
        } catch {}
      }

      if (!user) {
        console.error(`User not found for checkout session: ${args.sessionId}`);
        return { success: false, error: "User not found" };
      }

      // Ensure user has stripeCustomerId and subscription linkage
      const u0 = user as Doc<"users">;
      const patches: Partial<Doc<"users">> = {};
      if (!u0.stripeCustomerId && args.customerId)
        patches.stripeCustomerId = args.customerId;
      if (!u0.stripeSubscriptionId && args.subscriptionId)
        patches.stripeSubscriptionId = args.subscriptionId;
      if (Object.keys(patches).length > 0) {
        await ctx.db.patch(u0._id, { ...patches, updatedAt: Date.now() });
      }

      // If this was a credits purchase (one-time payment), credit the account idempotently
      const md = args.metadata as
        | { type?: string; credits?: unknown }
        | undefined;
      if (args.mode === "payment" && md?.type === "credits_purchase") {
        const creditsToAdd = parseInt(String(md?.credits ?? 0), 10);
        if (!isFinite(creditsToAdd) || creditsToAdd <= 0) {
          console.error(
            "Invalid credits in metadata for session",
            args.sessionId,
          );
        } else {
          // Idempotency: if a transaction with this sessionId already exists, skip
          const existingTx = await ctx.db
            .query("creditTransactions")
            .withIndex("by_user", (q) => q.eq("userId", u0._id))
            .filter((q) => q.eq(q.field("stripePaymentId"), args.sessionId))
            .first();

          if (!existingTx) {
            const newBalance = (u0.credits || 0) + creditsToAdd;
            await ctx.db.patch(u0._id, {
              credits: newBalance,
              updatedAt: Date.now(),
            });

            await ctx.db.insert("creditTransactions", {
              userId: u0._id,
              type: "purchase",
              amount: creditsToAdd,
              description: `Credits purchase via Checkout ${args.sessionId}`,
              relatedEntity: { type: "stripe_checkout", id: args.sessionId },
              stripePaymentId: args.sessionId,
              balanceAfter: newBalance,
              createdAt: Date.now(),
            });
          }
        }
      } else {
        // Log subscription checkout completions as events
        await ctx.db.insert("subscriptionEvents", {
          userId: u0._id,
          stripeCustomerId: args.customerId,
          stripeSubscriptionId: args.subscriptionId,
          eventType: "subscription_created",
          metadata: { sessionId: args.sessionId, mode: args.mode },
          createdAt: Date.now(),
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Error handling checkout completed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Handle Stripe subscription created
export const handleSubscriptionCreated = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
    status: v.string(),
    priceId: v.optional(v.string()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    trialStart: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    // Optional extras when present
    metadata: v.optional(v.any()),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_created",
    );
    const timer = logger.start(
      `Creating subscription for customer: ${args.customerId}`,
    );
    try {
      console.log(`Creating subscription: ${args.subscriptionId}`);

      // Find user by customer ID
      let user: Doc<"users"> | null = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), args.customerId))
        .unique();

      if (!user && args.metadata?.userId) {
        user = await ctx.db
          .get(args.metadata.userId as Id<"users">)
          .catch(() => null as any);
      }

      if (!user) {
        console.error(`User not found for customer: ${args.customerId}`);
        return { success: false, error: "User not found" };
      }
      const u = user as Doc<"users">;

      // Determine plan and billing cycle from price ID
      const { plan, billingCycle } = await resolvePlanFromPriceId(
        ctx.db,
        args.priceId || "",
      );
      const planLimits = getPlanLimits(plan);

      // Determine subscription status
      let subscriptionStatus: any = "active";
      const isTrialing = !!args.trialStart && !!args.trialEnd;

      if (isTrialing) {
        subscriptionStatus = "trialing";
      } else if (
        args.status === "incomplete" ||
        args.status === "incomplete_expired"
      ) {
        subscriptionStatus = args.status;
      }

      // Create or update billing record
      const existingBilling = await ctx.db
        .query("billing")
        .filter((q) => q.eq(q.field("userId"), u._id))
        .unique();

      if (existingBilling) {
        await ctx.db.patch(existingBilling._id, {
          stripeSubscriptionId: args.subscriptionId,
          stripePriceId: args.priceId,
          plan: plan,
          status: subscriptionStatus,
          currentPeriodStart: args.currentPeriodStart,
          currentPeriodEnd: args.currentPeriodEnd,
          trialStart: args.trialStart,
          trialEnd: args.trialEnd,
          isTrialing,
          billingCycle:
            billingCycle === "yearly" || args.interval === "year"
              ? "yearly"
              : "monthly",
          planLimits,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("billing", {
          userId: u._id,
          stripeCustomerId: args.customerId,
          stripeSubscriptionId: args.subscriptionId,
          stripePriceId: args.priceId,
          plan: plan,
          billingCycle:
            billingCycle === "yearly" || args.interval === "year"
              ? "yearly"
              : "monthly",
          amount: 0, // Will be updated from invoice
          currency: "usd",
          status: subscriptionStatus,
          currentPeriodStart: args.currentPeriodStart,
          currentPeriodEnd: args.currentPeriodEnd,
          trialStart: args.trialStart,
          trialEnd: args.trialEnd,
          isTrialing,
          cancelAtPeriodEnd: false,
          planLimits,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      // Update user plan
      await ctx.db.patch(u._id, {
        plan: plan,
        stripeSubscriptionId: args.subscriptionId,
        stripeCustomerId: u.stripeCustomerId || args.customerId,
        updatedAt: Date.now(),
      });

      // Create usage tracking record for the current period
      const existingUsage = await ctx.db
        .query("usageTracking")
        .filter((q) => q.eq(q.field("userId"), u._id))
        .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
        .unique();

      if (!existingUsage) {
        await ctx.db.insert("usageTracking", {
          userId: u._id,
          billingPeriodStart: args.currentPeriodStart,
          billingPeriodEnd: args.currentPeriodEnd,
          searchesUsed: 0,
          leadsEnriched: 0,
          emailsGenerated: 0,
          exportsCompleted: 0,
          apiCallsMade: 0,
          creditsUsed: 0,
          isCurrentPeriod: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      // Log the event
      await ctx.db.insert("subscriptionEvents", {
        userId: u._id,
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        eventType: "subscription_created",
        newPlan: plan,
        createdAt: Date.now(),
      });

      logger.complete(
        timer,
        `Subscription created for user ${u._id}: ${plan} plan`,
        {
          userId: u._id,
          subscriptionId: args.subscriptionId,
          plan,
          isTrialing,
        },
      );
      return { success: true, plan };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        "Error handling subscription created",
        {
          subscriptionId: args.subscriptionId,
          customerId: args.customerId,
        },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Handle Stripe subscription updated
export const handleSubscriptionUpdated = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
    status: v.string(),
    priceId: v.optional(v.string()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    cancelAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_updated",
    );
    const timer = logger.start(`Updating subscription: ${args.subscriptionId}`);

    try {
      // Find user by subscription ID
      let user: Doc<"users"> | null = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("stripeSubscriptionId"), args.subscriptionId),
        )
        .unique();

      if (!user && args.metadata?.userId) {
        user = await ctx.db
          .get(args.metadata.userId as Id<"users">)
          .catch(() => null as any);
      }

      if (!user) {
        logger.error(
          `User not found for subscription: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
          },
        );
        return { success: false, error: "User not found" };
      }
      const u2 = user as Doc<"users">;

      // Get existing billing record
      const billing = await ctx.db
        .query("billing")
        .filter((q) => q.eq(q.field("userId"), u2._id))
        .unique();

      if (!billing) {
        logger.error(`Billing record not found for user: ${user._id}`, {
          userId: user._id,
          subscriptionId: args.subscriptionId,
        });
        return { success: false, error: "Billing record not found" };
      }

      logger.debug("Found user and billing record for subscription update", {
        userId: u2._id,
        subscriptionId: args.subscriptionId,
      });

      const oldPlan = billing.plan;
      const { plan: newPlan, billingCycle } = await resolvePlanFromPriceId(
        ctx.db,
        args.priceId || "",
      );
      const planLimits = getPlanLimits(newPlan);

      // Update billing record
      await ctx.db.patch(billing._id, {
        status: args.status as any,
        stripePriceId: args.priceId,
        plan: newPlan,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        cancelAt: args.cancelAt,
        canceledAt: args.canceledAt,
        billingCycle:
          billingCycle === "yearly" || args.interval === "year"
            ? "yearly"
            : billing.billingCycle || "monthly",
        planLimits,
        updatedAt: Date.now(),
      });

      // Update user plan if changed
      if (oldPlan !== newPlan) {
        await ctx.db.patch(u2._id, {
          plan: newPlan,
          updatedAt: Date.now(),
        });
      }

      // Update usage tracking period if period changed
      const currentUsage = await ctx.db
        .query("usageTracking")
        .filter((q) => q.eq(q.field("userId"), u2._id))
        .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
        .unique();

      if (
        currentUsage &&
        currentUsage.billingPeriodEnd !== args.currentPeriodEnd
      ) {
        // Mark current period as not current
        await ctx.db.patch(currentUsage._id, {
          isCurrentPeriod: false,
          updatedAt: Date.now(),
        });

        // Create new current period
        await ctx.db.insert("usageTracking", {
          userId: u2._id,
          billingPeriodStart: args.currentPeriodStart,
          billingPeriodEnd: args.currentPeriodEnd,
          searchesUsed: 0,
          leadsEnriched: 0,
          emailsGenerated: 0,
          exportsCompleted: 0,
          apiCallsMade: 0,
          creditsUsed: 0,
          isCurrentPeriod: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      // Log the event
      await ctx.db.insert("subscriptionEvents", {
        userId: u2._id,
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        eventType:
          oldPlan !== newPlan ? "plan_changed" : "subscription_updated",
        oldPlan,
        newPlan,
        createdAt: Date.now(),
      });

      logger.complete(
        timer,
        `Subscription updated for user ${u2._id}: ${oldPlan} -> ${newPlan}`,
        {
          userId: u2._id,
          subscriptionId: args.subscriptionId,
          oldPlan,
          newPlan,
        },
      );
      return { success: true, oldPlan, newPlan };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling subscription updated: ${args.subscriptionId}`,
        {
          subscriptionId: args.subscriptionId,
          customerId: args.customerId,
        },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Handle Stripe subscription deleted
export const handleSubscriptionDeleted = internalMutation({
  args: {
    subscriptionId: v.string(),
    customerId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Deleting subscription: ${args.subscriptionId}`);

      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("stripeSubscriptionId"), args.subscriptionId),
        )
        .unique();

      if (!user) {
        console.error(
          `User not found for subscription: ${args.subscriptionId}`,
        );
        return { success: false, error: "User not found" };
      }

      const oldPlan = user.plan;

      // Downgrade user to starter plan
      await ctx.db.patch(user._id, {
        plan: "starter",
        stripeSubscriptionId: undefined,
        updatedAt: Date.now(),
      });

      // Update billing record
      const billing = await ctx.db
        .query("billing")
        .filter((q) => q.eq(q.field("userId"), user._id))
        .unique();

      if (billing) {
        await ctx.db.patch(billing._id, {
          status: "cancelled",
          plan: "starter",
          canceledAt: Date.now(),
          planLimits: getPlanLimits("starter"),
          updatedAt: Date.now(),
        });
      }

      // Log the event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        eventType: "subscription_cancelled",
        oldPlan,
        newPlan: "starter",
        createdAt: Date.now(),
      });

      console.log(
        `Subscription cancelled for user ${user._id}: ${oldPlan} -> starter`,
      );
      return { success: true, oldPlan, newPlan: "starter" };
    } catch (error) {
      console.error(
        `Error handling subscription deleted: ${args.subscriptionId}`,
        error,
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Handle Stripe payment succeeded (invoice)
export const handlePaymentSucceeded = internalMutation({
  args: {
    invoiceId: v.string(),
    subscriptionId: v.optional(v.string()),
    customerId: v.string(),
    amount: v.number(),
    currency: v.string(),
    paidAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Payment succeeded for invoice: ${args.invoiceId}`);

      // Find user by customer ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), args.customerId))
        .unique();

      if (!user) {
        console.error(`User not found for customer: ${args.customerId}`);
        return { success: false, error: "User not found" };
      }

      // Update billing record with payment info
      const billing = await ctx.db
        .query("billing")
        .filter((q) => q.eq(q.field("userId"), user._id))
        .unique();

      if (billing) {
        await ctx.db.patch(billing._id, {
          lastInvoiceDate: args.paidAt || Date.now(),
          amount: args.amount / 100, // Convert from cents to dollars
          currency: args.currency,
          updatedAt: Date.now(),
        });
      }

      // Log the event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        eventType: "payment_succeeded",
        amount: args.amount,
        currency: args.currency,
        metadata: { invoiceId: args.invoiceId },
        createdAt: Date.now(),
      });

      console.log(
        `Payment successful for user ${user._id}: $${(args.amount / 100).toFixed(2)}`,
      );
      return { success: true };
    } catch (error) {
      console.error("Error handling payment succeeded:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Handle Stripe payment failed (invoice)
export const handlePaymentFailed = internalMutation({
  args: {
    invoiceId: v.string(),
    subscriptionId: v.optional(v.string()),
    customerId: v.string(),
    amount: v.number(),
    currency: v.string(),
    attemptCount: v.number(),
    nextPaymentAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Payment failed for invoice: ${args.invoiceId}`);

      // Find user by customer ID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("stripeCustomerId"), args.customerId))
        .unique();

      if (!user) {
        console.error(`User not found for customer: ${args.customerId}`);
        return { success: false, error: "User not found" };
      }

      // Update billing record status if multiple failures
      const billing = await ctx.db
        .query("billing")
        .filter((q) => q.eq(q.field("userId"), user._id))
        .unique();

      if (billing && args.attemptCount >= 3) {
        await ctx.db.patch(billing._id, {
          status: "past_due",
          updatedAt: Date.now(),
        });
      }

      // Log the event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        eventType: "payment_failed",
        amount: args.amount,
        currency: args.currency,
        metadata: {
          invoiceId: args.invoiceId,
          attemptCount: args.attemptCount,
          nextPaymentAttempt: args.nextPaymentAttempt,
        },
        createdAt: Date.now(),
      });

      console.log(
        `Payment failed for user ${user._id}: attempt ${args.attemptCount}`,
      );
      return { success: true };
    } catch (error) {
      console.error("Error handling payment failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
