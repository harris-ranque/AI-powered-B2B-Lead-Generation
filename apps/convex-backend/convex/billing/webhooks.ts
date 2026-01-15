/**
 * FastSpring Webhook Handlers
 *
 * Handles all FastSpring webhook events including:
 * - order.completed (one-time purchases and subscription activations)
 * - subscription.activated (new subscriptions)
 * - subscription.charge.completed (recurring payments)
 * - subscription.updated (plan changes, prorations)
 * - subscription.canceled (cancellation initiated)
 * - subscription.deactivated (subscription ended)
 */

import { internalMutation, mutation } from "../_generated/server";
import { v } from "convex/values";
import { createOperationLogger } from "../lib/logger";
import { Doc, Id } from "../_generated/dataModel";
import { DatabaseReader } from "../_generated/server";

// Helper: resolve plan from FastSpring product path
async function resolvePlanFromProductPath(
  db: DatabaseReader,
  productPath?: string
): Promise<{
  plan: "starter" | "professional" | "business" | "enterprise";
  billingCycle?: "monthly" | "yearly";
}> {
  if (!productPath) return { plan: "starter" };

  try {
    const plans = await db.query("planConfigurations").collect();
    for (const cfg of plans) {
      if (cfg.fastspringProductPathMonthly === productPath) {
        return { plan: cfg.planId as any, billingCycle: "monthly" };
      }
      if (cfg.fastspringProductPathYearly === productPath) {
        return { plan: cfg.planId as any, billingCycle: "yearly" };
      }
    }
  } catch (e) {
    console.error("Error resolving plan from product path:", e);
  }

  // Fallback heuristic based on product path naming
  const lower = productPath.toLowerCase();
  const isYearly = lower.includes("yearly") || lower.includes("annual");

  if (lower.includes("enterprise"))
    return { plan: "enterprise", billingCycle: isYearly ? "yearly" : "monthly" };
  if (lower.includes("business"))
    return { plan: "business", billingCycle: isYearly ? "yearly" : "monthly" };
  if (lower.includes("professional") || lower.includes("pro"))
    return {
      plan: "professional",
      billingCycle: isYearly ? "yearly" : "monthly",
    };

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
        requiresOwnApiKeys: true,
      };
    default: // starter/free
      return {
        monthlySearches: 10,
        maxLeadsPerSearch: 25,
        monthlyEnrichments: 500,
        monthlyExports: 10,
        emailGeneration: false,
        bulkOperations: false,
        apiAccess: false,
        requiresOwnApiKeys: false,
      };
  }
}

// Map credits from product path
function getCreditsFromProductPath(productPath: string): number {
  const lower = productPath.toLowerCase();
  if (lower.includes("credits-100")) return 100;
  if (lower.includes("credits-550")) return 550;
  if (lower.includes("credits-1150")) return 1150;
  if (lower.includes("credits-3000")) return 3000;
  // Try to extract number from path like "credits-500"
  const match = lower.match(/credits-(\d+)/);
  if (match && match[1]) return parseInt(match[1], 10);
  return 0;
}

/**
 * Log subscription event - public mutation for use by fastspring actions
 */
