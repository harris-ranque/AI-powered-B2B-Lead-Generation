import { Doc } from "../_generated/dataModel";
import { DatabaseReader, DatabaseWriter } from "../_generated/server";
import { UserIdentity } from "convex/server";

export type PlanTier = "starter" | "professional" | "business" | "enterprise";

interface PlanLimits {
  monthlySearches: number;
  maxLeadsPerSearch: number;
  monthlyEnrichments: number;
  monthlyExports: number;
  emailGeneration: boolean;
  bulkOperations: boolean;
  apiAccess: boolean;
  requiresOwnApiKeys: boolean;
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: {
    monthlySearches: 10,
    maxLeadsPerSearch: 25,
    monthlyEnrichments: 500,
    monthlyExports: 10,
    emailGeneration: false,
    bulkOperations: false,
    apiAccess: false,
    requiresOwnApiKeys: false, // Changed: Starter gets managed API keys now
  },
  professional: {
    monthlySearches: 50,
    maxLeadsPerSearch: 500,
    monthlyEnrichments: 25000,
    monthlyExports: 100,
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
    requiresOwnApiKeys: false,
  },
  business: {
    monthlySearches: 200,
    maxLeadsPerSearch: 2000,
    monthlyEnrichments: 100000,
    monthlyExports: 500,
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
    requiresOwnApiKeys: false,
  },
  enterprise: {
    monthlySearches: -1, // unlimited
    maxLeadsPerSearch: -1, // unlimited
    monthlyEnrichments: -1, // unlimited
    monthlyExports: -1, // unlimited
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
    requiresOwnApiKeys: true, // BYOK: Enterprise users must provide own API keys
  },
};

// Subscription middleware for enforcing plan limits and features
export class SubscriptionMiddleware {
  constructor(
    private db: DatabaseReader | DatabaseWriter,
    private user: Doc<"users">,
  ) {}

  // Get current plan limits
  getPlanLimits(): PlanLimits {
    return PLAN_LIMITS[this.user.plan as PlanTier] || PLAN_LIMITS.starter;
  }

  // Check if user has access to a feature
  hasFeature(
    feature: keyof Omit<
      PlanLimits,
      | "monthlySearches"
      | "maxLeadsPerSearch"
      | "monthlyEnrichments"
      | "monthlyExports"
    >,
  ): boolean {
    const limits = this.getPlanLimits();
    return limits[feature];
  }

  // Check usage limits and enforce restrictions
  async checkUsageLimit(
    operation: "search" | "enrichment" | "export",
    count: number = 1,
  ): Promise<{
    allowed: boolean;
    reason?: string;
    remaining?: number;
    limit?: number;
  }> {
    const limits = this.getPlanLimits();

    // Get current usage
    const usage = await this.db
      .query("usageTracking")
      .filter((q) => q.eq(q.field("userId"), this.user._id))
      .filter((q) => q.eq(q.field("isCurrentPeriod"), true))
      .unique();

    const currentUsage = {
      searchesUsed: usage?.searchesUsed || 0,
      leadsEnriched: usage?.leadsEnriched || 0,
      exportsCompleted: usage?.exportsCompleted || 0,
    };

    switch (operation) {
      case "search":
        if (limits.monthlySearches === -1) {
          return { allowed: true, remaining: -1, limit: -1 };
        }
        const searchesRemaining =
          limits.monthlySearches - currentUsage.searchesUsed;
        return {
          allowed: searchesRemaining >= count,
          remaining: searchesRemaining,
          limit: limits.monthlySearches,
          reason:
            searchesRemaining < count
              ? `Monthly search limit exceeded. Used ${currentUsage.searchesUsed}/${limits.monthlySearches}`
              : undefined,
        };

      case "enrichment":
        if (limits.monthlyEnrichments === -1) {
          return { allowed: true, remaining: -1, limit: -1 };
        }
        const enrichmentsRemaining =
          limits.monthlyEnrichments - currentUsage.leadsEnriched;
        return {
          allowed: enrichmentsRemaining >= count,
          remaining: enrichmentsRemaining,
          limit: limits.monthlyEnrichments,
          reason:
            enrichmentsRemaining < count
              ? `Monthly enrichment limit exceeded. Used ${currentUsage.leadsEnriched}/${limits.monthlyEnrichments}`
              : undefined,
        };

      case "export":
        if (limits.monthlyExports === -1) {
          return { allowed: true, remaining: -1, limit: -1 };
        }
        const exportsRemaining =
          limits.monthlyExports - currentUsage.exportsCompleted;
        return {
          allowed: exportsRemaining >= count,
          remaining: exportsRemaining,
          limit: limits.monthlyExports,
          reason:
            exportsRemaining < count
              ? `Monthly export limit exceeded. Used ${currentUsage.exportsCompleted}/${limits.monthlyExports}`
              : undefined,
        };

      default:
        return { allowed: false, reason: "Unknown operation" };
    }
  }

