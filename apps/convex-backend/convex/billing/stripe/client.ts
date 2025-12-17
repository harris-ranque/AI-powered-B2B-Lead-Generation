/**
 * Stripe Client Utility
 *
 * Provides a configured Stripe client for server-side operations.
 * Uses action context to access environment variables securely.
 */

import Stripe from "stripe";

// Cache the Stripe client instance
let stripeClient: Stripe | null = null;

/**
 * Get a configured Stripe client instance.
 * Creates a singleton instance on first call.
 *
 * @throws Error if STRIPE_SECRET_KEY environment variable is not set
 */
export function getStripeClient(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is not set. " +
        "Please configure it in your Convex dashboard."
    );
  }

  stripeClient = new Stripe(secretKey, {
    // API version must match the Stripe SDK version's expected version.
    // SDK v20.0.0 requires "2025-11-17.clover" - codenames (clover, basil, etc.)
    // are Stripe's internal naming convention, not instability indicators.
    // Update when upgrading the stripe package.
    apiVersion: "2025-11-17.clover",
    typescript: true,
    // Enable telemetry for Stripe to improve their service
    telemetry: true,
  });

  return stripeClient;
}

/**
 * Validate that all required Stripe environment variables are set.
 * Call this at startup to fail fast if configuration is missing.
 */
export function validateStripeConfig(): {
  valid: boolean;
  missing: string[];
} {
  const required = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ];

  const optional = [
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_CUSTOM_PRODUCT_ID",
  ];

  const missing = required.filter((key) => !process.env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get the Stripe webhook secret for signature verification.
 *
 * @throws Error if STRIPE_WEBHOOK_SECRET environment variable is not set
 */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET environment variable is not set. " +
        "Please configure it in your Convex dashboard."
    );
  }

  return secret;
}

/**
 * Get the Stripe product ID for custom subscriptions.
 * If not set, one will need to be created.
 */
export function getCustomProductId(): string | null {
  return process.env.STRIPE_CUSTOM_PRODUCT_ID || null;
}

/**
 * Convenience fee percentage for card payments (3%)
 */
export const CARD_CONVENIENCE_FEE_PERCENT = 0.03;

/**
 * Calculate convenience fee for a given amount.
 *
 * @param amountCents Base amount in cents
 * @returns Convenience fee in cents (rounded to nearest cent)
 */
export function calculateConvenienceFee(amountCents: number): number {
  return Math.round(amountCents * CARD_CONVENIENCE_FEE_PERCENT);
}

/**
 * Calculate total amount including convenience fee for card payments.
 *
 * @param basePriceCents Base price in cents
 * @param paymentMethodType Payment method type
 * @returns Total price in cents
 */
export function calculateTotalWithFee(
  basePriceCents: number,
  paymentMethodType: "card" | "us_bank_account"
): { total: number; fee: number } {
  if (paymentMethodType === "us_bank_account") {
    return { total: basePriceCents, fee: 0 };
  }

  const fee = calculateConvenienceFee(basePriceCents);
  return { total: basePriceCents + fee, fee };
}

/**
 * Format cents to dollars for display.
 *
 * @param cents Amount in cents
 * @returns Formatted dollar string (e.g., "$1,000.00")
 */
export function formatCentsToDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/**
 * Stripe API version being used.
 * Must match the Stripe SDK version's expected API version.
 * Codenames (clover, basil, acacia) are Stripe's internal naming - not stability indicators.
 * Update when upgrading the stripe package.
 */
export const STRIPE_API_VERSION = "2025-11-17.clover";

/**
 * Default checkout session expiration time (24 hours in seconds).
 */
export const CHECKOUT_EXPIRATION_SECONDS = 24 * 60 * 60;

/**
 * Stripe error codes for common scenarios.
 */
export const StripeErrorCodes = {
  CARD_DECLINED: "card_declined",
  EXPIRED_CARD: "expired_card",
  INCORRECT_CVC: "incorrect_cvc",
  PROCESSING_ERROR: "processing_error",
  INSUFFICIENT_FUNDS: "insufficient_funds",
  AUTHENTICATION_REQUIRED: "authentication_required",
} as const;

/**
 * Check if an error is a Stripe error.
 */
export function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof (error as { type: unknown }).type === "string" &&
    (error as { type: string }).type.startsWith("Stripe")
  );
}
