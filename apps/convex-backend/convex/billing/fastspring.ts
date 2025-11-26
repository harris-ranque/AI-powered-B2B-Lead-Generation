"use node";
/**
 * FastSpring Integration Actions
 *
 * Handles all FastSpring payment operations including:
 * - Secure payload generation for checkout
 * - Subscription checkout initialization
 * - Credit pack purchases
 * - Subscription management (cancel, reactivate)
 * - Account management portal access
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api } from "../_generated/api";

// Type definitions for FastSpring
interface FastSpringSecurePayload {
  products: Array<{ path: string; quantity: number }>;
  tags: Record<string, string>;
  contact: {
    email: string;
    firstName: string;
    lastName: string;
    company?: string;
  };
  expires: number;
}

interface CreditPack {
  id: string;
  credits: number;
  priceCents: number;
  bonus?: number;
  active: boolean;
  fastspringProductPath?: string;
}

interface PlanConfig {
  planId: string;
  planName: string;
  monthlyPrice: number;
  yearlyPrice: number;
  fastspringProductPathMonthly?: string;
  fastspringProductPathYearly?: string;
  limits: {
    monthlySearches: number;
    maxLeadsPerSearch: number;
    monthlyEnrichments: number;
    monthlyExports: number;
    emailGeneration: boolean;
    bulkOperations: boolean;
    apiAccess: boolean;
    requiresOwnApiKeys: boolean;
  };
  features: string[];
  isActive: boolean;
  isVisible: boolean;
}

/**
 * Generate a secure encrypted payload for FastSpring checkout
 * Uses RSA encryption to prevent price tampering on the client side
 */