  // Enforce feature access
  async enforceFeatureAccess(
    feature: keyof Omit<
      PlanLimits,
      | "monthlySearches"
      | "maxLeadsPerSearch"
      | "monthlyEnrichments"
      | "monthlyExports"
    >,
  ): Promise<void> {
    if (!this.hasFeature(feature)) {
      const currentPlan = this.user.plan;
      throw new Error(
        `Feature '${feature}' is not available on the ${currentPlan} plan. Please upgrade your subscription.`,
      );
    }
  }

  // Enforce usage limits
  async enforceUsageLimit(
    operation: "search" | "enrichment" | "export",
    count: number = 1,
  ): Promise<void> {
    const result = await this.checkUsageLimit(operation, count);
    if (!result.allowed) {
      throw new Error(result.reason || `Usage limit exceeded for ${operation}`);
    }
  }

  // Get upgrade suggestions
  getUpgradeSuggestion(requiredFeature?: string): {
    suggestedPlan: PlanTier;
    benefits: string[];
  } {
    const currentPlan = this.user.plan as PlanTier;

    const planOrder: PlanTier[] = [
      "starter",
      "professional",
      "business",
      "enterprise",
    ];
    const currentIndex = planOrder.indexOf(currentPlan);

    if (currentIndex < planOrder.length - 1) {
      const nextPlan = planOrder[currentIndex + 1];
      if (!nextPlan)
        return { suggestedPlan: "enterprise" as PlanTier, benefits: [] };
      const nextLimits = PLAN_LIMITS[nextPlan];

      const benefits = [];

      if (currentPlan === "starter") {
        benefits.push("Email generation");
        benefits.push("Bulk operations");
        benefits.push("API access");
        benefits.push(`${nextLimits.monthlySearches} searches/month`);
      } else if (currentPlan === "professional") {
        benefits.push("Team collaboration");
        benefits.push("Custom integrations");
        benefits.push(`${nextLimits.monthlySearches} searches/month`);
        benefits.push(
          `${nextLimits.monthlyEnrichments.toLocaleString()} enrichments/month`,
        );
      } else if (currentPlan === "business") {
        benefits.push("Unlimited usage");
        benefits.push("White-label options");
        benefits.push("Dedicated support");
        benefits.push("Custom API keys (optional)");
      }

      return { suggestedPlan: nextPlan, benefits };
    }

    return {
      suggestedPlan: "enterprise",
      benefits: ["Maximum features and limits"],
    };
  }

  // Check if user can perform bulk operations
  canPerformBulkOperations(): boolean {
    return this.hasFeature("bulkOperations");
  }

  // Check if user can generate emails
  canGenerateEmails(): boolean {
    return this.hasFeature("emailGeneration");
  }

  // Check if user has API access
  hasApiAccess(): boolean {
    return this.hasFeature("apiAccess");
  }

  // Get max leads per search for current plan
  getMaxLeadsPerSearch(): number {
    return this.getPlanLimits().maxLeadsPerSearch;
  }

  // Validate search parameters against plan limits
  validateSearchParameters(maxLeads: number): {
    valid: boolean;
    adjustedMaxLeads?: number;
    reason?: string;
  } {
    const limits = this.getPlanLimits();

    if (limits.maxLeadsPerSearch === -1) {
      return { valid: true }; // unlimited
    }

    if (maxLeads <= limits.maxLeadsPerSearch) {
      return { valid: true };
    }

    return {
      valid: false,
      adjustedMaxLeads: limits.maxLeadsPerSearch,
      reason: `Maximum leads per search for ${this.user.plan} plan is ${limits.maxLeadsPerSearch}. Requested: ${maxLeads}`,
    };
  }
}

// Helper function to create middleware instance
export async function createSubscriptionMiddleware(
  db: DatabaseReader | DatabaseWriter,
  identity: UserIdentity,
): Promise<SubscriptionMiddleware> {
  const user = await db
    .query("users")
    .filter((q) => q.eq(q.field("email"), identity.email))
    .unique();

  if (!user) {
    throw new Error("User not found");
  }

  return new SubscriptionMiddleware(db, user);
}

// Helper function for mutations/actions
export async function withSubscriptionCheck<T>(
  db: DatabaseReader | DatabaseWriter,
  identity: UserIdentity,
  operation:
    | "search"
    | "enrichment"
    | "export"
    | "email_generation"
    | "bulk_operation",
  count: number = 1,
  callback: (middleware: SubscriptionMiddleware) => Promise<T>,
): Promise<T> {
  const middleware = await createSubscriptionMiddleware(db, identity);

  // Check feature access
  if (operation === "email_generation") {
    await middleware.enforceFeatureAccess("emailGeneration");
  } else if (operation === "bulk_operation") {
    await middleware.enforceFeatureAccess("bulkOperations");
  }

  // Check usage limits
  if (
    operation === "search" ||
    operation === "enrichment" ||
    operation === "export"
  ) {
    await middleware.enforceUsageLimit(operation, count);
  }

  return callback(middleware);
}
