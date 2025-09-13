import { useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useCallback } from "react";
import { createLogger, timeOperation } from "@/utils/logger";
import { useSSEBroadcasts, type SSEBroadcastMessage } from "./useSSEBroadcasts";

const logger = createLogger("useStatusBroadcasts");

export type BroadcastPriority = 1 | 2 | 3 | 4 | 5;

export interface StatusBroadcast {
  _id: Id<"statusBroadcasts"> | string;
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
}

/**
 * Hook for managing real-time status broadcasts (SSE-POWERED)
 * Now uses Server-Sent Events for true real-time updates instead of database polling
 */
export function useStatusBroadcasts() {
  // Use SSE for real-time updates instead of database polling
  const {
    messages,
    urgentMessages,
    isConnected,
    getMessagesByType,
    clearMessagesByType,
  } = useSSEBroadcasts();

  const acknowledgeAction = useMutation(
    api.realtime.mutations.acknowledgeBroadcast,
  );

  // Convert SSE messages to StatusBroadcast format for backward compatibility
  const convertToStatusBroadcast = useCallback(
    (message: SSEBroadcastMessage): StatusBroadcast => {
      return {
        _id: message.messageId || `sse_${message.timestamp}`,
        userId: "" as Id<"users">, // Will be filled by the current user
        type: message.type.replace("queued_", ""), // Remove queued prefix
        title: message.data?.title || message.type,
        message: message.message,
        data: message.data,
        priority: mapSSEPriorityToBroadcast(message.priority),
        tags: message.data?.category ? [message.data.category] : [],
        status: "delivered" as const,
        delivered: true,
        acknowledged: false,
        requiresAck: false,
        createdAt: message.timestamp,
        expiresAt: message.timestamp + 60 * 60 * 1000, // 1 hour from creation
        error: message.error,
      };
    },
    [],
  );

  // Map SSE priority to broadcast priority
  const mapSSEPriorityToBroadcast = (priority?: string): BroadcastPriority => {
    switch (priority) {
      case "critical":
        return 5;
      case "urgent":
        return 4;
      case "high":
        return 3;
      case "normal":
        return 2;
      case "low":
        return 1;
      default:
        return 2;
    }
  };

  // Convert SSE messages to StatusBroadcast format
  const broadcasts = messages.map(convertToStatusBroadcast);
  const urgentBroadcasts = urgentMessages.map(convertToStatusBroadcast);

  const acknowledgeBroadcast = useCallback(
    async (broadcastId: Id<"statusBroadcasts">) => {
      logger.info("Acknowledging broadcast", { broadcastId });
      return timeOperation("acknowledgeBroadcast", () =>
        acknowledgeAction({ broadcastId }),
      );
    },
    [acknowledgeAction],
  );

  // Filter broadcasts by type
  const getByType = useCallback(
    (type: string) => {
      const sseMessages = getMessagesByType(type);
      return sseMessages.map(convertToStatusBroadcast);
    },
    [getMessagesByType, convertToStatusBroadcast],
  );

  // Filter broadcasts by tags (limited in SSE version)
  const getByTags = useCallback(
    (tags: string[]) => {
      return broadcasts.filter((b) => tags.some((tag) => b.tags.includes(tag)));
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
    broadcasts,
    urgentBroadcasts,
    searchBroadcasts,
    creditBroadcasts,
    rateLimitWarnings,
    systemAlerts,
    getByType,
    getByTags,
    acknowledgeBroadcast,
    isLoading: false, // SSE is always "loaded"
    hasUrgent: urgentBroadcasts.length > 0,
    needsAcknowledgment: 0, // SSE messages don't require acknowledgment in this version

    // SSE-specific additions
    isConnected,
    clearMessagesByType,
  };
}

/**
 * Hook for broadcasts related to a specific search (SSE-POWERED)
 */
export function useSearchBroadcasts(searchId?: Id<"searches">) {
  const { broadcasts, acknowledgeBroadcast } = useStatusBroadcasts();
  const { getPipelineMessages } = useSSEBroadcasts();

  // Use SSE pipeline messages for real-time updates
  const pipelineMessages = getPipelineMessages(searchId);
  const searchSpecificBroadcasts = pipelineMessages.map((msg) => ({
    _id: msg.messageId || `sse_${msg.timestamp}`,
    userId: "" as Id<"users">,
    type: "pipeline_update",
    title: `Pipeline ${msg.data?.stage}`,
    message: msg.message,
    data: msg.data,
    priority: mapSSEPriorityToBroadcast(msg.priority),
    tags: ["pipeline", msg.data?.stage].filter(Boolean),
    status: "delivered" as const,
    delivered: true,
    acknowledged: false,
    requiresAck: false,
    createdAt: msg.timestamp,
    expiresAt: msg.timestamp + 60 * 60 * 1000,
    error: msg.error,
  }));

  // Sort by creation time (newest first)
  const sortedBroadcasts = searchSpecificBroadcasts.sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  // Get latest status update
  const latestStatus = sortedBroadcasts[0];

  // Get progress updates
  const progressUpdates = sortedBroadcasts.filter(
    (b) => b.data?.progress !== undefined || b.message.includes("%"),
  );

  // Helper function for SSE priority mapping (duplicate from above for this function)
  function mapSSEPriorityToBroadcast(priority?: string): BroadcastPriority {
    switch (priority) {
      case "critical":
        return 5;
      case "urgent":
        return 4;
      case "high":
        return 3;
      case "normal":
        return 2;
      case "low":
        return 1;
      default:
        return 2;
    }
  }

  return {
    broadcasts: sortedBroadcasts,
    latestStatus,
    progressUpdates,
    acknowledgeBroadcast,
    hasUpdates: sortedBroadcasts.length > 0,

    // SSE-specific additions
    currentProgress: latestStatus?.data?.progress || 0,
    currentStage: latestStatus?.data?.stage || "pending",
  };
}

/**
 * Hook for batch processing broadcasts
 */
export function useBatchBroadcasts(batchPlanId?: string) {
  const { broadcasts, acknowledgeBroadcast } = useStatusBroadcasts();

  const batchBroadcasts = (broadcasts || []).filter(
    (b) => b.type === "batch_progress" && b.data?.batchPlanId === batchPlanId,
  );

  // Get latest batch progress
  const latestProgress = batchBroadcasts.sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0];

  return {
    broadcasts: batchBroadcasts,
    latestProgress,
    acknowledgeBroadcast,
    hasProgress: batchBroadcasts.length > 0,
    completedBatches: latestProgress?.data?.completedBatches || 0,
    totalBatches: latestProgress?.data?.totalBatches || 0,
    progressPercent: latestProgress?.data?.progressPercent || 0,
  };
}

