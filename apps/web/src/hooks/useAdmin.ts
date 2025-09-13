import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";

export function useAdminDashboard() {
  const metrics = useQuery(api.admin.queries.getAdminMetrics);
  const systemHealth = useQuery(api.admin.queries.getSystemHealth);

  return {
    metrics,
    systemHealth,
    isLoading: metrics === undefined,
  };
}

export function useAdminUsers() {
  const users = useQuery(api.admin.queries.getAllUsers);
  const updateUserStatus = useMutation(api.admin.mutations.updateUserStatus);
  const updateUserPlan = useMutation(api.admin.mutations.updateUserPlan);
  const addUserCredits = useMutation(api.admin.mutations.addUserCredits);
  const exportUsers = useMutation(api.admin.mutations.exportUsers);

  return {
    users,
    updateUserStatus,
    updateUserPlan,
    addUserCredits,
    exportUsers,
    isLoading: users === undefined,
  };
}

export function useAdminAnalytics() {
  const analytics = useQuery(api.admin.queries.getAnalytics);
  const revenueStats = useQuery(api.admin.queries.getRevenueStats);
  const usageStats = useQuery(api.admin.queries.getUsageStats);

  return {
    analytics,
    revenueStats,
    usageStats,
    isLoading: analytics === undefined,
  };
}

export function useAdminSettings() {
  const settings = useQuery(api.admin.queries.getAdminSettings);
  const updateSettings = useMutation(api.admin.mutations.updateAdminSettings);
  const resetSystemCache = useMutation(api.admin.mutations.resetSystemCache);
  const runSystemMaintenance = useMutation(
    api.admin.mutations.runSystemMaintenance,
  );

  return {
    settings,
    updateSettings,
    resetSystemCache,
    runSystemMaintenance,
    isLoading: settings === undefined,
  };
}

export function useAdminConfiguration() {
  const configuration = useQuery(api.admin.queries.getSystemConfiguration);
  const updateCreditCosts = useMutation(api.admin.mutations.updateCreditCosts);
  const updatePlanLimits = useMutation(api.admin.mutations.updatePlanLimits);

  return {
    configuration,
    updateCreditCosts,
    updatePlanLimits,
    isLoading: configuration === undefined,
  };
}

export function useAdminSystemControl() {
  const systemStatus = useQuery(api.admin.queries.getSystemControlStatus);
  const systemActivity = useQuery(api.admin.queries.getSystemActivity);
  const pauseAllLeadGeneration = useMutation(
    api.admin.mutations.pauseAllLeadGeneration,
  );
  const resumeAllLeadGeneration = useMutation(
    api.admin.mutations.resumeAllLeadGeneration,
  );
  const clearAllActiveSearches = useMutation(
    api.admin.mutations.clearAllActiveSearches,
  );

  return {
    systemStatus,
    systemActivity,
    pauseAllLeadGeneration,
    resumeAllLeadGeneration,
    clearAllActiveSearches,
    isLoading: systemStatus === undefined || systemActivity === undefined,
  };
}
