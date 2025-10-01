import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useCallback } from "react";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger("useStatusBroadcasts");

export type BroadcastPriority = "low" | "normal" | "high" | "urgent" | "critical";

export interface StatusBroadcast {
  _id: Id<"statusBroadcasts">;
  userId: Id<"users">;
  type: string;
  title: string;
  message: string;
  data?: unknown;
  priority: BroadcastPriority;
  tags: string[];
  status: "pending" | "delivered" | "failed";
  delivered: boolean;
  acknowledged: boolean;
  requiresAck: boolean;
  createdAt: number;
  expiresAt: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
  error?: string;
  read: boolean;
}

export function useStatusBroadcastsBase() {
  const broadcasts = useQuery(api.realtime.queries.getUserBroadcasts, {
    limit: 50,
    includeDelivered: true,
  });

  const urgentBroadcasts = useQuery(api.realtime.queries.getUrgentBroadcasts, {
    limit: 20,
  });

  const unreadCounts = useQuery(api.realtime.queries.getUnreadBroadcastCount);

  const acknowledgeAction = useMutation(
    api.realtime.mutations.acknowledgeBroadcast,
  );

  const markAsReadAction = useMutation(
    api.realtime.mutations.markBroadcastAsRead,
  );

  const acknowledgeBroadcast = useCallback(
    async (broadcastId: Id<"statusBroadcasts">) => {
      logger.info("Acknowledging broadcast", { broadcastId });
      return timeOperation("acknowledgeBroadcast", () =>
        acknowledgeAction({ broadcastId }),
      );
    },
    [acknowledgeAction],
  );

  const markAsRead = useCallback(
    async (broadcastId: Id<"statusBroadcasts">) => {
      logger.info("Marking broadcast as read", { broadcastId });
      return timeOperation("markBroadcastAsRead", () =>
        markAsReadAction({ broadcastId }),
      );
    },
    [markAsReadAction],
  );

  const getByType = useCallback(
    (type: string) => {
      return broadcasts?.filter((b) => b.type === type) || [];
    },
    [broadcasts],
  );

  const getByTags = useCallback(
    (tags: string[]) => {
      return broadcasts?.filter((b) =>
        tags.some((tag) => b.tags.includes(tag))
      ) || [];
    },
    [broadcasts],
  );

  const searchBroadcasts = getByType("pipeline_update");
  const creditBroadcasts = getByType("credit_update");
  const rateLimitWarnings = getByType("rate_limit_warning");
  const systemAlerts = getByType("system_alert");
  const latestStatus = broadcasts?.[0] ?? null;

  return {
    broadcasts: broadcasts || [],
    urgentBroadcasts: urgentBroadcasts || [],
    searchBroadcasts,
    creditBroadcasts,
    rateLimitWarnings,
    systemAlerts,
    getByType,
    getByTags,
    acknowledgeBroadcast,
    markAsRead,
    isLoading: broadcasts === undefined,
    hasUrgent: (urgentBroadcasts?.length || 0) > 0,
    needsAcknowledgment:
      broadcasts?.filter((b) => b.requiresAck && !b.acknowledged).length || 0,
    unreadCount: unreadCounts?.total || 0,
    urgentUnreadCount: unreadCounts?.urgent || 0,
    isConnected: true,
    latestStatus,
  };
}

export type UseStatusBroadcastsResult = ReturnType<typeof useStatusBroadcastsBase>;

