import { useSubscription } from "./useSubscription";
import { useUsage } from "./useUsage";

export type PlanTier = "starter" | "professional" | "business" | "enterprise";
export type FeatureKey = 
  | "email_generation" 
  | "bulk_operations" 
  | "api_access" 
  | "advanced_analytics"
  | "team_collaboration"
  | "custom_integrations"
  | "white_label"
  | "dedicated_support";

interface PlanFeatures {
  [key: string]: {
    features: FeatureKey[];
    limits: {
      monthlySearches: number;
      maxLeadsPerSearch: number;
      monthlyEnrichments: number;
      monthlyExports: number;
    };
  };
}

const PLAN_FEATURES: PlanFeatures = {
  starter: {
    features: [],
    limits: {
      monthlySearches: 10,
      maxLeadsPerSearch: 25,
      monthlyEnrichments: 500,
      monthlyExports: 10,
    },
  },
  professional: {
    features: ["email_generation", "bulk_operations", "api_access", "advanced_analytics"],
    limits: {
      monthlySearches: 50,
      maxLeadsPerSearch: 500,
      monthlyEnrichments: 25000,
      monthlyExports: 100,
    },
  },
  business: {
    features: [
      "email_generation", 
      "bulk_operations", 
      "api_access", 
      "advanced_analytics",
      "team_collaboration",
      "custom_integrations"
    ],
    limits: {
      monthlySearches: 200,
      maxLeadsPerSearch: 2000,
      monthlyEnrichments: 100000,
      monthlyExports: 500,
    },
  },
  enterprise: {
    features: [
      "email_generation",
      "bulk_operations", 
      "api_access", 
      "advanced_analytics",
      "team_collaboration",
      "custom_integrations",
      "white_label",
      "dedicated_support"
    ],
    limits: {
      monthlySearches: -1, // unlimited
      maxLeadsPerSearch: -1, // unlimited
      monthlyEnrichments: -1, // unlimited
      monthlyExports: -1, // unlimited
    },
  },
};

