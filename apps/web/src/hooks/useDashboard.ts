import { api } from "@genni/convex-types";
import { useConvexPolling } from "./useConvexPolling";

export function useDashboard() {
  // Poll instead of subscribing to reduce WebSocket load
  const { data: notifications, isLoading: loadingNotifs } = useConvexPolling(
    api.notifications.queries.getUserNotifications,
    undefined,
    { intervalMs: 3000 },
  );
  const { data: notificationCounts } = useConvexPolling(
    api.notifications.queries.getNotificationCounts,
    undefined,
    { intervalMs: 3000 },
  );

  return {
    stats: null, // Admin dashboard stats not available to regular users
    recentActivity: notifications,
    notificationCounts,
    isLoading: notifications === undefined || loadingNotifs,
  };
}

export function useDashboardMetrics() {
  const { data: leadStats, isLoading: loadingLeads } = useConvexPolling(
    api.leads.queries.getLeadStats,
    undefined,
    { intervalMs: 4000 },
  );
  const { data: userStats, isLoading: loadingUsers } = useConvexPolling(
    api.users.queries.getUserStats, // Contains search analytics
    undefined,
    { intervalMs: 4000 },
  );
  const { data: emailStats } = useConvexPolling(
    api.crewai.queries.getEmailGenerationStats,
    undefined,
    { intervalMs: 5000 },
  );

  return {
    leadStats,
    searchStats: userStats, // getUserStats contains search metrics
    emailStats,
    isLoading: leadStats === undefined || userStats === undefined || loadingLeads || loadingUsers,
  };
}
