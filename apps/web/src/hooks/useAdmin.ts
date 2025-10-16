import { useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { createLogger } from "@/utils/logger";

const adminLogger = createLogger("useAdmin");

const serializeArgs = (input: unknown) => {
  if (input === undefined || input === null) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(input));
  } catch (error) {
    const serializationError =
      error instanceof Error ? error : new Error(String(error));
    adminLogger.error(
      "Failed to serialize mutation arguments",
      {
        error: serializationError.message,
      },
      serializationError,
    );
    return { __nonSerializable: true };
  }
};

const useSafeAdminMutation = <Args extends unknown[], Result>(
  mutation: (...args: Args) => Promise<Result>,
  action: string,
) => {
  return useCallback(
    async (...args: Args): Promise<Result> => {
      try {
        return await mutation(...args);
      } catch (error) {
        const errorInstance =
          error instanceof Error ? error : new Error(String(error));
        adminLogger.error(
          `Admin mutation failed: ${action}`,
          {
            action,
            payload: serializeArgs(args[0]),
          },
          errorInstance,
        );
        throw errorInstance;
      }
    },
    [mutation, action],
  );
};

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
  const usersResp = useQuery(api.admin.queries.getAllUsers);
  const updateUserStatus = useSafeAdminMutation(
    useMutation(api.admin.mutations.updateUserStatus),
    "updateUserStatus",
  );
  const updateUserPlan = useSafeAdminMutation(
    useMutation(api.admin.mutations.updateUserPlan),
    "updateUserPlan",
  );
  const addUserCredits = useSafeAdminMutation(
    useMutation(api.admin.mutations.addUserCredits),
    "addUserCredits",
  );
  const exportUsers = useSafeAdminMutation(
    useMutation(api.admin.mutations.exportUsers),
    "exportUsers",
  );
  const pauseUserProcessing = useSafeAdminMutation(
    useMutation(api.users.admin.pauseUserProcessing),
    "pauseUserProcessing",
  );
  const resumeUserProcessing = useSafeAdminMutation(
    useMutation(api.users.admin.resumeUserProcessing),
    "resumeUserProcessing",
  );

  return {
    users: usersResp?.users ?? [],
    totalUsers: usersResp?.total ?? 0,
    hasMore: usersResp?.hasMore ?? false,
    updateUserStatus,
    updateUserPlan,
    addUserCredits,
    exportUsers,
    pauseUserProcessing,
    resumeUserProcessing,
    isLoading: usersResp === undefined,
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
  const updateSettings = useSafeAdminMutation(
    useMutation(api.admin.mutations.updateAdminSettings),
    "updateAdminSettings",
  );
  const resetSystemCache = useSafeAdminMutation(
    useMutation(api.admin.mutations.resetSystemCache),
    "resetSystemCache",
  );
  const runSystemMaintenance = useSafeAdminMutation(
    useMutation(api.admin.mutations.runSystemMaintenance),
    "runSystemMaintenance",
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
  const updateCreditCosts = useSafeAdminMutation(
    useMutation(api.admin.mutations.updateCreditCosts),
    "updateCreditCosts",
  );
  const updatePlanLimits = useSafeAdminMutation(
    useMutation(api.admin.mutations.updatePlanLimits),
    "updatePlanLimits",
  );
  const updateCreditPacks = useSafeAdminMutation(
    useMutation(api.users.admin.updateCreditPacks),
    "updateCreditPacks",
  );
  const listPlanConfigurations = useQuery(
    api.users.admin.listPlanConfigurations,
  );
  const upsertPlanConfiguration = useSafeAdminMutation(
    useMutation(api.users.admin.upsertPlanConfiguration),
    "upsertPlanConfiguration",
  );

  return {
    configuration,
    updateCreditCosts,
    updatePlanLimits,
    updateCreditPacks,
    listPlanConfigurations,
    upsertPlanConfiguration,
    isLoading: configuration === undefined,
  };
}

export function useAdminSystemControl() {
  const systemStatus = useQuery(api.admin.queries.getSystemControlStatus);
  const systemActivity = useQuery(api.admin.queries.getSystemActivity);
  const systemConfiguration = useQuery(api.admin.queries.getSystemConfiguration);
  // Use functions from admin/systemControl module (correct paths)
  const pauseAllLeadGeneration = useSafeAdminMutation(
    useMutation(api.admin.systemControl.pauseAllLeadGeneration),
    "pauseAllLeadGeneration",
  );
  const resumeAllLeadGeneration = useSafeAdminMutation(
    useMutation(api.admin.systemControl.resumeAllLeadGeneration),
    "resumeAllLeadGeneration",
  );
  const clearAllActiveSearches = useSafeAdminMutation(
    useMutation(api.admin.systemControl.clearAllActiveSearches),
    "clearAllActiveSearches",
  );
  const triggerLangGraphHealthCheck = useSafeAdminMutation(
    useMutation(api.admin.systemControl.triggerLangGraphHealthCheck),
    "triggerLangGraphHealthCheck",
  );

  return {
    systemStatus,
    systemActivity,
    systemConfiguration,
    pauseAllLeadGeneration,
    resumeAllLeadGeneration,
    clearAllActiveSearches,
    triggerLangGraphHealthCheck,
    isLoading: systemStatus === undefined || systemActivity === undefined,
  };
}
