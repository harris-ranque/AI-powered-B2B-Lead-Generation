import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";
import { convex } from "@/lib/convex";

export function useUsage() {
  const { isSignedIn } = useAuth();

  const { data: usage, isLoading } = useQuery({
    queryKey: ["current-usage"],
    queryFn: async () => {
      const result = await convex.query(
        "usageTracking/queries:getCurrentUsage",
        {},
      );
      return result;
    },
    enabled: !!isSignedIn,
    refetchInterval: 30 * 1000, // Refresh every 30 seconds
  });

  // Calculate percentage used with safety checks
  const getUsagePercentage = (used: number, limit: number) => {
    if (limit === -1) return 0; // Unlimited
    if (limit === 0) return 100; // No allowance
    return Math.min(100, Math.round((used / limit) * 100));
  };

  // Get usage status color
  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return "text-red-600";
    if (percentage >= 75) return "text-orange-600";
    if (percentage >= 50) return "text-yellow-600";
    return "text-green-600";
  };

  // Get progress bar color
  const getProgressColor = (percentage: number) => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 75) return "bg-orange-500";
    if (percentage >= 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  const searchesPercentage = usage
    ? getUsagePercentage(usage.searchesUsed, usage.limits.monthlySearches)
    : 0;
  const enrichmentsPercentage = usage
    ? getUsagePercentage(usage.leadsEnriched, usage.limits.monthlyEnrichments)
    : 0;
  const exportsPercentage = usage
    ? getUsagePercentage(usage.exportsCompleted, usage.limits.monthlyExports)
    : 0;

  return {
    usage,
    isLoading,
    searchesPercentage,
    enrichmentsPercentage,
    exportsPercentage,
    getUsageColor,
    getProgressColor,
    getUsagePercentage,
    // Helper methods for quick checks
    isNearLimit: (percentage: number) => percentage >= 80,
    isOverLimit: (percentage: number) => percentage >= 100,
    hasUnlimitedSearches: usage?.limits.monthlySearches === -1,
    hasUnlimitedEnrichments: usage?.limits.monthlyEnrichments === -1,
    hasUnlimitedExports: usage?.limits.monthlyExports === -1,
  };
}
