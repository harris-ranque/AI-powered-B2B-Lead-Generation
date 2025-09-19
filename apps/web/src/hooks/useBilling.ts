import { useMutation, useAction, useQuery } from "convex/react";
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

  const purchaseCredits = useAction(api.billing.mutations.purchaseCredits);
  const createCheckoutSession = useAction(
    api.billing.mutations.createCheckoutSession,
  );
  const cancelSubscription = useAction(api.billing.mutations.cancelSubscription);

  return {
    billing,
    usage,
    transactions,
    purchaseCredits,
    createCheckoutSession,
    cancelSubscription,
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
