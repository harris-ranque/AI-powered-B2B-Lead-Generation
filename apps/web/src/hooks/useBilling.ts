import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useBilling() {
  const billing = useQuery(api.billing.queries.getUserBilling);
  const usage = useQuery(api.billing.queries.getUsageStats);
  const transactions = useQuery(api.billing.queries.getCreditTransactions);
  
  const updatePlan = useMutation(api.billing.mutations.updatePlan);
  const purchaseCredits = useMutation(api.billing.mutations.purchaseCredits);
  const createCheckoutSession = useAction(api.billing.actions.createCheckoutSession);
  
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