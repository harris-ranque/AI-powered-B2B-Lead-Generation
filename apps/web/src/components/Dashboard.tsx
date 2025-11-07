/**
 * ⚠️ WARNING: THIS COMPONENT IS CURRENTLY UNUSED ⚠️
 *
 * This Dashboard component is imported in LeadEternityDashboard.tsx but NEVER RENDERED.
 *
 * Active tabs that ARE rendered:
 * - "overview" → DashboardOverview.tsx
 * - "pipeline" → PipelineOrchestrator.tsx
 * - "search-history" → LeadSearchHistory.tsx
 * - "performance" → PerformanceWorkspace.tsx
 * - "profile" → BusinessProfileWizard.tsx
 * - "settings" → Settings.tsx
 * - "admin" → AdminDashboard.tsx
 *
 * The "dashboard" and "credits" tab names exist in typeValidation.ts
 * but have no corresponding render logic in LeadEternityDashboard.tsx.
 *
 * TODO: Either wire this component up or remove it entirely.
 * Last updated: 2025-01-07
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Mail,
  Clock,
  Search,
  Bot,
  AlertTriangle,
  Bell,
  X,
  CheckCircle,
} from "lucide-react";
import { useDashboardMetrics } from "@/hooks/useDashboard";
import { useUserLeads } from "@/hooks/useLeads";
import { useSearches } from "@/hooks/useSearches";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useStatusBroadcasts,
  getPriorityDisplay,
  formatBroadcastTime,
} from "@/hooks/useStatusBroadcasts";
import { SearchProgressTracker } from "@/components/SearchProgressTracker";
import { PipelineProgressProvider } from "@/contexts/PipelineProgressContext";
import { PipelineProgressPanel } from "@/components/PipelineProgressPanel";
import { featureFlags } from "@/lib/featureFlags";
import { SubscriptionStatusCard } from "@/components/SubscriptionStatusCard";
import { UsageMetersCard } from "@/components/UsageMetersCard";
import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useUsage } from "@/hooks/useUsage";
import { UsageWarnings } from "@/components/SubscriptionGuard";
import { DashboardHelpWidget } from "@/components/DashboardHelpWidget";
import { useSubscriptionGuard } from "@/hooks/useSubscriptionGuard";
import { withErrorBoundary } from "@/utils/errorHandling";
import { createLogger } from "@/utils/logger";
import type { Id } from "@genni/convex-types/dataModel";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const dashboardLogger = createLogger("Dashboard");

export interface DashboardProps {
  onNavigate?: (tab: "pipeline" | "search-history" | "profile" | "settings") => void;
}

function DashboardComponent({ onNavigate }: DashboardProps) {
  // Real Convex hooks
  const {
    leadStats,
    searchStats,
    emailStats,
    isLoading: metricsLoading,
  } = useDashboardMetrics();
  const { stats: userLeadStats } = useUserLeads();
  const { searches } = useSearches();
  const { notifications } = useNotifications();
  const { user } = useAuth();

  const {
    urgentBroadcasts,
    searchBroadcasts,
    creditBroadcasts,
    rateLimitWarnings,
    acknowledgeBroadcast,
    markAsRead,
    hasUrgent,
    needsAcknowledgment,
  } = useStatusBroadcasts();

  // Subscription and usage hooks
  const { isStarter, hasActiveSubscription } = useSubscription();
  const {
    usage,
    isNearLimit,
    searchesPercentage,
    enrichmentsPercentage,
    exportsPercentage,
  } = useUsage();
  const { canPerformAction } = useSubscriptionGuard();

  const combinedLeadStats = leadStats ?? userLeadStats;
  const totalLeads = combinedLeadStats?.totalLeads ?? 0;
  const leadsWithEmails = combinedLeadStats?.enrichedLeads ?? 0;
  const enrichmentRate = combinedLeadStats?.enrichmentRate ?? 0;
  const conversionRate = combinedLeadStats?.conversionRate ?? 0;
  const analysisRate = combinedLeadStats?.analysisRate ?? 0;

  const totalSearches = searchStats?.totalSearches ?? searches?.length ?? 0;
  const completionRate = searchStats?.completionRate ?? 0;
  const recentSearches = searchStats?.recentSearches;

  const totalEmailRuns = emailStats?.totalEmails ?? 0;
  const successfulEmails = emailStats?.successfulEmails ?? 0;
  const emailSuccessRate =
    emailStats?.successRate ??
    (totalEmailRuns > 0
      ? Math.round((successfulEmails / totalEmailRuns) * 100)
      : 0);

  // Local state for dismissible alerts and surfaced errors
  const [dismissedAlerts, setDismissedAlerts] = useState<
    Set<Id<"statusBroadcasts">>
  >(() => new Set());
  const [componentError, setComponentError] = useState<string | null>(null);

  const handleComponentError = useCallback(
    (error: unknown, context: string, extra?: Record<string, unknown>) => {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));

      dashboardLogger.error(`Dashboard error: ${context}`, extra, errorInstance);
      setComponentError(`${context}: ${errorInstance.message}`);
    },
    [],
  );

  const dismissComponentError = useCallback(() => {
    setComponentError(null);
  }, []);

  const formatRelativeTime = useCallback((timestamp?: number | null) => {
    if (typeof timestamp !== "number") {
      return "Recently";
    }

    return formatBroadcastTime(timestamp);
  }, []);

  // Filter active searches for progress tracking
  const activeSearches = useMemo(() => {
    try {
      return searches?.filter((s) => s.status === "in_progress") || [];
    } catch (error) {
      handleComponentError(error, "active-searches", {
        searchCount: searches?.length,
      });
      return [];
    }
  }, [handleComponentError, searches]);

  const recentCompletedSearches = useMemo(() => {
    try {
      return (
        searches?.filter((s) => {
          if (s.status !== "completed" || typeof s.completedAt !== "number") {
            return false;
          }

          return Date.now() - s.completedAt < 24 * 60 * 60 * 1000;
        }) || []
      );
    } catch (error) {
      handleComponentError(error, "recent-completed-searches", {
        searchCount: searches?.length,
      });
      return [];
    }
  }, [handleComponentError, searches]);

  // Helper function to dismiss alerts
  const dismissAlert = useCallback(
    (alertId: Id<"statusBroadcasts">) => {
      try {
        setDismissedAlerts((prev) => {
          const next = new Set(prev);
          next.add(alertId);
          return next;
        });

        void markAsRead(alertId).catch((error: unknown) => {
          handleComponentError(error, "dismiss-alert", { alertId });
          setDismissedAlerts((prev) => {
            const next = new Set(prev);
            next.delete(alertId);
            return next;
          });
        });
      } catch (error) {
        handleComponentError(error, "dismiss-alert", { alertId });
      }
    },
    [handleComponentError, markAsRead],
  );

  // Filter non-dismissed urgent broadcasts
  const visibleUrgentBroadcasts = useMemo(() => {
    try {
      return urgentBroadcasts.filter((b) => !dismissedAlerts.has(b._id));
    } catch (error) {
      handleComponentError(error, "visible-urgent-broadcasts", {
        urgentCount: urgentBroadcasts.length,
      });
      return [];
    }
  }, [dismissedAlerts, handleComponentError, urgentBroadcasts]);

  const trendData = useMemo(() => {
    try {
      if (!recentSearches || recentSearches.length === 0) {
        return [] as {
          id: Id<"searches">;
          label: string;
          leads: number;
          enriched: number;
        }[];
      }

      const sorted = [...recentSearches].sort(
        (a, b) => a.createdAt - b.createdAt,
      );

      return sorted.slice(-6).map((search) => {
        const totalFound =
          typeof search.results?.totalFound === "number"
            ? search.results.totalFound
            : 0;
        const enrichedCount =
          typeof search.results?.enrichedCount === "number"
            ? search.results.enrichedCount
            : 0;

        return {
          id: search._id,
          label: new Date(search.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          leads: totalFound,
          enriched: enrichedCount,
        };
      });
    } catch (error) {
      handleComponentError(error, "trend-data", {
        recentSearchCount: recentSearches?.length,
      });
      return [];
    }
  }, [handleComponentError, recentSearches]);

  const trendSummary = useMemo(() => {
    if (trendData.length === 0) {
      return { totalLeads: 0, totalEnriched: 0, avgLeads: 0 };
    }

    const totals = trendData.reduce(
      (acc, entry) => ({
        totalLeads: acc.totalLeads + entry.leads,
        totalEnriched: acc.totalEnriched + entry.enriched,
      }),
      { totalLeads: 0, totalEnriched: 0 },
    );

    return {
      ...totals,
      avgLeads: Math.round(totals.totalLeads / trendData.length),
    };
  }, [trendData]);

  const trendChartConfig = useMemo(
    () => ({
      leads: { label: "Leads found", color: "hsl(var(--chart-1))" },
      enriched: { label: "Enriched leads", color: "hsl(var(--chart-2))" },
    }),
    [],
  );

  const stats = useMemo(() => {
    try {
      return [
        {
          title: "Total Leads Found",
          value: totalLeads.toLocaleString(),
          change:
            trendSummary.totalLeads > 0
              ? `+${trendSummary.totalLeads} from recent searches`
              : "No recent searches",
          icon: Users,
        },
        {
          title: "Enriched Leads",
          value: leadsWithEmails.toLocaleString(),
          change:
            totalLeads > 0
              ? `${enrichmentRate}% enriched`
              : "No leads enriched yet",
          icon: Mail,
        },
        {
          title: "Searches Completed",
          value: totalSearches.toLocaleString(),
          change:
            totalSearches > 0
              ? `${completionRate}% completion rate`
              : "No searches yet",
          icon: Search,
        },
        {
          title: "AI Emails Generated",
          value: successfulEmails.toLocaleString(),
          change:
            totalEmailRuns > 0
              ? `${emailSuccessRate}% success rate`
              : "No email runs",
          icon: Bot,
        },
      ];
    } catch (error) {
      handleComponentError(error, "dashboard-stats", {
        totalLeads,
        leadsWithEmails,
        totalSearches,
        totalEmailRuns,
      });
      return [
        {
          title: "Total Leads Found",
          value: totalLeads.toLocaleString(),
          change: "Data unavailable",
          icon: Users,
        },
        {
          title: "Enriched Leads",
          value: leadsWithEmails.toLocaleString(),
          change: "Data unavailable",
          icon: Mail,
        },
        {
          title: "Searches Completed",
          value: totalSearches.toLocaleString(),
          change: "Data unavailable",
          icon: Search,
        },
        {
          title: "AI Emails Generated",
          value: successfulEmails.toLocaleString(),
          change: "Data unavailable",
          icon: Bot,
        },
      ];
    }
  }, [
    completionRate,
    emailSuccessRate,
    handleComponentError,
    leadsWithEmails,
    successfulEmails,
    totalEmailRuns,
    totalLeads,
    totalSearches,
    trendSummary,
    enrichmentRate,
  ]);

  // Convert notifications to recent activity format
  const recentActivity = useMemo(() => {
    try {
      return (
        notifications?.notifications?.slice(0, 4).map((notification) => ({
          action: notification.title,
          time: new Date(notification._creationTime).toLocaleString(),
          count: notification.type,
        })) || []
      );
    } catch (error) {
      handleComponentError(error, "recent-activity", {
        notificationCount: notifications?.notifications?.length,
      });
      return [];
    }
  }, [handleComponentError, notifications?.notifications]);

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8">
        <div className="max-w-6xl">
          {componentError && (
            <Alert variant="destructive" className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between gap-4">
                <span>{componentError}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={dismissComponentError}
                >
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold text-foreground mb-2">
                  Dashboard
                </h1>
                <div className="flex items-center gap-4">
                  <p className="text-muted-foreground">
                    Welcome back! Here's what's happening with your leads.
                  </p>
                  {usage && (
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="px-2 py-1">
                        {usage.searchesUsed}/
                        {usage.limits.monthlySearches === -1
                          ? "∞"
                          : usage.limits.monthlySearches}{" "}
                        searches
                      </Badge>
                      {usage.limits.monthlySearches !== -1 &&
                        searchesPercentage >= 80 && (
                          <Badge variant="destructive" className="px-2 py-1">
                            {searchesPercentage}% used
                          </Badge>
                        )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-4">
                <DashboardHelpWidget />
                {/* Real-time notification indicator */}
                {hasUrgent && (
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-orange-500 animate-pulse" />
                    <Badge variant="destructive" className="animate-pulse">
                      {urgentBroadcasts.length} urgent
                    </Badge>
                    {needsAcknowledgment > 0 && (
                      <Badge variant="outline">
                        {needsAcknowledgment} need attention
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Urgent Broadcast Alerts */}
          {visibleUrgentBroadcasts.length > 0 && (
            <div className="mb-6 space-y-3">
              {visibleUrgentBroadcasts.map((broadcast) => {
                const priorityDisplay = getPriorityDisplay(broadcast.priority);
                return (
                  <Alert
                    key={broadcast._id}
                    className={`${priorityDisplay.bgColor} border-l-4`}
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-current mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold">{broadcast.title}</h4>
                          <Badge
                            variant={priorityDisplay.variant}
                            className="text-xs"
                          >
                            {priorityDisplay.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatBroadcastTime(broadcast.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm mb-2">{broadcast.message}</p>

                        {/* Show additional data if available */}
                        {broadcast.data && (
                          <div className="text-xs bg-background/50 p-2 rounded border">
                            {broadcast.data.creditBalance !== undefined && (
                              <span>
                                Credit Balance: {broadcast.data.creditBalance}
                              </span>
                            )}
                            {broadcast.data.searchId && (
                              <span>Search ID: {broadcast.data.searchId}</span>
                            )}
                            {broadcast.data.rateLimitType && (
                              <span>
                                Rate Limit: {broadcast.data.rateLimitType}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-3">
                          {broadcast.requiresAck && !broadcast.acknowledged && (
                            <Button
                              size="sm"
                              onClick={() =>
                                acknowledgeBroadcast(broadcast._id)
                              }
                            >
                              Acknowledge
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dismissAlert(broadcast._id)}
                          >
                            <X className="h-4 w-4" />
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Alert>
                );
              })}
            </div>
          )}

          {/* Active Search Progress */}
          {activeSearches.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Search className="h-5 w-5" />
                Active Searches ({activeSearches.length})
              </h3>
              <div className="space-y-4">
                {activeSearches.slice(0, 3).map((search) => (
                  featureFlags.unifiedProgressPanel ? (
                    <PipelineProgressProvider key={search._id} searchId={search._id}>
                      <PipelineProgressPanel layout="compact" showTimeline={false} />
                    </PipelineProgressProvider>
                  ) : (
                    <SearchProgressTracker
                      key={search._id}
                      searchId={search._id}
                      compact
                      showHistory={false}
                    />
                  )
                ))}
                {activeSearches.length > 3 && (
                  <Card className="p-4">
                    <p className="text-sm text-muted-foreground text-center">
                      +{activeSearches.length - 3} more active searches
                    </p>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* Subscription Status and Usage Alert */}
          {(isStarter ||
            (usage &&
              (isNearLimit(searchesPercentage) ||
                isNearLimit(enrichmentsPercentage) ||
                isNearLimit(exportsPercentage)))) && (
            <Alert className="mb-6 border-blue-200 bg-blue-50/50">
              <AlertTriangle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                {isStarter ? (
                  <span>
                    You're on the Starter plan.{" "}
                    <strong>Upgrade to Professional</strong> to unlock managed
                    API keys and higher limits.
                  </span>
                ) : (
                  <span>
                    You're approaching your usage limits. Consider upgrading
                    your plan to avoid interruptions.
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Usage Warnings */}
          <UsageWarnings />

          {/* Subscription & Usage Cards */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
            <SubscriptionStatusCard />
            <UsageMetersCard />
          </div>

          {/* Loading State */}
          {metricsLoading ? (
            <Alert className="mb-8">
              <Clock className="h-4 w-4 animate-spin" />
              <AlertDescription>Loading dashboard metrics...</AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <Card
                      key={stat.title}
                      className="p-5 bg-card border-border"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {stat.title}
                          </p>
                          <p className="text-2xl font-bold text-foreground">
                            {stat.value}
                          </p>
                          <p className="text-sm text-primary">{stat.change}</p>
                        </div>
                        <div className="bg-primary/10 p-3 rounded-lg">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {/* Charts & Activity */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Performance Chart */}
            <Card className="p-5 bg-card border-border">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  Lead Generation Trend
                </h3>
                {trendData.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Last {trendData.length} searches
                  </Badge>
                )}
              </div>
              {trendData.length > 0 ? (
                <ChartContainer
                  config={trendChartConfig}
                  className="h-52 w-full"
                >
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      width={40}
                    />
                    <ChartTooltip
                      cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                      content={<ChartTooltipContent indicator="line" />}
                    />
                    <Bar dataKey="leads" fill="var(--color-leads)" radius={4} />
                    <Bar
                      dataKey="enriched"
                      fill="var(--color-enriched)"
                      radius={4}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md bg-muted/10 text-sm text-muted-foreground">
                  Run a search to populate your trend chart.
                </div>
              )}
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Recent leads</p>
                  <p className="text-lg font-semibold text-foreground">
                    {trendSummary.totalLeads.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Avg {trendSummary.avgLeads.toLocaleString()} per search
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Enriched</p>
                  <p className="text-lg font-semibold text-foreground">
                    {trendSummary.totalEnriched.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {enrichmentRate}% overall coverage
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pipeline quality</p>
                  <p className="text-lg font-semibold text-foreground">
                    {conversionRate}% conversion
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {analysisRate}% analyzed leads
                  </p>
                </div>
              </div>
            </Card>

            {/* Recent Activity & Real-time Updates */}
            <Card className="p-5 bg-card border-border">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">
                  Recent Activity
                </h3>
                {/* Real-time status indicator */}
                {(searchBroadcasts.length > 0 ||
                  creditBroadcasts.length > 0) && (
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-xs text-muted-foreground">Live</span>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {/* Recent broadcasts */}
                {searchBroadcasts.slice(0, 2).map((broadcast) => {
                  const priorityDisplay = getPriorityDisplay(
                    broadcast.priority,
                  );
                  return (
                    <div
                      key={broadcast._id}
                      className="flex items-start gap-2 p-2 bg-muted/30 rounded-lg"
                    >
                      <span className="text-sm">{priorityDisplay.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={priorityDisplay.variant}
                            className="text-xs"
                          >
                            Search
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatBroadcastTime(broadcast.createdAt)}
                          </span>
                        </div>
                        <h5 className="font-medium text-sm mt-1">
                          {broadcast.title}
                        </h5>
                        <p className="text-xs text-muted-foreground truncate">
                          {broadcast.message}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Credit/system updates */}
                {creditBroadcasts.slice(0, 2).map((broadcast) => {
                  const priorityDisplay = getPriorityDisplay(
                    broadcast.priority,
                  );
                  return (
                    <div
                      key={broadcast._id}
                      className="flex items-start gap-2 p-2 bg-muted/30 rounded-lg"
                    >
                      <span className="text-sm">{priorityDisplay.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={priorityDisplay.variant}
                            className="text-xs"
                          >
                            Credits
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatBroadcastTime(broadcast.createdAt)}
                          </span>
                        </div>
                        <h5 className="font-medium text-sm mt-1">
                          {broadcast.title}
                        </h5>
                        <p className="text-xs text-muted-foreground truncate">
                          {broadcast.message}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Traditional recent activity */}
                {recentActivity.length > 0
                  ? recentActivity.slice(0, 3).map((activity, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {activity.action}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {activity.time}
                          </p>
                        </div>
                        <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                          {activity.count}
                        </span>
                      </div>
                    ))
                  : searchBroadcasts.length === 0 &&
                    creditBroadcasts.length === 0 && (
                      <div className="py-6 text-center">
                        <p className="text-muted-foreground">
                          No recent activity
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Start a search to see your activity here
                        </p>
                      </div>
                    )}
              </div>
            </Card>
          </div>

          {/* Rate Limit Warnings (if any) */}
          {rateLimitWarnings.length > 0 && (
            <Card className="p-4 bg-yellow-50 border-yellow-200 mt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-yellow-800 mb-2">
                    Rate Limit Notifications
                  </h4>
                  <div className="space-y-2">
                    {rateLimitWarnings.slice(0, 3).map((warning) => (
                      <div
                        key={warning._id}
                        className="text-sm text-yellow-700"
                      >
                        <strong>{warning.title}:</strong> {warning.message}
                        <span className="text-xs text-yellow-600 ml-2">
                          ({formatBroadcastTime(warning.createdAt)})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Recent Completed Searches */}
          {recentCompletedSearches.length > 0 && (
            <Card className="p-5 bg-card border-border mt-5">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Recently Completed
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recentCompletedSearches.slice(0, 3).map((search) => (
                  <div key={search._id} className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <h4 className="font-medium text-sm">{search.name}</h4>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>Results: {search.results?.totalFound || 0} leads</p>
                      <p>Credits: {search.creditsUsed || 0}</p>
                      <p>
                        Completed: {formatRelativeTime(search.completedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Quick Actions */}
          <Card className="p-5 bg-card border-border mt-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                Quick Actions
              </h3>
              {!hasActiveSubscription && (
                <Badge variant="outline" className="text-xs">
                  Limited features
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={!canPerformAction("search").allowed}
                onClick={() => onNavigate?.("pipeline")}
              >
                Start New Search
                {!canPerformAction("search").allowed && (
                  <span className="ml-2 text-xs">(Limit reached)</span>
                )}
              </Button>
              <Button
                variant="outline"
                className="border-border"
                disabled={!canPerformAction("export").allowed}
                onClick={() => onNavigate?.("search-history")}
              >
                Export Leads
                {!canPerformAction("export").allowed && (
                  <span className="ml-2 text-xs">(Limit reached)</span>
                )}
              </Button>
              {isStarter && (
                <Button
                  variant="default"
                  className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                  asChild
                >
                  <a href="/pricing">Upgrade Plan</a>
                </Button>
              )}
            </div>
            {(isStarter || !hasActiveSubscription) && (
              <p className="text-xs text-muted-foreground mt-3">
                {isStarter
                  ? "Upgrade to unlock full features and managed API keys"
                  : "Subscribe to a plan to access all features"}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

DashboardComponent.displayName = "Dashboard";

export const Dashboard = withErrorBoundary(
  DashboardComponent,
  "Dashboard failed to render",
);
