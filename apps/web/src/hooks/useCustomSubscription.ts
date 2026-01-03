import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";

export function useCustomSubscription() {
  const data = useQuery(api.billing.queries.getCustomSubscriptionDashboard);

  // Helper to format price in dollars
  const formatPrice = (cents: number | undefined) => {
    if (!cents) return "$0";
    return `$${(cents / 100).toLocaleString()}`;
  };

  // Helper to get payment method display name
  const getPaymentMethodName = (type?: "card" | "us_bank_account") => {
    if (type === "us_bank_account") return "ACH Bank Transfer";
    if (type === "card") return "Credit Card";
    return "Unknown";
  };

  // Get status badge config
  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "active":
        return {
          text: "Active",
          variant: "default" as const,
          className: "bg-green-500",
        };
      case "pending_checkout":
        return {
          text: "Pending",
          variant: "secondary" as const,
          className: "bg-yellow-500",
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
      case "paused":
        return {
          text: "Paused",
          variant: "secondary" as const,
          className: "",
        };
      default:
        return { text: status || "Unknown", variant: "outline" as const, className: "" };
    }
  };

  // Get progress bar color based on usage percentage
  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 75) return "bg-orange-500";
    if (percentage >= 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  // Get text color based on usage percentage
  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return "text-red-600";
    if (percentage >= 75) return "text-orange-600";
    if (percentage >= 50) return "text-yellow-600";
    return "text-green-600";
  };

  return {
    data,
    isLoading: data === undefined,
    hasCustomSubscription: data?.hasCustomSubscription ?? false,
    subscription: data?.subscription ?? null,
    currentAllocation: data?.currentAllocation ?? null,
    creditUsagePercent: data?.creditUsagePercent ?? 0,
    // Helper methods
    formatPrice,
    getPaymentMethodName,
    getStatusBadge,
    getProgressColor,
    getUsageColor,
    // Quick access
    isActive: data?.subscription?.status === "active",
    isPastDue: data?.subscription?.status === "past_due",
    isPending: data?.subscription?.status === "pending_checkout",
  };
}
