import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@genni/convex-types";

export function useBilling() {
  const billing = useQuery(api.billing.queries.getUserBilling);
  const usage = useQuery(api.billing.queries.getUsageStats);
  const transactions = useQuery(api.billing.queries.getCreditTransactions);
  // Note: Public catalog data (credit packs, plan catalog) is provided via
  // the cached `/api/public/config` endpoint and `useRuntimeConfig`.
  // We intentionally avoid subscribing to those Convex queries here to
  // prevent redundant live queries that spam the Convex logs.

  const updatePlan = useMutation(api.billing.mutations.updateSubscription);
  const purchaseCredits = useAction(api.billing.mutations.purchaseCredits);
  const createCheckoutSession = useAction(
    api.billing.mutations.createCheckoutSession,
  );

  return {
    billing,
    usage,
    transactions,
    updatePlan,
    purchaseCredits,
    createCheckoutSession,
    isLoading: billing === undefined,
  };
}

export function useCredits() {
  const balance = useQuery(api.billing.queries.getCreditBalance);
  const transactions = useQuery(api.billing.queries.getCreditTransactions);

  return {
    balance,
    transactions,
    isLoading: balance === undefined,
  };
}
