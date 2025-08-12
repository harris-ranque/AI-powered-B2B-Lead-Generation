import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api"

export function useDashboard() {
  const dashboardStats = useQuery(api.admin.queries.getDashboardStats);
  const recentActivity = useQuery(api.notifications.queries.getRecentActivity);
  
  return {
    stats: dashboardStats,
    recentActivity,
    isLoading: dashboardStats === undefined,
  };
}

export function useDashboardMetrics() {
  const leadStats = useQuery(api.leads.queries.getLeadStats);
  const searchStats = useQuery(api.search.queries.getSearchStats);
  const emailStats = useQuery(api.crewai.queries.getEmailGenerationStats);
  
  return {
    leadStats,
    searchStats,
    emailStats,
    isLoading: leadStats === undefined || searchStats === undefined,
  };
}