export function useSearchBroadcastsBase(
  searchId: Id<"searches"> | undefined,
  statusBroadcasts: UseStatusBroadcastsResult,
) {
  const searchBroadcasts = useQuery(
    api.realtime.queries.getSearchBroadcasts,
    searchId ? { searchId, limit: 50 } : "skip",
  );

  const latestPipelineStatus = useQuery(
    api.realtime.queries.getSearchPipelineStatus,
    searchId ? { searchId } : "skip",
  );

  const sortedBroadcasts = (searchBroadcasts || []).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  const latestStatus = sortedBroadcasts[0] || latestPipelineStatus;

  const progressUpdates = sortedBroadcasts.filter(
    (b) => b.data && typeof b.data === "object" && "progress" in b.data,
  );

  return {
    broadcasts: sortedBroadcasts,
    latestStatus,
    progressUpdates,
    acknowledgeBroadcast: statusBroadcasts.acknowledgeBroadcast,
    markAsRead: statusBroadcasts.markAsRead,
    hasUpdates: sortedBroadcasts.length > 0,
    isLoading: searchId ? searchBroadcasts === undefined : false,
    currentProgress:
      latestStatus?.data &&
      typeof latestStatus.data === "object" &&
      "progress" in latestStatus.data
        ? (latestStatus.data.progress as number) || 0
        : 0,
    currentStage:
      latestStatus?.data &&
      typeof latestStatus.data === "object" &&
      "stage" in latestStatus.data
        ? (latestStatus.data.stage as string) || "pending"
        : "pending",
  };
}

export type UseSearchBroadcastsResult = ReturnType<typeof useSearchBroadcastsBase>;

export function useBatchBroadcastsBase(
  batchPlanId: string | undefined,
  statusBroadcasts: UseStatusBroadcastsResult,
) {
  const broadcasts = useQuery(api.realtime.queries.getBroadcastsByType, {
    type: "batch_progress",
    limit: 50,
  });

  const batchBroadcasts = (broadcasts || []).filter(
    (b) =>
      b.data &&
      typeof b.data === "object" &&
      "batchPlanId" in b.data &&
      (b.data as Record<string, unknown>).batchPlanId === batchPlanId,
  );

  const latestProgress = batchBroadcasts.sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0];

  const getDataField = <T>(data: unknown, field: string): T | undefined => {
    if (
      data &&
      typeof data === "object" &&
      field in (data as Record<string, unknown>)
    ) {
      return (data as Record<string, unknown>)[field] as T;
    }
    return undefined;
  };

  return {
    broadcasts: batchBroadcasts,
    latestProgress,
    acknowledgeBroadcast: statusBroadcasts.acknowledgeBroadcast,
    hasProgress: batchBroadcasts.length > 0,
    completedBatches: getDataField(latestProgress?.data, "completedBatches") || 0,
    totalBatches: getDataField(latestProgress?.data, "totalBatches") || 0,
    progressPercent: getDataField(latestProgress?.data, "progressPercent") || 0,
    isLoading: broadcasts === undefined,
  };
}

export type UseBatchBroadcastsResult = ReturnType<typeof useBatchBroadcastsBase>;

export function useCreditBroadcastsBase(
  statusBroadcasts: UseStatusBroadcastsResult,
) {
  const creditBroadcasts = useQuery(api.realtime.queries.getCreditBroadcasts, {
    limit: 30,
  });

  const hasLowCredits = (data: unknown): data is { isLowCredits?: boolean } =>
    typeof data === "object" &&
    data !== null &&
    "isLowCredits" in (data as Record<string, unknown>);

  const lowCreditWarnings = (creditBroadcasts || []).filter((b) => {
    const data = b.data;
    const isLow = hasLowCredits(data) && Boolean(data.isLowCredits);
    const isHighPriority =
      b.priority === "high" ||
      b.priority === "urgent" ||
      b.priority === "critical";
    return isLow || isHighPriority;
  });

  const latestCreditUpdate = (creditBroadcasts || []).sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0];

  return {
    broadcasts: creditBroadcasts || [],
    lowCreditWarnings,
    latestCreditUpdate,
    acknowledgeBroadcast: statusBroadcasts.acknowledgeBroadcast,
    hasLowCredits: lowCreditWarnings.length > 0,
    currentBalance:
      latestCreditUpdate?.data &&
      typeof latestCreditUpdate.data === "object" &&
      "newBalance" in latestCreditUpdate.data
        ? (latestCreditUpdate.data as Record<string, unknown>).newBalance as number
        : undefined,
    isLoading: creditBroadcasts === undefined,
  };
}

export type UseCreditBroadcastsResult = ReturnType<typeof useCreditBroadcastsBase>;
