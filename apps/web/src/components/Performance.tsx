import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Mail,
  Users,
  Target,
  DollarSign,
  Calendar,
  BarChart3,
  Loader2,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { usePerformanceMetrics } from "@/hooks/usePerformanceMetrics";
import {
  formatDuration,
  formatPercentage,
} from "@/hooks/usePerformanceMetrics";

export function Performance() {
  // Get real performance data
  const { metrics: performanceData, isLoading: performanceLoading } =
    usePerformanceMetrics();
  const searchStats = useQuery(api.search.queries.getSearchStats);
  const userSearches = useQuery(api.search.queries.getUserSearches, {
    limit: 10,
  });

  // Calculate dynamic metrics from real data
  const isLoading =
    performanceLoading ||
    searchStats === undefined ||
    userSearches === undefined;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const metrics = [
    {
      title: "Total Searches",
      value: searchStats?.totalSearches?.toString() || "0",
      change: "+0%", // Could calculate from historical data
      trend: "up" as const,
      period: "all time",
      icon: Users,
    },
    {
      title: "Success Rate",
      value: searchStats?.successRate ? `${searchStats.successRate}%` : "0%",
      change: "+0%", // Could calculate from historical data
      trend: "up" as const,
      period: "search completion",
      icon: Target,
    },
    {
      title: "Leads Discovered",
      value: searchStats?.totalLeadsDiscovered?.toString() || "0",
      change: "+0%", // Could calculate from historical data
      trend: "up" as const,
      period: "total leads",
      icon: TrendingUp,
    },
    {
      title: "Credits Used",
      value: searchStats?.totalCreditsUsed?.toString() || "0",
      change: "+0%", // Could calculate from historical data
      trend: "up" as const,
      period: "total spent",
      icon: DollarSign,
    },
    {
      title: "Avg Response Time",
      value: performanceData?.systemMetrics
        ? formatDuration(performanceData.systemMetrics.averageResponseTime)
        : "0ms",
      change: "+0%", // Could calculate from historical data
      trend: "up" as const,
      period: "system performance",
      icon: BarChart3,
    },
    {
      title: "Active Searches",
      value:
        performanceData?.realTimeMetrics?.activeSearches?.toString() || "0",
      change: "+0%", // Real-time data
      trend: "up" as const,
      period: "currently running",
      icon: Mail,
    },
  ];

  // Use real recent search data
  const recentPerformance = (userSearches?.searches || [])
    .slice(0, 5)
    .map((search) => ({
      date: new Date(search._creationTime).toISOString().split("T")[0],
      leads: search.results?.totalFound || 0,
      emails: search.results?.totalEnriched || 0,
      responses: 0, // This would need email campaign tracking
      conversions: search.status === "completed" ? 1 : 0,
      searchName: search.name,
      status: search.status,
    }));

  // Use real search data for "top performing searches"
  const topPerformingSearches = (userSearches?.searches || [])
    .filter(
      (search) =>
        search.status === "completed" && (search.results?.totalFound || 0) > 0,
    )
    .sort((a, b) => (b.results?.totalFound || 0) - (a.results?.totalFound || 0))
    .slice(0, 3)
    .map((search) => ({
      name: search.name,
      sent: search.results?.totalFound || 0,
      opens: search.results?.totalEnriched || 0,
      responses: 0, // Would need campaign tracking
      rate: search.results?.totalFound
        ? `${Math.round(((search.results?.totalEnriched || 0) / search.results.totalFound) * 100)}%`
        : "0%",
    }));

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-6xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">
              Performance
            </h1>
            <p className="text-muted-foreground">
              Track your lead generation and email campaign performance.
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              const isPositive = metric.trend === "up";
              const TrendIcon = isPositive ? TrendingUp : TrendingDown;

              return (
                <Card key={metric.title} className="p-6 bg-card border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div
                      className={`flex items-center gap-1 text-sm ${
                        isPositive ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      <TrendIcon className="h-4 w-4" />
                      <span>{metric.change}</span>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {metric.title}
                  </h3>
                  <div className="text-3xl font-bold text-foreground mb-1">
                    {metric.value}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {metric.period}
                  </p>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Daily Performance */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Daily Performance (Last 5 Days)
              </h3>
              <div className="space-y-3">
                {recentPerformance.length > 0 ? (
                  recentPerformance.map((day, index) => (
                    <div
                      key={day.date}
                      className="flex items-center justify-between p-3 bg-muted/20 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <span className="text-sm font-medium text-foreground">
                            {new Date(day.date).toLocaleDateString()}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {day.searchName}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <span className="text-muted-foreground">
                          {day.leads} leads
                        </span>
                        <span className="text-muted-foreground">
                          {day.emails} enriched
                        </span>
                        <Badge
                          variant={
                            day.status === "completed"
                              ? "default"
                              : day.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="bg-primary/10 text-primary"
                        >
                          {day.status}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-6">
                    <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No recent searches</p>
                    <p className="text-sm">
                      Your search history will appear here
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Top Performing Searches */}
            <Card className="p-6 bg-card border-border">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                Top Performing Searches
              </h3>
              <div className="space-y-4">
                {topPerformingSearches.length > 0 ? (
                  topPerformingSearches.map((search, index) => (
                    <div
                      key={search.name}
                      className="flex items-center justify-between p-3 bg-muted/20 rounded-lg"
                    >
                      <div>
                        <div className="font-medium text-foreground">
                          {search.name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {search.sent} leads found • {search.opens} enriched •{" "}
                          {search.responses} responses
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="bg-primary/10 text-primary"
                      >
                        {search.rate}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-6">
                    <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No completed searches yet</p>
                    <p className="text-sm">
                      Start a search to see performance data
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Performance Chart Placeholder */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Performance Trends
            </h3>
            <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg">
              <div className="text-center">
                <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">
                  Interactive performance charts would be displayed here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Showing trends for leads, emails, responses, and conversions
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
