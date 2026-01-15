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
import {
  classifyFastSpringError,
  createApiConvexError,
  type ApiError,
} from "../lib/apiErrors";

// FastSpring API request configuration
const FASTSPRING_API_TIMEOUT_MS = 30000; // 30 second timeout
const FASTSPRING_MAX_RETRIES = 3;
const FASTSPRING_BASE_DELAY_MS = 1000;

/**
 * Fetch wrapper with retry logic and timeout for FastSpring API calls
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  operationName: string
): Promise<{ response: Response; apiError?: ApiError }> {
  let lastError: Error | undefined;
  let lastApiError: ApiError | undefined;

  for (let attempt = 0; attempt < FASTSPRING_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FASTSPRING_API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // If successful, return immediately
      if (response.ok) {
        return { response };
      }

      // Classify the error
      const errorText = await response.text();
      const apiError = classifyFastSpringError(response.status, errorText);
      lastApiError = apiError;

      // Don't retry on client errors (4xx) except 408 (timeout) and 429 (rate limit)
      if (response.status >= 400 && response.status < 500 &&
          response.status !== 408 && response.status !== 429) {
        console.error(`[FastSpring] ${operationName} client error:`, {
          status: response.status,
          errorCode: apiError.errorCode,
          category: apiError.category,
        });
        return { response, apiError };
      }

      // Retry on server errors and rate limits
      if (apiError.retryable && attempt < FASTSPRING_MAX_RETRIES - 1) {
        const delay = Math.min(
          FASTSPRING_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000,
          15000
        );
        console.warn(`[FastSpring] ${operationName} retrying in ${delay}ms (attempt ${attempt + 1}/${FASTSPRING_MAX_RETRIES}):`, {
          status: response.status,
          errorCode: apiError.errorCode,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Max retries reached or non-retryable
      return { response, apiError };

    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;

      // Check for timeout
      if (error.name === 'AbortError') {
        console.error(`[FastSpring] ${operationName} timeout after ${FASTSPRING_API_TIMEOUT_MS}ms`);
        if (attempt < FASTSPRING_MAX_RETRIES - 1) {
          const delay = FASTSPRING_BASE_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[FastSpring] ${operationName} retrying after timeout (attempt ${attempt + 1}/${FASTSPRING_MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Network errors - retry
      if (attempt < FASTSPRING_MAX_RETRIES - 1) {
        const delay = FASTSPRING_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[FastSpring] ${operationName} network error, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error(`FastSpring ${operationName} failed after ${FASTSPRING_MAX_RETRIES} attempts`);
}

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

    const baseHeaders = {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/json",
    };

    let url: string;
    let method: string;
    let body: string | undefined;
    const operationName = `manage_subscription_${args.action}`;

    switch (args.action) {
      case "cancel":
        // Cancel at period end (deactivate at next billing date)
        url = `https://api.fastspring.com/subscriptions/${user.fastspringSubscriptionId}`;
        method = "DELETE";
        break;

      case "cancel_immediately":
        // Cancel immediately with billingPeriod=0
        url = `https://api.fastspring.com/subscriptions/${user.fastspringSubscriptionId}?billingPeriod=0`;
        method = "DELETE";
        break;

      case "reactivate":
        // Reactivate a cancelled subscription
        url = `https://api.fastspring.com/subscriptions`;
        method = "POST";
        body = JSON.stringify({
          subscriptions: [
            {
              subscription: user.fastspringSubscriptionId,
              deactivate: false,
            },
          ],
        });
        break;
    }

    try {
      const { response, apiError } = await fetchWithRetry(
        url,
        {
          method,
          headers: baseHeaders,
          ...(body && { body }),
        },
        operationName
      );

      if (apiError) {
        console.error(`[FastSpring] ${operationName} failed:`, {
          errorCode: apiError.errorCode,
          category: apiError.category,
          userMessage: apiError.userMessage,
        });
        throw createApiConvexError(apiError);
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
    } catch (error: any) {
      // Re-throw classified API errors
      if (error?.data?.type === "api_error") {
        throw error;
      }
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

    const operationName = "get_management_url";

    try {
      const { response, apiError } = await fetchWithRetry(
        `https://api.fastspring.com/accounts/${user.fastspringAccountId}/authenticate`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
        },
        operationName
      );

      if (apiError) {
        console.error(`[FastSpring] ${operationName} failed:`, {
          errorCode: apiError.errorCode,
          category: apiError.category,
          userMessage: apiError.userMessage,
        });
        throw createApiConvexError(apiError);
      }

      const data = await response.json();

      // The authenticate endpoint returns a pre-authenticated URL
      // that's valid for 24 hours
      return {
        url: data.accounts?.[0]?.url || data.url,
        expiresIn: 24 * 60 * 60, // 24 hours in seconds
      };
    } catch (error: any) {
      // Re-throw classified API errors
      if (error?.data?.type === "api_error") {
        throw error;
      }
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

    const operationName = "validate_order";

    try {
      const { response, apiError } = await fetchWithRetry(
        `https://api.fastspring.com/orders/${args.orderId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
        },
        operationName
      );

      if (apiError) {
        // For validation, return structured failure rather than throwing
        console.error(`[FastSpring] ${operationName} failed:`, {
          errorCode: apiError.errorCode,
          category: apiError.category,
        });
        return {
          valid: false,
          reason: apiError.category === "not_found" ? "Order not found" : apiError.userMessage,
          apiError,
        };
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

    const operationName = "get_subscription_details";

    try {
      const { response, apiError } = await fetchWithRetry(
        `https://api.fastspring.com/subscriptions/${user.fastspringSubscriptionId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/json",
          },
        },
        operationName
      );

      if (apiError) {
        console.error(`[FastSpring] ${operationName} failed:`, {
          errorCode: apiError.errorCode,
          category: apiError.category,
        });
        // Return null for graceful degradation on non-critical errors
        // Throw for auth errors which need user attention
        if (apiError.category === "authentication") {
          throw createApiConvexError(apiError);
        }
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
    } catch (error: any) {
      // Re-throw classified API errors
      if (error?.data?.type === "api_error") {
        throw error;
      }
      console.error("Error fetching FastSpring subscription:", error);
      return null;
    }
  },
});
