import { useMutation, useAction } from "convex/react";
import { api } from "@genni/convex-types";
import { useConvexPolling } from "./useConvexPolling";

export function useBilling() {
  // Poll instead of realtime subscriptions to reduce WS pressure
  const { data: billing, isLoading: loadingBilling } = useConvexPolling(
    api.billing.queries.getUserBilling,
    undefined,
    { intervalMs: 4000 },
  );
  const { data: usage } = useConvexPolling(
    api.billing.queries.getUsageStats,
    undefined,
    { intervalMs: 5000 },
  );
  const { data: transactions } = useConvexPolling(
    api.billing.queries.getCreditTransactions,
    undefined,
    { intervalMs: 6000 },
  );
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
    isLoading: billing === undefined || loadingBilling,
  };
}

export function useCredits() {
  const { data: balance, isLoading: loadingBalance } = useConvexPolling(
    api.billing.queries.getCreditBalance,
    undefined,
    { intervalMs: 4000 },
  );
  const { data: transactions } = useConvexPolling(
    api.billing.queries.getCreditTransactions,
    undefined,
    { intervalMs: 6000 },
  );

  return {
    balance,
    transactions,
    isLoading: balance === undefined || loadingBalance,
  };
}