export const createSecurePayload = action({
  args: {
    productPath: v.string(),
    tags: v.object({
      userId: v.string(),
      planId: v.optional(v.string()),
      billingCycle: v.optional(v.string()),
      credits: v.optional(v.number()),
      type: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    "use node";
    const crypto = await import("crypto");
    const user = await requireAuth(ctx);

    const privateKey = process.env.FASTSPRING_PRIVATE_KEY;
    const accessKey = process.env.FASTSPRING_ACCESS_KEY;

    if (!privateKey) {
      throw new Error("FastSpring private key not configured");
    }
    if (!accessKey) {
      throw new Error("FastSpring access key not configured");
    }

    // Build the secure payload
    const payload: FastSpringSecurePayload = {
      products: [{ path: args.productPath, quantity: 1 }],
      tags: {
        userId: user._id,
        ...(args.tags.planId && { planId: args.tags.planId }),
        ...(args.tags.billingCycle && { billingCycle: args.tags.billingCycle }),
        ...(args.tags.credits !== undefined && {
          credits: String(args.tags.credits),
        }),
        ...(args.tags.type && { type: args.tags.type }),
      },
      contact: {
        email: user.email,
        firstName: user.name?.split(" ")[0] || "",
        lastName: user.name?.split(" ").slice(1).join(" ") || "",
      },
      // Payload expires in 1 hour
      expires: Math.floor(Date.now() / 1000) + 3600,
    };

    const payloadJson = JSON.stringify(payload);

    // Encrypt the payload using RSA private key
    // Note: FastSpring uses the unusual pattern of encrypting with private key
    // so they can decrypt with the public key they have on file
    const encryptedPayload = crypto
      .privateEncrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(payloadJson)
      )
      .toString("base64");

    return {
      securePayload: encryptedPayload,
      secureKey: accessKey,
    };
  },
});

/**
 * Initialize a subscription checkout session
 * Returns data needed to trigger FastSpring popup checkout on the frontend
 */
export const createSubscriptionCheckout = action({
  args: {
    planId: v.string(),
    billingCycle: v.union(v.literal("monthly"), v.literal("yearly")),
  },
  handler: async (ctx, args): Promise<{
    productPath: string;
    securePayload: string;
    secureKey: string;
    storeId: string;
    planId: string;
    billingCycle: "monthly" | "yearly";
  }> => {
    "use node";
    const user = await requireAuth(ctx);

    // Get plan configuration
    const plans: Array<{
      planId: string;
      fastspringProductPathMonthly?: string;
      fastspringProductPathYearly?: string;
    }> = await ctx.runQuery(api.billing.queries.getPlanCatalog, {});
    const plan = plans.find((p) => p.planId === args.planId);

    if (!plan) {
      throw new Error(`Plan not found: ${args.planId}`);
    }

    // Get the appropriate product path based on billing cycle
    const productPath: string | undefined =
      args.billingCycle === "yearly"
        ? plan.fastspringProductPathYearly
        : plan.fastspringProductPathMonthly;

    if (!productPath) {
      throw new Error(
        `FastSpring product path not configured for ${args.planId} ${args.billingCycle}`
      );
    }

    // Generate secure payload
    const secureData = await ctx.runAction(
      api.billing.fastspring.createSecurePayload,
      {
        productPath,
        tags: {
          userId: user._id,
          planId: args.planId,
          billingCycle: args.billingCycle,
          type: "subscription",
        },
      }
    );

    const storeId = process.env.FASTSPRING_STORE_ID;
    if (!storeId) {
      throw new Error("FastSpring store ID not configured");
    }

    return {
      productPath,
      securePayload: secureData.securePayload,
      secureKey: secureData.secureKey,
      storeId,
      planId: args.planId,
      billingCycle: args.billingCycle,
    };
  },
});

/**
 * Initialize a credit pack purchase checkout session
 * Returns data needed to trigger FastSpring popup checkout on the frontend
 */
export const createCreditsCheckout = action({
  args: {
    credits: v.number(),
  },
  handler: async (ctx, args): Promise<{
    productPath: string;
    securePayload: string;
    secureKey: string;
    storeId: string;
    credits: number;
    bonus: number;
    priceCents: number;
  }> => {
    "use node";
    const user = await requireAuth(ctx);

    // Load admin-configured credit packs
    const config = await ctx.runQuery(
      api.admin.queries.getSystemConfiguration,
      {}
    );
    const packs: CreditPack[] = (config?.creditPacks || []).filter(
      (p: CreditPack) => p.active
    );

    if (packs.length === 0) {
      throw new Error("No active credit packs configured");
    }

    // Find the requested credit pack
    const pack = packs.find((p) => p.credits === args.credits);
    if (!pack) {
      throw new Error(`Invalid credit pack: ${args.credits} credits`);
    }

    if (!pack.fastspringProductPath) {
      throw new Error(
        `FastSpring product path not configured for ${args.credits} credits pack`
      );
    }

    // Generate secure payload
    const secureData: { securePayload: string; secureKey: string } = await ctx.runAction(
      api.billing.fastspring.createSecurePayload,
      {
        productPath: pack.fastspringProductPath,
        tags: {
          userId: user._id,
          credits: args.credits,
          type: "credits_purchase",
        },
      }
    );

    const storeId = process.env.FASTSPRING_STORE_ID;
    if (!storeId) {
      throw new Error("FastSpring store ID not configured");
    }

    return {
      productPath: pack.fastspringProductPath,
      securePayload: secureData.securePayload,
      secureKey: secureData.secureKey,
      storeId,
      credits: args.credits,
      bonus: pack.bonus || 0,
      priceCents: pack.priceCents,
    };
  },
});

/**
 * Manage an existing subscription (cancel, reactivate, pause)
 * Calls FastSpring API directly
 */
export const manageSubscription = action({
  args: {
    action: v.union(
      v.literal("cancel"),
      v.literal("cancel_immediately"),
      v.literal("reactivate")
    ),
  },
  handler: async (ctx, args) => {
    "use node";
    const user = await requireAuth(ctx);

    if (!user.fastspringSubscriptionId) {
      throw new Error("No active subscription found");
    }

    const apiUsername = process.env.FASTSPRING_API_USERNAME;
    const apiPassword = process.env.FASTSPRING_API_PASSWORD;

    if (!apiUsername || !apiPassword) {
      throw new Error("FastSpring API credentials not configured");
    }

    const authHeader = Buffer.from(`${apiUsername}:${apiPassword}`).toString(
      "base64"
    );

    try {
      let response: Response;

      switch (args.action) {
        case "cancel":
          // Cancel at period end (deactivate at next billing date)
          response = await fetch(
            `https://api.fastspring.com/subscriptions/${user.fastspringSubscriptionId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Basic ${authHeader}`,
                "Content-Type": "application/json",
              },
            }
          );
          break;

        case "cancel_immediately":
          // Cancel immediately with billingPeriod=0
          response = await fetch(
            `https://api.fastspring.com/subscriptions/${user.fastspringSubscriptionId}?billingPeriod=0`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Basic ${authHeader}`,
                "Content-Type": "application/json",
              },
            }
          );
          break;

        case "reactivate":
          // Reactivate a cancelled subscription
          response = await fetch(`https://api.fastspring.com/subscriptions`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${authHeader}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              subscriptions: [
                {
                  subscription: user.fastspringSubscriptionId,
                  deactivate: false,
                },
              ],
            }),
          });
          break;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error("FastSpring API error:", errorText);
        throw new Error(`Failed to ${args.action} subscription`);
      }

      const result = await response.json();

      // Log the subscription event
      await ctx.runMutation(api.billing.webhooks.logSubscriptionEvent, {
        userId: user._id,
        eventType:
          args.action === "reactivate"
            ? "subscription_reactivated"
            : "subscription_cancelled",
        fastspringSubscriptionId: user.fastspringSubscriptionId,
        metadata: { action: args.action, result },
      });

      return {
        success: true,
        action: args.action,
      };
    } catch (error) {
      console.error("Error managing FastSpring subscription:", error);
      throw new Error(`Failed to ${args.action} subscription`);
    }
  },
});

