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

/**
 * Hook for managing real-time status broadcasts using Convex's native subscriptions
 * Replaces the SSE implementation with proper Convex real-time queries
 */
export function useStatusBroadcasts() {
  // Use Convex queries for real-time updates
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

  // Filter broadcasts by type
  const getByType = useCallback(
    (type: string) => {
      return broadcasts?.filter((b) => b.type === type) || [];
    },
    [broadcasts],
  );

  // Filter broadcasts by tags
  const getByTags = useCallback(
    (tags: string[]) => {
      return broadcasts?.filter((b) => 
        tags.some((tag) => b.tags.includes(tag))
      ) || [];
    },
    [broadcasts],
  );

  // Get search-related broadcasts
  const searchBroadcasts = getByType("pipeline_update");

  // Get credit-related broadcasts
  const creditBroadcasts = getByType("credit_update");

  // Get rate limit warnings
  const rateLimitWarnings = getByType("rate_limit_warning");

  // Get system alerts
  const systemAlerts = getByType("system_alert");

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
    needsAcknowledgment: broadcasts?.filter(b => b.requiresAck && !b.acknowledged).length || 0,
    unreadCount: unreadCounts?.total || 0,
    urgentUnreadCount: unreadCounts?.urgent || 0,

    // Real-time connection is always "connected" with Convex
    isConnected: true,
  };
}

/**
 * Hook for broadcasts related to a specific search using Convex queries
 */
export function useSearchBroadcasts(searchId?: Id<"searches">) {
  const searchBroadcasts = useQuery(
    api.realtime.queries.getSearchBroadcasts,
    searchId ? { searchId, limit: 50 } : "skip",
  );

  const latestPipelineStatus = useQuery(
    api.realtime.queries.getSearchPipelineStatus,
    searchId ? { searchId } : "skip",
  );

  const { acknowledgeBroadcast, markAsRead } = useStatusBroadcasts();

  // Sort by creation time (newest first)
  const sortedBroadcasts = (searchBroadcasts || []).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  // Get latest status update
  const latestStatus = sortedBroadcasts[0] || latestPipelineStatus;

  // Get progress updates
  const progressUpdates = sortedBroadcasts.filter(
    (b) => b.data && typeof b.data === 'object' && 'progress' in b.data,
  );

  return {
    broadcasts: sortedBroadcasts,
    latestStatus,
    progressUpdates,
    acknowledgeBroadcast,
    markAsRead,
    hasUpdates: sortedBroadcasts.length > 0,
    isLoading: searchId ? searchBroadcasts === undefined : false,

    // Extract current progress and stage from latest status
    currentProgress: latestStatus?.data && typeof latestStatus.data === 'object' && 'progress' in latestStatus.data
      ? (latestStatus.data.progress as number) || 0
      : 0,
    currentStage: latestStatus?.data && typeof latestStatus.data === 'object' && 'stage' in latestStatus.data
      ? (latestStatus.data.stage as string) || "pending"
      : "pending",
  };
}

/**
 * Hook for batch processing broadcasts
 */
export function useBatchBroadcasts(batchPlanId?: string) {
  const broadcasts = useQuery(api.realtime.queries.getBroadcastsByType, {
    type: "batch_progress",
    limit: 50,
  });

  const { acknowledgeBroadcast } = useStatusBroadcasts();

  const batchBroadcasts = (broadcasts || []).filter(
    (b) => b.data && typeof b.data === 'object' && 'batchPlanId' in b.data && b.data.batchPlanId === batchPlanId,
  );

  // Get latest batch progress
  const latestProgress = batchBroadcasts.sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0];

  const getDataField = <T>(data: unknown, field: string): T | undefined => {
    if (data && typeof data === "object" && field in (data as Record<string, unknown>)) {
      return (data as Record<string, unknown>)[field] as T;
    }
    return undefined;
  };

  return {
    broadcasts: batchBroadcasts,
    latestProgress,
    acknowledgeBroadcast,
    hasProgress: batchBroadcasts.length > 0,
    completedBatches: getDataField(latestProgress?.data, 'completedBatches') || 0,
    totalBatches: getDataField(latestProgress?.data, 'totalBatches') || 0,
    progressPercent: getDataField(latestProgress?.data, 'progressPercent') || 0,
    isLoading: broadcasts === undefined,
  };
}

/**
 * Hook for credit and billing broadcasts
 */
export function useCreditBroadcasts() {
  const creditBroadcasts = useQuery(api.realtime.queries.getCreditBroadcasts, {
    limit: 30,
  });

  const { acknowledgeBroadcast } = useStatusBroadcasts();

  // Filter for low credit warnings
  const hasLowCredits = (data: unknown): data is { isLowCredits?: boolean } =>
    typeof data === "object" && data !== null && "isLowCredits" in (data as Record<string, unknown>);

  const lowCreditWarnings = (creditBroadcasts || []).filter((b) => {
    const data = b.data;
    const isLow = hasLowCredits(data) && Boolean(data.isLowCredits);
    const isHighPriority = b.priority === "high" || b.priority === "urgent" || b.priority === "critical";
    return isLow || isHighPriority;
  });

  // Get latest credit update
  const latestCreditUpdate = (creditBroadcasts || []).sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0];

  return {
    broadcasts: creditBroadcasts || [],
    lowCreditWarnings,
    latestCreditUpdate,
    acknowledgeBroadcast,
    hasLowCredits: lowCreditWarnings.length > 0,
    currentBalance: latestCreditUpdate?.data && typeof latestCreditUpdate.data === 'object' && 'newBalance' in latestCreditUpdate.data
      ? (latestCreditUpdate.data.newBalance as number)
      : undefined,
    isLoading: creditBroadcasts === undefined,
  };
}

/**
 * Utility function to get priority display properties
 */
export function getPriorityDisplay(priority: BroadcastPriority) {
  switch (priority) {
    case "critical":
      return {
        label: "Critical",
        variant: "destructive" as const,
        color: "text-red-600",
        bgColor: "bg-red-50 border-red-200 text-red-900",
        icon: "🚨",
      };
    case "urgent":
      return {
        label: "Urgent",
        variant: "destructive" as const,
        color: "text-orange-600",
        bgColor: "bg-orange-50 border-orange-200 text-orange-900",
        icon: "⚠️",
      };
    case "high":
      return {
        label: "High",
        variant: "default" as const,
        color: "text-yellow-600",
        bgColor: "bg-yellow-50 border-yellow-200 text-yellow-900",
        icon: "📢",
      };
    case "normal":
      return {
        label: "Normal",
        variant: "secondary" as const,
        color: "text-blue-600",
        bgColor: "bg-blue-50 border-blue-200 text-blue-900",
        icon: "💬",
      };
    case "low":
      return {
        label: "Low",
        variant: "outline" as const,
        color: "text-gray-600",
        bgColor: "bg-gray-50 border-gray-200 text-gray-900",
        icon: "ℹ️",
      };
    default:
      return {
        label: "Unknown",
        variant: "outline" as const,
        color: "text-gray-600",
        bgColor: "bg-gray-50 border-gray-200 text-gray-900",
        icon: "❓",
      };
  }
}

/**
 * Utility function to format broadcast time
 */
export function formatBroadcastTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60 * 1000) {
    return "Just now";
  } else if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}m ago`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

/**
 * Type guard for broadcast data
 */
export function isBroadcastType<T = unknown>(
  broadcast: StatusBroadcast,
  type: string,
): broadcast is StatusBroadcast & { data: T } {
  return broadcast.type === type;
}
