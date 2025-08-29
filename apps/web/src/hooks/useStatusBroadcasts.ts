import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useEffect, useCallback } from "react";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger('useStatusBroadcasts');

export type BroadcastPriority = 1 | 2 | 3 | 4 | 5;

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
}

/**
 * Hook for managing real-time status broadcasts
 * Integrates with the enterprise broadcasting system for live updates
 */
export function useStatusBroadcasts() {
  const broadcasts = useQuery(api.realtime.queries.getUserBroadcasts, {
    includeDelivered: false,
    limit: 20,
  });

  const acknowledgeAction = useMutation(api.realtime.mutations.acknowledgeBroadcast);

  useEffect(() => {
    if (broadcasts) {
      logger.debug('Status broadcasts loaded', {
        count: broadcasts.length,
        urgent: broadcasts.filter(b => b.priority >= 4).length,
        requiresAck: broadcasts.filter(b => b.requiresAck && !b.acknowledged).length,
      });
    }
  }, [broadcasts]);

  const acknowledgeBroadcast = useCallback(async (broadcastId: Id<"statusBroadcasts">) => {
    logger.info('Acknowledging broadcast', { broadcastId });
    return timeOperation('acknowledgeBroadcast', () => 
      acknowledgeAction({ broadcastId })
    );
  }, [acknowledgeAction]);

  // Filter broadcasts by type
  const getByType = useCallback((type: string) => {
    return broadcasts?.filter(b => b.type === type) || [];
  }, [broadcasts]);

  // Filter broadcasts by tags
  const getByTags = useCallback((tags: string[]) => {
    return broadcasts?.filter(b => 
      tags.some(tag => b.tags.includes(tag))
    ) || [];
  }, [broadcasts]);

  // Get urgent broadcasts (high priority, not acknowledged)
  const urgentBroadcasts = broadcasts?.filter(b => 
    b.priority >= 4 && (!b.requiresAck || !b.acknowledged)
  ) || [];

  // Get search-related broadcasts
  const searchBroadcasts = getByType('search_status');

  // Get credit-related broadcasts
  const creditBroadcasts = getByType('credit_update');

  // Get rate limit warnings
  const rateLimitWarnings = getByType('rate_limit_warning');

  // Get system alerts
  const systemAlerts = getByType('system_alert');

  return {
    broadcasts: broadcasts || [],
    urgentBroadcasts,
    searchBroadcasts,
    creditBroadcasts,
    rateLimitWarnings,
    systemAlerts,
    getByType,
    getByTags,
    acknowledgeBroadcast,
    isLoading: broadcasts === undefined,
    hasUrgent: urgentBroadcasts.length > 0,
    needsAcknowledgment: broadcasts?.filter(b => b.requiresAck && !b.acknowledged).length || 0,
  };
}

/**
 * Hook for broadcasts related to a specific search
 */
export function useSearchBroadcasts(searchId?: Id<"searches">) {
  const { broadcasts, acknowledgeBroadcast } = useStatusBroadcasts();
  
  const searchSpecificBroadcasts = broadcasts.filter(b => 
    b.type === 'search_status' && 
    b.data?.searchId === searchId
  );

  // Sort by creation time (newest first)
  const sortedBroadcasts = searchSpecificBroadcasts.sort((a, b) => 
    b.createdAt - a.createdAt
  );

  // Get latest status update
  const latestStatus = sortedBroadcasts[0];

  // Get progress updates
  const progressUpdates = sortedBroadcasts.filter(b => 
    b.data?.progress || b.message.includes('progress') || b.message.includes('%')
  );

  return {
    broadcasts: sortedBroadcasts,
    latestStatus,
    progressUpdates,
    acknowledgeBroadcast,
    hasUpdates: sortedBroadcasts.length > 0,
  };
}

/**
 * Hook for batch processing broadcasts
 */
export function useBatchBroadcasts(batchPlanId?: string) {
  const { broadcasts, acknowledgeBroadcast } = useStatusBroadcasts();
  
  const batchBroadcasts = broadcasts.filter(b => 
    b.type === 'batch_progress' && 
    b.data?.batchPlanId === batchPlanId
  );

  // Get latest batch progress
  const latestProgress = batchBroadcasts
    .sort((a, b) => b.createdAt - a.createdAt)[0];

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
  const lowCreditWarnings = creditBroadcasts.filter(b => 
    b.data?.isLowCredits || 
    b.priority >= 3
  );

  // Get latest credit update
  const latestCreditUpdate = creditBroadcasts
    .sort((a, b) => b.createdAt - a.createdAt)[0];

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
        label: 'Critical', 
        variant: 'destructive' as const, 
        color: 'text-red-600',
        bgColor: 'bg-red-50 border-red-200',
        icon: '🚨'
      };
    case 4:
      return { 
        label: 'Urgent', 
        variant: 'destructive' as const, 
        color: 'text-orange-600',
        bgColor: 'bg-orange-50 border-orange-200',
        icon: '⚠️'
      };
    case 3:
      return { 
        label: 'High', 
        variant: 'default' as const, 
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50 border-yellow-200',
        icon: '📢'
      };
    case 2:
      return { 
        label: 'Normal', 
        variant: 'secondary' as const, 
        color: 'text-blue-600',
        bgColor: 'bg-blue-50 border-blue-200',
        icon: '💬'
      };
    case 1:
      return { 
        label: 'Low', 
        variant: 'outline' as const, 
        color: 'text-gray-600',
        bgColor: 'bg-gray-50 border-gray-200',
        icon: 'ℹ️'
      };
    default:
      return { 
        label: 'Unknown', 
        variant: 'outline' as const, 
        color: 'text-gray-600',
        bgColor: 'bg-gray-50 border-gray-200',
        icon: '❓'
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
    return 'Just now';
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
  type: string
): broadcast is StatusBroadcast & { data: T } {
  return broadcast.type === type;
}