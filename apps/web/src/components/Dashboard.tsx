import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Users,
  Mail,
  Target,
  Clock,
  Search,
  Bot,
  AlertTriangle,
  Bell,
  X,
  CheckCircle,
  Bug,
} from "lucide-react";
import { useDashboardMetrics } from "@/hooks/useDashboard";
import { useUserLeads } from "@/hooks/useLeads";
import { useSearches } from "@/hooks/useSearches";
import { useLangGraphRequests } from "@/hooks/useLangGraph";
import { useNotifications } from "@/hooks/useNotifications";
import {
  useStatusBroadcasts,
  getPriorityDisplay,
  formatBroadcastTime,
} from "@/hooks/useStatusBroadcasts";
import { SearchProgressTracker } from "@/components/SearchProgressTracker";
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

const dashboardLogger = createLogger("Dashboard");

function DashboardComponent() {
  // Real Convex hooks
  const {
    leadStats,
    searchStats,
    emailStats,
    isLoading: metricsLoading,
  } = useDashboardMetrics();
  const { stats: userLeadStats } = useUserLeads();
  const { searches } = useSearches();
  const { requests: emailRequests } = useLangGraphRequests();
  const { notifications } = useNotifications();
  const { user } = useAuth();

  // Subscription and usage hooks
  const { isStarter, hasActiveSubscription } = useSubscription();
  const {
    usage,
    isNearLimit,
    searchesPercentage,
    enrichmentsPercentage,
    exportsPercentage,
  } = useUsage();
  const { canGenerateEmails, canUseBulkOperations, canPerformAction } =
    useSubscriptionGuard();

  // Real-time broadcasting system
  const {
    urgentBroadcasts,
    searchBroadcasts,
    creditBroadcasts,
    rateLimitWarnings,
    systemAlerts,
    acknowledgeBroadcast,
    markAsRead,
    hasUrgent,
    needsAcknowledgment,
  } = useStatusBroadcasts();

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

  // Calculate real stats
  const totalLeads = userLeadStats?.totalLeads || 0;
  const leadsWithEmails = userLeadStats?.withEmails || 0;
  const totalSearches = searches?.length || 0;
  const emailsGenerated = emailRequests?.page?.length || 0;

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
        searches?.filter(
          (s) =>
            s.status === "completed" &&
            Date.now() - s.completedAt < 24 * 60 * 60 * 1000,
        ) || []
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

  const stats = useMemo(() => {
    try {
      const completedSearchCount =
        searches?.filter((s) => s.status === "completed").length ?? 0;
      const successfulEmailRequests =
        emailRequests?.page?.filter((r) => r.status === "completed").length ??
        0;

      return [
        {
          title: "Total Leads Found",
          value: totalLeads.toLocaleString(),
          change: userLeadStats?.thisWeek
            ? `+${userLeadStats.thisWeek} this week`
            : "No recent activity",
          icon: Users,
        },
        {
          title: "Leads with Emails",
          value: leadsWithEmails.toLocaleString(),
          change: `${Math.round((leadsWithEmails / Math.max(totalLeads, 1)) * 100)}% coverage`,
          icon: Target,
        },
        {
          title: "Searches Completed",
          value: totalSearches.toLocaleString(),
          change: completedSearchCount
            ? `${completedSearchCount} completed`
            : "No searches yet",
          icon: Search,
        },
        {
          title: "AI Emails Generated",
          value: emailsGenerated.toLocaleString(),
          change: successfulEmailRequests
            ? `${successfulEmailRequests} successful`
            : "None generated",
          icon: Bot,
        },
      ];
    } catch (error) {
      handleComponentError(error, "dashboard-stats", {
        totalLeads,
        leadsWithEmails,
        totalSearches,
        emailsGenerated,
      });
      return [
        {
          title: "Total Leads Found",
          value: totalLeads.toLocaleString(),
          change: "Data unavailable",
          icon: Users,
        },
        {
          title: "Leads with Emails",
          value: leadsWithEmails.toLocaleString(),
          change: "Data unavailable",
          icon: Target,
        },
        {
          title: "Searches Completed",
          value: totalSearches.toLocaleString(),
          change: "Data unavailable",
          icon: Search,
        },
        {
          title: "AI Emails Generated",
          value: emailsGenerated.toLocaleString(),
          change: "Data unavailable",
          icon: Bot,
        },
      ];
    }
  }, [
    emailRequests?.page,
    emailsGenerated,
    handleComponentError,
    leadsWithEmails,
    totalLeads,
    totalSearches,
    userLeadStats?.thisWeek,
    searches,
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
                  <SearchProgressTracker
                    key={search._id}
                    searchId={search._id}
                    compact
                    showHistory={false}
                  />
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {stats.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <Card
                      key={stat.title}
                      className="p-6 bg-card border-border"
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Performance Chart */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Lead Generation Trend
              </h3>
              <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg">
                <p className="text-muted-foreground">
                  Chart visualization would go here
                </p>
              </div>
            </Card>

            {/* Recent Activity & Real-time Updates */}
            <Card className="p-6 bg-card border-border">
              <div className="flex items-center justify-between mb-4">
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

              <div className="space-y-4">
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
                      <div className="text-center py-8">
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
            <Card className="p-6 bg-card border-border mt-6">
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
                        Completed: {formatBroadcastTime(search.completedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Quick Actions */}
          <Card className="p-6 bg-card border-border mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Quick Actions
              </h3>
              {!hasActiveSubscription && (
                <Badge variant="outline" className="text-xs">
                  Limited features
                </Badge>
              )}
            </div>
            <div className="flex gap-4 flex-wrap">
              <Button
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={!canPerformAction("search").allowed}
              >
                Start New Search
                {!canPerformAction("search").allowed && (
                  <span className="ml-2 text-xs">(Limit reached)</span>
                )}
              </Button>
              <Button
                variant="outline"
                className="border-border"
                disabled={!canGenerateEmails}
              >
                Create Email Template
                {!canGenerateEmails && (
                  <span className="ml-2 text-xs">(Upgrade needed)</span>
                )}
              </Button>
              <Button
                variant="outline"
                className="border-border"
                disabled={!canPerformAction("export").allowed}
              >
                Export Leads
                {!canPerformAction("export").allowed && (
                  <span className="ml-2 text-xs">(Limit reached)</span>
                )}
              </Button>
              {canUseBulkOperations && (
                <Button variant="outline" className="border-border">
                  Bulk Operations
                </Button>
              )}
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