export function useSubscriptionGuard() {
  const { subscription, isLoading: subscriptionLoading, isStarter, isProfessional, isBusiness, isEnterprise } = useSubscription();
  const { usage, isLoading: usageLoading } = useUsage();

  const currentPlan: PlanTier = subscription?.plan || "starter";
  const planFeatures = PLAN_FEATURES[currentPlan];

  // Feature access checks
  const hasFeature = (feature: FeatureKey): boolean => {
    return planFeatures.features.includes(feature);
  };

  // Usage limit checks
  const canPerformAction = (action: "search" | "export" | "bulk_operation"): { 
    allowed: boolean; 
    reason?: string;
    upgradeRequired?: PlanTier;
  } => {
    if (!usage || usageLoading) {
      return { allowed: false, reason: "Loading usage data..." };
    }

    switch (action) {
      case "search": {
        const searchLimit = planFeatures.limits.monthlySearches;
        if (searchLimit === -1) return { allowed: true }; // unlimited
        
        const searchesRemaining = searchLimit - usage.searchesUsed;
        if (searchesRemaining <= 0) {
          return { 
            allowed: false, 
            reason: `Monthly search limit reached (${searchLimit})`,
            upgradeRequired: currentPlan === "starter" ? "professional" : 
                           currentPlan === "professional" ? "business" : "enterprise"
          };
        }
        return { allowed: true };
      }

      case "export": {
        const exportLimit = planFeatures.limits.monthlyExports;
        if (exportLimit === -1) return { allowed: true }; // unlimited
        
        const exportsRemaining = exportLimit - usage.exportsCompleted;
        if (exportsRemaining <= 0) {
          return { 
            allowed: false, 
            reason: `Monthly export limit reached (${exportLimit})`,
            upgradeRequired: currentPlan === "starter" ? "professional" : 
                           currentPlan === "professional" ? "business" : "enterprise"
          };
        }
        return { allowed: true };
      }

      case "bulk_operation": {
        if (!hasFeature("bulk_operations")) {
          return { 
            allowed: false, 
            reason: "Bulk operations not available on your plan",
            upgradeRequired: "professional"
          };
        }
        return { allowed: true };
      }

      default:
        return { allowed: false, reason: "Unknown action" };
    }
  };

  // Plan upgrade suggestions
  const getUpgradeSuggestion = (requiredFeature: FeatureKey): {
    suggestedPlan: PlanTier;
    reason: string;
  } => {
    const plans: PlanTier[] = ["professional", "business", "enterprise"];
    
    for (const plan of plans) {
      if (PLAN_FEATURES[plan].features.includes(requiredFeature)) {
        return {
          suggestedPlan: plan,
          reason: `Upgrade to ${plan.charAt(0).toUpperCase() + plan.slice(1)} to access this feature`
        };
      }
    }

    return {
      suggestedPlan: "professional",
      reason: "Upgrade required to access this feature"
    };
  };

  // Usage warnings
  const getUsageWarnings = (): Array<{
    type: "search" | "enrichment" | "export";
    percentage: number;
    message: string;
    severity: "warning" | "danger";
  }> => {
    if (!usage) return [];

    const warnings = [];
    const limits = planFeatures.limits;

    // Search warnings
    if (limits.monthlySearches > 0) {
      const searchPercentage = (usage.searchesUsed / limits.monthlySearches) * 100;
      if (searchPercentage >= 80) {
        warnings.push({
          type: "search" as const,
          percentage: searchPercentage,
          message: searchPercentage >= 95 
            ? `Critical: ${usage.searchesUsed}/${limits.monthlySearches} searches used`
            : `Warning: ${usage.searchesUsed}/${limits.monthlySearches} searches used`,
          severity: searchPercentage >= 95 ? "danger" as const : "warning" as const
        });
      }
    }

    // Enrichment warnings
    if (limits.monthlyEnrichments > 0) {
      const enrichmentPercentage = (usage.leadsEnriched / limits.monthlyEnrichments) * 100;
      if (enrichmentPercentage >= 80) {
        warnings.push({
          type: "enrichment" as const,
          percentage: enrichmentPercentage,
          message: enrichmentPercentage >= 95
            ? `Critical: ${usage.leadsEnriched.toLocaleString()}/${limits.monthlyEnrichments.toLocaleString()} enrichments used`
            : `Warning: ${usage.leadsEnriched.toLocaleString()}/${limits.monthlyEnrichments.toLocaleString()} enrichments used`,
          severity: enrichmentPercentage >= 95 ? "danger" as const : "warning" as const
        });
      }
    }

    // Export warnings
    if (limits.monthlyExports > 0) {
      const exportPercentage = (usage.exportsCompleted / limits.monthlyExports) * 100;
      if (exportPercentage >= 80) {
        warnings.push({
          type: "export" as const,
          percentage: exportPercentage,
          message: exportPercentage >= 95
            ? `Critical: ${usage.exportsCompleted}/${limits.monthlyExports} exports used`
            : `Warning: ${usage.exportsCompleted}/${limits.monthlyExports} exports used`,
          severity: exportPercentage >= 95 ? "danger" as const : "warning" as const
        });
      }
    }

    return warnings;
  };

  return {
    // Plan info
    currentPlan,
    planFeatures,
    isStarter,
    isProfessional, 
    isBusiness,
    isEnterprise,
    
    // Loading states
    isLoading: subscriptionLoading || usageLoading,
    
    // Feature checks
    hasFeature,
    canPerformAction,
    getUpgradeSuggestion,
    getUsageWarnings,
    
    // Quick access
    hasActiveSubscription: subscription?.hasActiveSubscription || false,
    canGenerateEmails: hasFeature("email_generation"),
    canUseBulkOperations: hasFeature("bulk_operations"),
    canUseAPI: hasFeature("api_access"),
    canUseAdvancedAnalytics: hasFeature("advanced_analytics"),
    canUseTeamCollaboration: hasFeature("team_collaboration"),
    canUseCustomIntegrations: hasFeature("custom_integrations"),
    canUseWhiteLabel: hasFeature("white_label"),
    hasDedicatedSupport: hasFeature("dedicated_support"),
  };
}