/**
 * Hook for credit and billing broadcasts
 */
export function useCreditBroadcasts() {
  const { creditBroadcasts, acknowledgeBroadcast } = useStatusBroadcasts();

  // Filter for low credit warnings
  const lowCreditWarnings = creditBroadcasts.filter(
    (b) => b.data?.isLowCredits || b.priority >= 3,
  );

  // Get latest credit update
  const latestCreditUpdate = creditBroadcasts.sort(
    (a, b) => b.createdAt - a.createdAt,
  )[0];

  return {
    broadcasts: creditBroadcasts,
    lowCreditWarnings,
    latestCreditUpdate,
    acknowledgeBroadcast,
    hasLowCredits: lowCreditWarnings.length > 0,
    currentBalance: latestCreditUpdate?.data?.newBalance,
  };
}

/**
 * Utility function to get priority display properties
 */
export function getPriorityDisplay(priority: BroadcastPriority) {
  switch (priority) {
    case 5:
      return {
        label: "Critical",
        variant: "destructive" as const,
        color: "text-red-600",
        bgColor: "bg-red-50 border-red-200",
        icon: "🚨",
      };
    case 4:
      return {
        label: "Urgent",
        variant: "destructive" as const,
        color: "text-orange-600",
        bgColor: "bg-orange-50 border-orange-200",
        icon: "⚠️",
      };
    case 3:
      return {
        label: "High",
        variant: "default" as const,
        color: "text-yellow-600",
        bgColor: "bg-yellow-50 border-yellow-200",
        icon: "📢",
      };
    case 2:
      return {
        label: "Normal",
        variant: "secondary" as const,
        color: "text-blue-600",
        bgColor: "bg-blue-50 border-blue-200",
        icon: "💬",
      };
    case 1:
      return {
        label: "Low",
        variant: "outline" as const,
        color: "text-gray-600",
        bgColor: "bg-gray-50 border-gray-200",
        icon: "ℹ️",
      };
    default:
      return {
        label: "Unknown",
        variant: "outline" as const,
        color: "text-gray-600",
        bgColor: "bg-gray-50 border-gray-200",
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
