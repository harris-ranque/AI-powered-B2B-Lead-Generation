import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { convex } from "@/lib/convex";

export function useSubscription() {
  const { isSignedIn } = useAuth();

  const { data: subscription, isLoading } = useQuery({
    queryKey: ["subscription-status"],
    queryFn: async () => {
      const result = await convex.mutation(
        "billing/mutations:getSubscriptionStatus",
        {},
      );
      return result;
    },
    enabled: !!isSignedIn,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

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
    isLoading,
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
