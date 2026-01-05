// =============================================================================
// TYPES - Single Source of Truth for Pricing Types
// =============================================================================

/**
 * Available plan types - the canonical list of subscription plans.
 * This is the SINGLE SOURCE OF TRUTH for plan types across the application.
 *
 * Note: "custom" is for special managed subscriptions with custom pricing
 */
export type PlanType = "starter" | "professional" | "business" | "enterprise" | "custom";

export type CreditPack = {
  id: string;
  credits: number;
  priceCents: number;
  bonus?: number;
};

export type PlanCatalogItem = {
  planId: PlanType;
  planName: string;
  monthlyPrice: number;
  yearlyPrice: number;
  // FastSpring product paths for checkout
  fastspringProductPathMonthly?: string;
  fastspringProductPathYearly?: string;
  limits?: {
    monthlySearches: number;
    maxLeadsPerSearch: number;
    monthlyEnrichments: number;
    monthlyExports: number;
    emailGeneration: boolean;
    bulkOperations: boolean;
    apiAccess: boolean;
    requiresOwnApiKeys: boolean;
    supportLevel: string;
  };
  features?: string[];
};

export type RuntimeConfig = {
  version: number;
  creditPacks: CreditPack[];
  planCatalog: PlanCatalogItem[];
  creditCosts: Record<string, number> | null;
};

// =============================================================================
// PRICING HELPERS - Pure functions that work with RuntimeConfig data
// =============================================================================

/**
 * Format a price for display.
 * Returns "Free" for 0, otherwise formats as "$X" or "$X,XXX".
 */
export const formatPrice = (price: number): string => {
  return price === 0 ? "Free" : `$${price.toLocaleString()}`;
};

/**
 * Get a plan's price from the runtime config.
 * Falls back to 0 if plan not found.
 */
export const getPlanPrice = (
  planCatalog: PlanCatalogItem[],
  planId: PlanType,
  isYearly: boolean
): number => {
  const plan = planCatalog.find((p) => p.planId === planId);
  if (!plan) return 0;
  return isYearly ? plan.yearlyPrice : plan.monthlyPrice;
};

/**
 * Calculate annual savings percentage for a plan.
 * Returns 0 for free plans or if plan not found.
 */
export const getAnnualSavings = (
  planCatalog: PlanCatalogItem[],
  planId: PlanType
): number => {
  const plan = planCatalog.find((p) => p.planId === planId);
  if (!plan) return 0;

  const monthlyTotal = plan.monthlyPrice * 12;
  const yearlyTotal = plan.yearlyPrice * 12;

  if (monthlyTotal === 0) return 0; // Free plan has no savings

  return Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100);
};

/**
 * Get the display name for a plan type.
 */
export const getPlanDisplayName = (plan: PlanType): string => {
  const names: Record<PlanType, string> = {
    starter: "Starter",
    professional: "Professional",
    business: "Business",
    enterprise: "Enterprise",
    custom: "Custom Plan",
  };
  return names[plan];
};

/**
 * Check if a plan requires payment (vs free or enterprise contact-sales).
 */
export const isPaidPlan = (plan: PlanType): boolean => {
  return plan === "professional" || plan === "business";
};

/**
 * Check if a plan is contact-sales only.
 */
export const isContactSalesPlan = (plan: PlanType): boolean => {
  return plan === "enterprise";
};

/**
 * Get a plan's catalog entry from runtime config.
 */
export const getPlanFromCatalog = (
  planCatalog: PlanCatalogItem[],
  planId: PlanType
): PlanCatalogItem | undefined => {
  return planCatalog.find((p) => p.planId === planId);
};

// =============================================================================
// RUNTIME CONFIG LOADING
// =============================================================================

const LS_KEY = "genni.runtimeConfig";
let inMemory: RuntimeConfig | null = null;
let inflight: Promise<RuntimeConfig> | null = null;

export async function loadRuntimeConfig(force = false): Promise<RuntimeConfig> {
  if (!force && inMemory) return inMemory;
  if (!force && inflight) return inflight;

  const fromStorage = safeRead();
  if (fromStorage && !force) {
    inMemory = fromStorage;
    return fromStorage;
  }

  inflight = fetch("/api/public/config", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to load runtime config");
      const data = (await res.json()) as RuntimeConfig;
      inMemory = data;
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
      } catch (e) {
        // Ignore storage write errors (e.g., quota, private mode)
      }
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function getRuntimeConfigSync(): RuntimeConfig | null {
  return inMemory || safeRead();
}

function safeRead(): RuntimeConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RuntimeConfig;
  } catch {
    return null;
  }
}

import { useEffect, useState } from "react";

export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig | null>(
    getRuntimeConfigSync(),
  );
  const [loading, setLoading] = useState(config == null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadRuntimeConfig(config == null)
      .then((cfg) => {
        if (mounted) {
          setConfig(cfg);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [config]);

  return { config, loading, error };
}
