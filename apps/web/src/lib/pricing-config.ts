// Centralized Pricing Configuration
// All pricing comes from environment variables - zero hardcoded values

export interface PlanPricing {
  monthly: number;
  yearly: number;
}

export interface PricingConfig {
  starter: PlanPricing;
  professional: PlanPricing;
  business: PlanPricing;
  enterprise: PlanPricing;
}

// Environment variable validation
function getRequiredEnvVar(name: string): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePrice(envVar: string): number {
  const value = getRequiredEnvVar(envVar);
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid price value for ${envVar}: ${value}`);
  }
  return parsed;
}

// Build configuration from environment variables
export const PRICING_CONFIG: PricingConfig = {
  starter: {
    monthly: parsePrice("VITE_PRICING_STARTER_MONTHLY"),
    yearly: parsePrice("VITE_PRICING_STARTER_YEARLY"),
  },
  professional: {
    monthly: parsePrice("VITE_PRICING_PROFESSIONAL_MONTHLY"),
    yearly: parsePrice("VITE_PRICING_PROFESSIONAL_YEARLY"),
  },
  business: {
    monthly: parsePrice("VITE_PRICING_BUSINESS_MONTHLY"),
    yearly: parsePrice("VITE_PRICING_BUSINESS_YEARLY"),
  },
  enterprise: {
    monthly: parsePrice("VITE_PRICING_ENTERPRISE_MONTHLY"),
    yearly: parsePrice("VITE_PRICING_ENTERPRISE_YEARLY"),
  },
} as const;

export type PlanType = keyof typeof PRICING_CONFIG;

// Helper functions for consistent pricing calculations
export const getPlanPrice = (plan: PlanType, isYearly: boolean): number => {
  return isYearly ? PRICING_CONFIG[plan].yearly : PRICING_CONFIG[plan].monthly;
};

export const getAnnualSavings = (plan: PlanType): number => {
  const monthly = PRICING_CONFIG[plan].monthly;
  const yearly = PRICING_CONFIG[plan].yearly;

  if (monthly === 0) return 0; // Free plan has no savings

  const monthlyTotal = monthly * 12;
  const yearlyTotal = yearly * 12;
  return Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100);
};

export const formatPrice = (price: number): string => {
  return price === 0 ? "Free" : `$${price.toLocaleString()}`;
};

export const getPlanDisplayName = (plan: PlanType): string => {
  const names: Record<PlanType, string> = {
    starter: "Starter",
    professional: "Professional",
    business: "Business",
    enterprise: "Enterprise",
  };
  return names[plan];
};

// Stripe Price ID helpers
export const getStripePriceId = (plan: PlanType, isYearly: boolean): string => {
  const suffix = isYearly ? "_YEARLY" : "_MONTHLY";
  const envVar = `VITE_STRIPE_${plan.toUpperCase()}_PRICE_ID${suffix}`;
  return getRequiredEnvVar(envVar);
};

// Validation function to ensure all required env vars are present
export const validatePricingConfig = (): void => {
  const plans: PlanType[] = [
    "starter",
    "professional",
    "business",
    "enterprise",
  ];
  const periods = ["MONTHLY", "YEARLY"];

  // Validate pricing environment variables
  plans.forEach((plan) => {
    periods.forEach((period) => {
      const envVar = `VITE_PRICING_${plan.toUpperCase()}_${period}`;
      try {
        parsePrice(envVar);
      } catch (error) {
        console.error(`Pricing validation failed: ${error}`);
        throw error;
      }
    });
  });

  // Validate Stripe Price ID environment variables
  plans.forEach((plan) => {
    if (plan !== "starter") {
      // Starter plan doesn't need Stripe IDs
      periods.forEach((period) => {
        const envVar = `VITE_STRIPE_${plan.toUpperCase()}_PRICE_ID_${period}`;
        try {
          getRequiredEnvVar(envVar);
        } catch (error) {
          console.error(`Stripe Price ID validation failed: ${error}`);
          throw error;
        }
      });
    }
  });
};

// Initialize and validate configuration on module load
try {
  validatePricingConfig();
} catch (error) {
  console.error("Pricing configuration validation failed:", error);
  // In development, this will help catch missing env vars early
  if (import.meta.env.DEV) {
    throw error;
  }
}

export default PRICING_CONFIG;
