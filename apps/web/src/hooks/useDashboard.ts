import { useQuery } from "convex/react";
import { api } from "@genni/convex-types"

export function useDashboard() {
  // Using available public functions instead of missing ones
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