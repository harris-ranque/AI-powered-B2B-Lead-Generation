import { useAction, useQuery } from "convex/react";
import { api } from "@genni/convex-types";

export function useBilling() {
  // Use Convex native reactive queries - real-time updates without polling!
  const billing = useQuery(api.billing.queries.getUserBilling);
  const usage = useQuery(api.billing.queries.getUsageStats);
  const transactions = useQuery(api.billing.queries.getCreditTransactions);
  // Note: Public catalog data (credit packs, plan catalog) is provided via
  // the cached `/api/public/config` endpoint and `useRuntimeConfig`.
  // We intentionally avoid subscribing to those Convex queries here to
  // prevent redundant live queries that spam the Convex logs.

  // FastSpring-based actions
  const cancelSubscription = useAction(api.billing.mutations.cancelSubscription);
  const reactivateSubscription = useAction(api.billing.mutations.reactivateSubscription);
  const getBillingPortalUrl = useAction(api.billing.mutations.getBillingPortalUrl);
  const getSubscriptionDetails = useAction(api.billing.mutations.getSubscriptionDetails);

  // For checkout, use the useFastSpring hook instead which handles the popup flow
  // These are available for direct API calls if needed
  const createSubscriptionCheckout = useAction(api.billing.mutations.createSubscriptionCheckout);
  const createCreditsCheckout = useAction(api.billing.mutations.createCreditsCheckout);

  return {
    billing,
    usage,
    transactions,
    cancelSubscription,
    reactivateSubscription,
    getBillingPortalUrl,
    getSubscriptionDetails,
    createSubscriptionCheckout,
    createCreditsCheckout,
    isLoading: billing === undefined,
  };
}

export function useCredits() {
  // Use Convex native reactive queries - real-time updates without polling!
  const balance = useQuery(api.billing.queries.getCreditBalance);
  const transactions = useQuery(api.billing.queries.getCreditTransactions);

  return {
    balance,
    transactions,
    isLoading: balance === undefined,
  };
}
