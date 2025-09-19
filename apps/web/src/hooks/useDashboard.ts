import { api } from "@genni/convex-types";
import { useQuery } from "convex/react";

export function useDashboard() {
  // Use Convex native reactive queries - real-time updates without polling!
  const notifications = useQuery(api.notifications.queries.getUserNotifications);
  const notificationCounts = useQuery(api.notifications.queries.getNotificationCounts);

  return {
    stats: null, // Admin dashboard stats not available to regular users
    recentActivity: notifications,
    notificationCounts,
    isLoading: notifications === undefined,
  };
}

export function useDashboardMetrics() {
  // Use Convex native reactive queries - real-time updates without polling!
  const leadStats = useQuery(api.leads.queries.getLeadStats);
  const userStats = useQuery(api.users.queries.getUserStats); // Contains search analytics
  const emailStats = useQuery(api.crewai.queries.getEmailGenerationStats);

  return {
    leadStats,
    searchStats: userStats, // getUserStats contains search metrics
    emailStats,
    isLoading: leadStats === undefined || userStats === undefined,
  };
}
