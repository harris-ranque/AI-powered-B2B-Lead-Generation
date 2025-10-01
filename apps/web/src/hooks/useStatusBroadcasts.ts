import type { Id } from "@genni/convex-types/dataModel";
import { useUserDataMaybe } from "@/contexts/UserDataContext";
import {
  useStatusBroadcastsBase,
  useSearchBroadcastsBase,
  useBatchBroadcastsBase,
  useCreditBroadcastsBase,
  type UseStatusBroadcastsResult,
  type UseSearchBroadcastsResult,
  type UseBatchBroadcastsResult,
  type UseCreditBroadcastsResult,
  type StatusBroadcast,
  type BroadcastPriority,
} from "./base/useStatusBroadcastsBase";

export {
  useStatusBroadcastsBase,
  useSearchBroadcastsBase,
  useBatchBroadcastsBase,
  useCreditBroadcastsBase,
} from "./base/useStatusBroadcastsBase";
export type {
  UseStatusBroadcastsResult,
  UseSearchBroadcastsResult,
  UseBatchBroadcastsResult,
  UseCreditBroadcastsResult,
  StatusBroadcast,
  BroadcastPriority,
} from "./base/useStatusBroadcastsBase";

export function useStatusBroadcasts(): UseStatusBroadcastsResult {
  const context = useUserDataMaybe();
  return context?.statusBroadcasts ?? useStatusBroadcastsBase();
}

export function useSearchBroadcasts(
  searchId?: Id<"searches">,
): UseSearchBroadcastsResult {
  const statusBroadcasts = useStatusBroadcasts();
  return useSearchBroadcastsBase(searchId, statusBroadcasts);
}

export function useBatchBroadcasts(
  batchPlanId?: string,
): UseBatchBroadcastsResult {
  const statusBroadcasts = useStatusBroadcasts();
  return useBatchBroadcastsBase(batchPlanId, statusBroadcasts);
}

export function useCreditBroadcasts(): UseCreditBroadcastsResult {
  const statusBroadcasts = useStatusBroadcasts();
  return useCreditBroadcastsBase(statusBroadcasts);
}

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

export function isBroadcastType<T = unknown>(
  broadcast: StatusBroadcast,
  type: string,
): broadcast is StatusBroadcast & { data: T } {
  return broadcast.type === type;
}
