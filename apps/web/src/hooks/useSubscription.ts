import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";

export function useSubscription() {
  // Use Convex native reactive queries - real-time updates without polling!
  const subscription = useQuery(api.billing.queries.getSubscriptionStatus);

  const planDisplayNames = {
    starter: "Starter",
    professional: "Professional",
    business: "Business",
    enterprise: "Enterprise",
  };

  const planName = subscription?.plan
    ? planDisplayNames[subscription.plan as keyof typeof planDisplayNames]
    : "Loading...";

  const getStatusBadge = (status: string, isTrialing: boolean) => {
    if (isTrialing) {
      return {
        text: "Trial",
        variant: "default" as const,
        className: "bg-blue-500",
      };
    }

    switch (status) {
      case "active":
        return {
          text: "Active",
          variant: "default" as const,
          className: "bg-green-500",
        };
      case "past_due":
        return {
          text: "Past Due",
          variant: "destructive" as const,
          className: "",
        };
      case "cancelled":
        return {
          text: "Cancelled",
          variant: "secondary" as const,
          className: "",
        };
      default:
        return { text: status, variant: "outline" as const, className: "" };
    }
  };

  return {
    subscription,
    isLoading: subscription === undefined,
    planName,
    getStatusBadge,
    hasActiveSubscription: subscription?.hasActiveSubscription || false,
    isTrialing: subscription?.isTrialing || false,
    isStarter: subscription?.plan === "starter",
    isProfessional: subscription?.plan === "professional",
    isBusiness: subscription?.plan === "business",
    isEnterprise: subscription?.plan === "enterprise",
  };
}