export const logSubscriptionEvent = mutation({
  args: {
    userId: v.id("users"),
    eventType: v.string(),
    fastspringSubscriptionId: v.optional(v.string()),
    fastspringAccountId: v.optional(v.string()),
    fastspringOrderId: v.optional(v.string()),
    oldPlan: v.optional(v.string()),
    newPlan: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("subscriptionEvents", {
      userId: args.userId,
      fastspringSubscriptionId: args.fastspringSubscriptionId,
      fastspringAccountId: args.fastspringAccountId,
      fastspringOrderId: args.fastspringOrderId,
      eventType: args.eventType as any,
      oldPlan: args.oldPlan,
      newPlan: args.newPlan,
      amount: args.amount,
      currency: args.currency,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

/**
 * Handle FastSpring order.completed event
 * Processes both one-time credit purchases and subscription orders
 */
export const handleOrderCompleted = internalMutation({
  args: {
    orderId: v.string(),
    orderReference: v.string(),
    accountId: v.string(),
    accountEmail: v.string(),
    total: v.number(),
    currency: v.string(),
    items: v.array(
      v.object({
        product: v.string(),
        quantity: v.number(),
        price: v.number(),
        subscription: v.optional(v.string()),
      })
    ),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook("system", "order_completed");
    const timer = logger.start(`Processing order: ${args.orderId}`);

    try {
      // Find user by tags.userId or by email
      let user: Doc<"users"> | null = null;

      if (args.tags?.userId) {
        try {
          user = await ctx.db.get(args.tags.userId as Id<"users">);
        } catch (e) {
          console.error("Error fetching user by ID:", e);
        }
      }

      if (!user) {
        user = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.accountEmail))
          .unique();
      }

      if (!user) {
        // Try by FastSpring account ID
        user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("fastspringAccountId"), args.accountId))
          .unique();
      }

      if (!user) {
        logger.error(`User not found for order: ${args.orderId}`, {
          orderId: args.orderId,
          accountEmail: args.accountEmail,
        });
        return { success: false, error: "User not found" };
      }

      // Update user with FastSpring account ID if not set
      if (!user.fastspringAccountId) {
        await ctx.db.patch(user._id, {
          fastspringAccountId: args.accountId,
          updatedAt: Date.now(),
        });
      }

      // Process each item in the order
      for (const item of args.items) {
        // Check if this is a credit purchase
        if (
          item.product.toLowerCase().includes("credits") ||
          args.tags?.type === "credits_purchase"
        ) {
          // Idempotency check: skip if transaction with this orderId already exists
          const existingTx = await ctx.db
            .query("creditTransactions")
            .withIndex("by_user", (q) => q.eq("userId", user!._id))
            .filter((q) => q.eq(q.field("fastspringOrderId"), args.orderId))
            .first();

          if (existingTx) {
            logger.debug(`Order ${args.orderId} already processed, skipping`, {
              orderId: args.orderId,
            });
            continue;
          }

          // Determine credits to add
          const creditsFromTags =
            args.tags?.credits !== undefined
              ? parseInt(String(args.tags.credits), 10)
              : 0;
          const creditsFromProduct = getCreditsFromProductPath(item.product);
          const creditsToAdd =
            (creditsFromTags || creditsFromProduct) * item.quantity;

          if (creditsToAdd > 0) {
            const newBalance = (user.credits || 0) + creditsToAdd;

            await ctx.db.patch(user._id, {
              credits: newBalance,
              updatedAt: Date.now(),
            });

            await ctx.db.insert("creditTransactions", {
              userId: user._id,
              type: "purchase",
              amount: creditsToAdd,
              description: `Credits purchase: ${creditsToAdd} credits (Order ${args.orderReference})`,
              relatedEntity: { type: "fastspring_order", id: args.orderId },
              fastspringOrderId: args.orderId,
              fastspringOrderReference: args.orderReference,
              balanceAfter: newBalance,
              createdAt: Date.now(),
            });

            logger.complete(
              timer,
              `Added ${creditsToAdd} credits to user ${user._id}`,
              {
                userId: user._id,
                orderId: args.orderId,
                credits: creditsToAdd,
              }
            );
          }
        }

        // If item has a subscription ID, update user with it
        if (item.subscription && !user.fastspringSubscriptionId) {
          await ctx.db.patch(user._id, {
            fastspringSubscriptionId: item.subscription,
            updatedAt: Date.now(),
          });
        }
      }

      // Log the order event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringOrderId: args.orderId,
        eventType: "subscription_created",
        amount: Math.round(args.total * 100), // Convert to cents
        currency: args.currency,
        metadata: {
          orderReference: args.orderReference,
          items: args.items.map((i) => i.product),
        },
        createdAt: Date.now(),
      });

      return { success: true };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling order completed: ${args.orderId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle FastSpring subscription.activated event
 * Called when a new subscription becomes active
 */
export const handleSubscriptionActivated = internalMutation({
  args: {
    subscriptionId: v.string(),
    accountId: v.string(),
    accountEmail: v.string(),
    product: v.string(),
    state: v.string(),
    nextChargeDate: v.optional(v.number()),
    price: v.number(),
    currency: v.string(),
    intervalUnit: v.optional(v.string()),
    intervalLength: v.optional(v.number()),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_activated"
    );
    const timer = logger.start(
      `Activating subscription: ${args.subscriptionId}`
    );

    try {
      // Find user
      let user: Doc<"users"> | null = null;

      if (args.tags?.userId) {
        try {
          user = await ctx.db.get(args.tags.userId as Id<"users">);
        } catch (e) {
          console.error("Error fetching user by ID:", e);
        }
      }

      if (!user) {
        user = await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.accountEmail))
          .unique();
      }

      if (!user) {
        user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("fastspringAccountId"), args.accountId))
          .unique();
      }

      if (!user) {
        logger.error(
          `User not found for subscription activation: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
            accountEmail: args.accountEmail,
          }
        );
        return { success: false, error: "User not found" };
      }

      // Resolve plan from product path
      const { plan, billingCycle } = await resolvePlanFromProductPath(
        ctx.db,
        args.product
      );
      const planLimits = getPlanLimits(plan);

      // Determine billing cycle from interval if not resolved
      const resolvedBillingCycle =
        billingCycle ||
        (args.intervalUnit === "year" ||
        (args.intervalUnit === "month" && args.intervalLength === 12)
          ? "yearly"
          : "monthly");

      // Calculate current period dates
      const now = Date.now();
      const periodLengthMs =
        resolvedBillingCycle === "yearly"
          ? 365 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
      const currentPeriodEnd = args.nextChargeDate
        ? args.nextChargeDate * 1000
        : now + periodLengthMs;

      // Create or update billing record
      const existingBilling = await ctx.db
        .query("billing")
        .withIndex("by_user", (q) => q.eq("userId", user!._id))
        .unique();

      const billingData = {
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        fastspringProductPath: args.product,
        plan: plan,
        status: "active" as const,
        billingCycle: resolvedBillingCycle,
        amount: args.price,
        currency: args.currency,
        currentPeriodStart: now,
        currentPeriodEnd,
        isTrialing: false,
        cancelAtPeriodEnd: false,
        planLimits,
        updatedAt: now,
      };

      if (existingBilling) {
        await ctx.db.patch(existingBilling._id, billingData);
      } else {
        await ctx.db.insert("billing", {
          userId: user._id,
          ...billingData,
          createdAt: now,
        });
      }

      // Update user
      await ctx.db.patch(user._id, {
        plan,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        updatedAt: now,
      });

      // Create usage tracking for new period
      const existingUsage = await ctx.db
        .query("usageTracking")
        .withIndex("by_user_current", (q) =>
          q.eq("userId", user!._id).eq("isCurrentPeriod", true)
        )
        .unique();

      if (!existingUsage) {
        await ctx.db.insert("usageTracking", {
          userId: user._id,
          billingPeriodStart: now,
          billingPeriodEnd: currentPeriodEnd,
          searchesUsed: 0,
          leadsEnriched: 0,
          emailsGenerated: 0,
          exportsCompleted: 0,
          apiCallsMade: 0,
          creditsUsed: 0,
          isCurrentPeriod: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Log event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        eventType: "subscription_created",
        newPlan: plan,
        amount: Math.round(args.price * 100),
        currency: args.currency,
        createdAt: now,
      });

      logger.complete(
        timer,
        `Subscription activated for user ${user._id}: ${plan}`,
        {
          userId: user._id,
          subscriptionId: args.subscriptionId,
          plan,
        }
      );

      return { success: true, plan };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling subscription activated: ${args.subscriptionId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle FastSpring subscription.charge.completed event
 * Called when a recurring payment is successful
 */
export const handleSubscriptionChargeCompleted = internalMutation({
  args: {
    subscriptionId: v.string(),
    accountId: v.string(),
    orderId: v.string(),
    orderReference: v.string(),
    product: v.string(),
    price: v.number(),
    currency: v.string(),
    nextChargeDate: v.optional(v.number()),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_charge_completed"
    );
    const timer = logger.start(
      `Processing subscription charge: ${args.subscriptionId}`
    );

    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("fastspringSubscriptionId"), args.subscriptionId)
        )
        .unique();

      if (!user) {
        logger.error(
          `User not found for subscription charge: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
          }
        );
        return { success: false, error: "User not found" };
      }

      const now = Date.now();

      // Update billing record
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();

      if (billing) {
        const periodLengthMs =
          billing.billingCycle === "yearly"
            ? 365 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000;
        const newPeriodEnd = args.nextChargeDate
          ? args.nextChargeDate * 1000
          : now + periodLengthMs;

        await ctx.db.patch(billing._id, {
          lastInvoiceDate: now,
          amount: args.price,
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
          status: "active",
          updatedAt: now,
        });

        // Roll over usage tracking
        const currentUsage = await ctx.db
          .query("usageTracking")
          .withIndex("by_user_current", (q) =>
            q.eq("userId", user._id).eq("isCurrentPeriod", true)
          )
          .unique();

        if (currentUsage) {
          await ctx.db.patch(currentUsage._id, {
            isCurrentPeriod: false,
            updatedAt: now,
          });
        }

        // Create new usage tracking period
        await ctx.db.insert("usageTracking", {
          userId: user._id,
          billingPeriodStart: now,
          billingPeriodEnd: newPeriodEnd,
          searchesUsed: 0,
          leadsEnriched: 0,
          emailsGenerated: 0,
          exportsCompleted: 0,
          apiCallsMade: 0,
          creditsUsed: 0,
          isCurrentPeriod: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Log event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        fastspringOrderId: args.orderId,
        eventType: "payment_succeeded",
        amount: Math.round(args.price * 100),
        currency: args.currency,
        metadata: { orderReference: args.orderReference },
        createdAt: now,
      });

      logger.complete(
        timer,
        `Subscription charge processed for user ${user._id}`,
        {
          userId: user._id,
          subscriptionId: args.subscriptionId,
          amount: args.price,
        }
      );

      return { success: true };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling subscription charge: ${args.subscriptionId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle FastSpring subscription.updated event
 * Called when a subscription is modified (plan change, proration, etc.)
 */
export const handleSubscriptionUpdated = internalMutation({
  args: {
    subscriptionId: v.string(),
    accountId: v.string(),
    product: v.string(),
    state: v.string(),
    price: v.number(),
    currency: v.string(),
    nextChargeDate: v.optional(v.number()),
    intervalUnit: v.optional(v.string()),
    intervalLength: v.optional(v.number()),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_updated"
    );
    const timer = logger.start(`Updating subscription: ${args.subscriptionId}`);

    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("fastspringSubscriptionId"), args.subscriptionId)
        )
        .unique();

      if (!user) {
        logger.error(
          `User not found for subscription update: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
          }
        );
        return { success: false, error: "User not found" };
      }

      // Get billing record
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();

      if (!billing) {
        logger.error(`Billing record not found for user: ${user._id}`, {
          userId: user._id,
        });
        return { success: false, error: "Billing record not found" };
      }

      const oldPlan = billing.plan;
      const { plan: newPlan, billingCycle } = await resolvePlanFromProductPath(
        ctx.db,
        args.product
      );
      const planLimits = getPlanLimits(newPlan);
      const now = Date.now();

      // Map FastSpring state to our status
      let status: typeof billing.status = "active";
      if (args.state === "canceled") status = "cancelled";
      else if (args.state === "deactivated") status = "cancelled";
      else if (args.state === "trial") status = "trialing";

      // Calculate period end
      const periodLengthMs =
        billingCycle === "yearly"
          ? 365 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
      const currentPeriodEnd = args.nextChargeDate
        ? args.nextChargeDate * 1000
        : now + periodLengthMs;

      // Update billing
      await ctx.db.patch(billing._id, {
        fastspringProductPath: args.product,
        plan: newPlan,
        status,
        amount: args.price,
        currency: args.currency,
        currentPeriodEnd,
        billingCycle: billingCycle || billing.billingCycle,
        planLimits,
        updatedAt: now,
      });

      // Update user plan if changed
      if (oldPlan !== newPlan) {
        await ctx.db.patch(user._id, {
          plan: newPlan,
          updatedAt: now,
        });
      }

      // Log event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        eventType: oldPlan !== newPlan ? "plan_changed" : "subscription_updated",
        oldPlan,
        newPlan,
        amount: Math.round(args.price * 100),
        currency: args.currency,
        createdAt: now,
      });

      logger.complete(
        timer,
        `Subscription updated for user ${user._id}: ${oldPlan} -> ${newPlan}`,
        {
          userId: user._id,
          subscriptionId: args.subscriptionId,
          oldPlan,
          newPlan,
        }
      );

      return { success: true, oldPlan, newPlan };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling subscription update: ${args.subscriptionId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle FastSpring subscription.canceled event
 * Called when subscription cancellation is initiated (will cancel at period end)
 */
export const handleSubscriptionCanceled = internalMutation({
  args: {
    subscriptionId: v.string(),
    accountId: v.string(),
    product: v.string(),
    canceledDate: v.optional(v.number()),
    deactivationDate: v.optional(v.number()),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_canceled"
    );
    const timer = logger.start(
      `Processing subscription cancellation: ${args.subscriptionId}`
    );

    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("fastspringSubscriptionId"), args.subscriptionId)
        )
        .unique();

      if (!user) {
        logger.error(
          `User not found for subscription cancellation: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
          }
        );
        return { success: false, error: "User not found" };
      }

      const now = Date.now();

      // Update billing record
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();

      if (billing) {
        await ctx.db.patch(billing._id, {
          cancelAtPeriodEnd: true,
          cancelAt: args.deactivationDate
            ? args.deactivationDate * 1000
            : undefined,
          canceledAt: args.canceledDate ? args.canceledDate * 1000 : now,
          updatedAt: now,
        });
      }

      // Log event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        eventType: "subscription_cancelled",
        oldPlan: user.plan,
        metadata: {
          canceledDate: args.canceledDate,
          deactivationDate: args.deactivationDate,
        },
        createdAt: now,
      });

      logger.complete(
        timer,
        `Subscription cancellation processed for user ${user._id}`,
        {
          userId: user._id,
          subscriptionId: args.subscriptionId,
        }
      );

      return { success: true };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling subscription cancellation: ${args.subscriptionId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle FastSpring subscription.deactivated event
 * Called when subscription is fully terminated (end of cancellation period)
 */
export const handleSubscriptionDeactivated = internalMutation({
  args: {
    subscriptionId: v.string(),
    accountId: v.string(),
    product: v.string(),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_deactivated"
    );
    const timer = logger.start(
      `Deactivating subscription: ${args.subscriptionId}`
    );

    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("fastspringSubscriptionId"), args.subscriptionId)
        )
        .unique();

      if (!user) {
        logger.error(
          `User not found for subscription deactivation: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
          }
        );
        return { success: false, error: "User not found" };
      }

      const oldPlan = user.plan;
      const now = Date.now();

      // Downgrade user to starter/free plan
      await ctx.db.patch(user._id, {
        plan: "starter",
        fastspringSubscriptionId: undefined,
        updatedAt: now,
      });

      // Update billing record
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();

      if (billing) {
        await ctx.db.patch(billing._id, {
          status: "cancelled",
          plan: "starter",
          fastspringSubscriptionId: undefined,
          planLimits: getPlanLimits("starter"),
          updatedAt: now,
        });
      }

      // Log event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        eventType: "subscription_cancelled",
        oldPlan,
        newPlan: "starter",
        createdAt: now,
      });

      logger.complete(
        timer,
        `Subscription deactivated for user ${user._id}: ${oldPlan} -> starter`,
        {
          userId: user._id,
          subscriptionId: args.subscriptionId,
          oldPlan,
        }
      );

      return { success: true, oldPlan, newPlan: "starter" };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling subscription deactivation: ${args.subscriptionId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle FastSpring subscription.charge.failed event
 * Called when a recurring payment fails
 */
export const handleSubscriptionChargeFailed = internalMutation({
  args: {
    subscriptionId: v.string(),
    accountId: v.string(),
    product: v.string(),
    reason: v.optional(v.string()),
    retryDate: v.optional(v.number()),
    tags: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "subscription_charge_failed"
    );
    const timer = logger.start(
      `Processing failed charge: ${args.subscriptionId}`
    );

    try {
      // Find user by subscription ID
      const user = await ctx.db
        .query("users")
        .filter((q) =>
          q.eq(q.field("fastspringSubscriptionId"), args.subscriptionId)
        )
        .unique();

      if (!user) {
        logger.error(
          `User not found for failed charge: ${args.subscriptionId}`,
          {
            subscriptionId: args.subscriptionId,
          }
        );
        return { success: false, error: "User not found" };
      }

      const now = Date.now();

      // Update billing status to past_due if no retry scheduled
      const billing = await ctx.db
        .query("billing")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();

      if (billing && !args.retryDate) {
        await ctx.db.patch(billing._id, {
          status: "past_due",
          updatedAt: now,
        });
      }

      // Log event
      await ctx.db.insert("subscriptionEvents", {
        userId: user._id,
        fastspringAccountId: args.accountId,
        fastspringSubscriptionId: args.subscriptionId,
        eventType: "payment_failed",
        metadata: {
          reason: args.reason,
          retryDate: args.retryDate,
        },
        createdAt: now,
      });

      logger.complete(
        timer,
        `Failed charge recorded for user ${user._id}`,
        {
          userId: user._id,
          subscriptionId: args.subscriptionId,
          reason: args.reason,
        }
      );

      return { success: true };
    } catch (error) {
      logger.failure(
        timer,
        error as Error,
        `Error handling failed charge: ${args.subscriptionId}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