/**
 * Get an authenticated URL to the FastSpring account management portal
 * Allows users to manage payment methods, view invoices, etc.
 */
export const getManagementUrl = action({
  args: {},
  handler: async (ctx) => {
    "use node";
    const user = await requireAuth(ctx);

    if (!user.fastspringAccountId) {
      throw new Error("No FastSpring account found for user");
    }

    const apiUsername = process.env.FASTSPRING_API_USERNAME;
    const apiPassword = process.env.FASTSPRING_API_PASSWORD;

    if (!apiUsername || !apiPassword) {
      throw new Error("FastSpring API credentials not configured");
    }

    const authHeader = Buffer.from(`${apiUsername}:${apiPassword}`).toString(
      "base64"
    );

    try {
      const response = await fetch(
        `https://api.fastspring.com/accounts/${user.fastspringAccountId}/authenticate`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("FastSpring API error:", errorText);
        throw new Error("Failed to generate account management URL");
      }

      const data = await response.json();

      // The authenticate endpoint returns a pre-authenticated URL
      // that's valid for 24 hours
      return {
        url: data.accounts?.[0]?.url || data.url,
        expiresIn: 24 * 60 * 60, // 24 hours in seconds
      };
    } catch (error) {
      console.error("Error getting FastSpring management URL:", error);
      throw new Error("Failed to get account management URL");
    }
  },
});

/**
 * Validate an order after checkout completion (called from frontend)
 * Verifies the order with FastSpring API before confirming to user
 */
export const validateOrder = action({
  args: {
    orderId: v.string(),
    orderReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    "use node";
    const user = await requireAuth(ctx);

    const apiUsername = process.env.FASTSPRING_API_USERNAME;
    const apiPassword = process.env.FASTSPRING_API_PASSWORD;

    if (!apiUsername || !apiPassword) {
      throw new Error("FastSpring API credentials not configured");
    }

    const authHeader = Buffer.from(`${apiUsername}:${apiPassword}`).toString(
      "base64"
    );

    try {
      const response = await fetch(
        `https://api.fastspring.com/orders/${args.orderId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error("FastSpring order validation failed");
        return { valid: false, reason: "Order not found" };
      }

      const order = await response.json();

      // Verify the order belongs to this user via tags
      const orderUserId = order.tags?.userId;
      if (orderUserId && orderUserId !== user._id) {
        console.error("Order user mismatch");
        return { valid: false, reason: "Order user mismatch" };
      }

      // Verify order is completed
      if (!order.completed) {
        return { valid: false, reason: "Order not completed" };
      }

      return {
        valid: true,
        orderId: order.id,
        reference: order.reference,
        total: order.total,
        currency: order.currency,
        items: order.items,
      };
    } catch (error) {
      console.error("Error validating FastSpring order:", error);
      return { valid: false, reason: "Validation error" };
    }
  },
});

/**
 * Get subscription details from FastSpring API
 */
export const getSubscriptionDetails = action({
  args: {},
  handler: async (ctx) => {
    "use node";
    const user = await requireAuth(ctx);

    if (!user.fastspringSubscriptionId) {
      return null;
    }

    const apiUsername = process.env.FASTSPRING_API_USERNAME;
    const apiPassword = process.env.FASTSPRING_API_PASSWORD;

    if (!apiUsername || !apiPassword) {
      throw new Error("FastSpring API credentials not configured");
    }

    const authHeader = Buffer.from(`${apiUsername}:${apiPassword}`).toString(
      "base64"
    );

    try {
      const response = await fetch(
        `https://api.fastspring.com/subscriptions/${user.fastspringSubscriptionId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        console.error("Failed to fetch subscription details");
        return null;
      }

      const subscription = await response.json();

      return {
        id: subscription.id,
        state: subscription.state,
        product: subscription.product,
        nextChargeDate: subscription.nextChargeDate,
        endDate: subscription.endDate,
        price: subscription.price,
        currency: subscription.currency,
        intervalUnit: subscription.intervalUnit,
        intervalLength: subscription.intervalLength,
        canceledDate: subscription.canceledDate,
        deactivationDate: subscription.deactivationDate,
      };
    } catch (error) {
      console.error("Error fetching FastSpring subscription:", error);
      return null;
    }
  },
});
