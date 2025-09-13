import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Zap,
  Clock,
  CheckCircle,
  AlertTriangle,
  Server,
  Database,
  Users,
  CreditCard,
  RefreshCw,
  BarChart3,
  PieChart,
  LineChart,
  Settings,
  Download,
  Bell,
  Shield,
} from "lucide-react";
import {
  usePerformanceMetrics,
  formatDuration,
  formatPercentage,
  formatUptime,
  getHealthColor,
  getAlertColor,
  type SystemAlert,
} from "@/hooks/usePerformanceMetrics";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface PerformanceMonitoringDashboardProps {
  className?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

/**
 * Comprehensive performance monitoring dashboard
 * Real-time system metrics, alerts, and performance analysis
 */
export function PerformanceMonitoringDashboard({
  className,
  autoRefresh = true,
  refreshInterval = 30000, // 30 seconds
}: PerformanceMonitoringDashboardProps) {
  const {
    metrics,
    systemAlerts,
    generateTrends,
    isLoading,
    lastUpdated,
    refreshMetrics,
  } = usePerformanceMetrics();

  const [selectedTimeRange, setSelectedTimeRange] = useState<
    "1h" | "24h" | "7d"
  >("24h");
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(
    new Set(),
  );
  const [refreshKey, setRefreshKey] = useState(0);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setRefreshKey((prev) => prev + 1);
      refreshMetrics();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refreshMetrics]);

  const acknowledgeAlert = (alertId: string) => {
    setAcknowledgedAlerts((prev) => new Set([...prev, alertId]));
  };

  const visibleAlerts = (systemAlerts || []).filter(
    (alert) => !acknowledgedAlerts.has(alert.id),
  );
  const criticalAlerts = visibleAlerts.filter(
    (alert) => alert.severity === "critical",
  );
  const highAlerts = visibleAlerts.filter((alert) => alert.severity === "high");

  if (isLoading) {
    return (
      <div className={cn("w-full space-y-6", className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-8 w-8" />
            Performance Monitoring
          </h1>
          <p className="text-muted-foreground">
            Real-time system metrics and performance analysis
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">
            Last updated: {new Date(lastUpdated).toLocaleTimeString()}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refreshMetrics();
              setRefreshKey((prev) => prev + 1);
            }}
          >
            <RefreshCw
              className={cn("h-4 w-4 mr-1", autoRefresh && "animate-spin")}
            />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const data = {
                metrics,
                alerts: systemAlerts,
                timestamp: Date.now(),
              };
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `performance-report-${new Date().toISOString().split("T")[0]}.json`;
              a.click();
            }}
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {criticalAlerts.length} critical alert
                {criticalAlerts.length > 1 ? "s" : ""} require immediate
                attention
              </span>
              <div className="flex gap-2">
                {criticalAlerts.slice(0, 2).map((alert) => (
                  <Badge
                    key={alert.id}
                    variant="destructive"
                    className="text-xs"
                  >
                    {alert.title}
                  </Badge>
                ))}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* System Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "p-2 rounded-full",
                  getHealthColor(metrics.systemMetrics.systemHealth),
                )}
              >
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">System Health</p>
                <p className="font-semibold capitalize">
                  {metrics.systemMetrics.systemHealth}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatUptime(metrics.systemMetrics.uptime)} uptime
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-blue-100">
                <Activity className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Active Operations
                </p>
                <p className="font-semibold">
                  {metrics.realTimeMetrics.activeSearches}
                </p>
                <p className="text-xs text-muted-foreground">
                  {metrics.realTimeMetrics.queuedOperations} queued
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Success Rate</p>
                <p className="font-semibold">
                  {formatPercentage(metrics.searchMetrics.successRate)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {metrics.searchMetrics.completedSearches}/
                  {metrics.searchMetrics.totalSearches} searches
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-purple-100">
                <Zap className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Response</p>
                <p className="font-semibold">
                  {formatDuration(metrics.systemMetrics.averageResponseTime)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(metrics.systemMetrics.operationsPerMinute)}/min
                  ops
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Real-time System Load */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="h-4 w-4" />
              System Load
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>CPU Usage</span>
                <span>{Math.round(metrics.realTimeMetrics.systemLoad)}%</span>
              </div>
              <Progress
                value={metrics.realTimeMetrics.systemLoad}
                className={cn(
                  "h-2",
                  metrics.realTimeMetrics.systemLoad > 80 &&
                    "progress-destructive",
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              Memory Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>RAM</span>
                <span>{Math.round(metrics.realTimeMetrics.memoryUsage)}%</span>
              </div>
              <Progress
                value={metrics.realTimeMetrics.memoryUsage}
                className={cn(
                  "h-2",
                  metrics.realTimeMetrics.memoryUsage > 80 &&
                    "progress-destructive",
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Error Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Errors</span>
                <span>
                  {formatPercentage(metrics.realTimeMetrics.errorRate)}
                </span>
              </div>
              <Progress
                value={metrics.realTimeMetrics.errorRate}
                className={cn(
                  "h-2",
                  metrics.realTimeMetrics.errorRate > 5 &&
                    "progress-destructive",
                )}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Dashboard Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview" className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            Pipeline
          </TabsTrigger>
          <TabsTrigger value="credits" className="flex items-center gap-1">
            <CreditCard className="h-4 w-4" />
            Credits
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex items-center gap-1">
            <Bell className="h-4 w-4" />
            Alerts
            {visibleAlerts.length > 0 && (
              <Badge
                variant="destructive"
                className="ml-1 text-xs h-5 w-5 p-0 rounded-full"
              >
                {visibleAlerts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="trends" className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4" />
            Trends
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Search Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Search Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">Total Searches:</span>
                  <span className="font-medium">
                    {metrics.searchMetrics.totalSearches}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Success Rate:</span>
                  <span className="font-medium">
                    {formatPercentage(metrics.searchMetrics.successRate)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Avg Completion:</span>
                  <span className="font-medium">
                    {formatDuration(
                      metrics.searchMetrics.averageCompletionTime,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Total Leads:</span>
                  <span className="font-medium">
                    {metrics.searchMetrics.totalLeadsGenerated.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* System Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  System Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">Health:</span>
                  <Badge
                    variant={
                      metrics.systemMetrics.systemHealth === "healthy"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {metrics.systemMetrics.systemHealth}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Uptime:</span>
                  <span className="font-medium">
                    {formatUptime(metrics.systemMetrics.uptime)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Operations/min:</span>
                  <span className="font-medium">
                    {Math.round(metrics.systemMetrics.operationsPerMinute)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Error Count:</span>
                  <span
                    className={cn(
                      "font-medium",
                      metrics.systemMetrics.errorCount > 5 && "text-red-600",
                    )}
                  >
                    {metrics.systemMetrics.errorCount}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Real-time Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Real-time Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">Active Searches:</span>
                  <span className="font-medium">
                    {metrics.realTimeMetrics.activeSearches}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Queue Size:</span>
                  <span className="font-medium">
                    {metrics.realTimeMetrics.queuedOperations}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">System Load:</span>
                  <span className="font-medium">
                    {Math.round(metrics.realTimeMetrics.systemLoad)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Memory Usage:</span>
                  <span className="font-medium">
                    {Math.round(metrics.realTimeMetrics.memoryUsage)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(metrics.pipelineMetrics).map(
              ([stage, stageMetrics]) => (
                <Card key={stage}>
                  <CardHeader>
                    <CardTitle className="text-sm capitalize flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      {stage.replace("Stage", " Stage")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm">Avg Time:</span>
                      <span className="font-medium">
                        {formatDuration(stageMetrics.averageTime)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Success Rate:</span>
                      <span className="font-medium">
                        {formatPercentage(stageMetrics.successRate)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Throughput:</span>
                      <span className="font-medium">
                        {stageMetrics.throughput} ops
                      </span>
                    </div>
                    <div className="mt-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span>Performance</span>
                        <span>
                          {formatPercentage(stageMetrics.successRate)}
                        </span>
                      </div>
                      <Progress
                        value={stageMetrics.successRate}
                        className={cn(
                          "h-2",
                          stageMetrics.successRate < 80 &&
                            "progress-destructive",
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              ),
            )}
          </div>
        </TabsContent>

        <TabsContent value="credits" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Used</p>
                    <p className="font-semibold">
                      {metrics.creditMetrics.totalCreditsUsed.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Avg Cost/Search
                    </p>
                    <p className="font-semibold">
                      {Math.round(metrics.creditMetrics.averageCostPerSearch)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Used Today</p>
                    <p className="font-semibold">
                      {metrics.creditMetrics.creditsUsedToday}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                  <div>
                    <p className="text-sm text-muted-foreground">Efficiency</p>
                    <p className="font-semibold">
                      {metrics.creditMetrics.creditEfficiency.toFixed(1)}{" "}
                      leads/credit
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Daily Usage Projection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">Estimated Daily Cost:</span>
                  <span className="font-medium">
                    {Math.round(metrics.creditMetrics.estimatedDailyCost)}{" "}
                    credits
                  </span>
                </div>
                <Progress
                  value={
                    (metrics.creditMetrics.creditsUsedToday /
                      metrics.creditMetrics.estimatedDailyCost) *
                    100
                  }
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  Based on current usage pattern
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          {visibleAlerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <h3 className="font-medium mb-2">All Clear!</h3>
                <p className="text-sm text-muted-foreground">
                  No active alerts. System is operating normally.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleAlerts.map((alert) => (
                <Alert key={alert.id} className={getAlertColor(alert.severity)}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{alert.title}</span>
                          <Badge variant="outline" className="text-xs">
                            {alert.severity}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {alert.type}
                          </Badge>
                        </div>
                        <p className="text-sm">{alert.message}</p>
                        <p className="text-xs mt-1 opacity-75">
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        {alert.autoResolve && (
                          <Badge variant="outline" className="text-xs">
                            Auto-resolve
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => acknowledgeAlert(alert.id)}
                        >
                          Acknowledge
                        </Button>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium">Time Range:</span>
            {(["1h", "24h", "7d"] as const).map((range) => (
              <Button
                key={range}
                size="sm"
                variant={selectedTimeRange === range ? "default" : "outline"}
                onClick={() => setSelectedTimeRange(range)}
              >
                {range === "1h"
                  ? "1 Hour"
                  : range === "24h"
                    ? "24 Hours"
                    : "7 Days"}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <LineChart className="h-4 w-4" />
                  Response Time Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-32 flex items-center justify-center bg-muted/20 rounded">
                  <p className="text-sm text-muted-foreground">
                    Chart visualization would display here
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Success Rate Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-32 flex items-center justify-center bg-muted/20 rounded">
                  <p className="text-sm text-muted-foreground">
                    Chart visualization would display here
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <PieChart className="h-4 w-4" />
                  System Load Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-32 flex items-center justify-center bg-muted/20 rounded">
                  <p className="text-sm text-muted-foreground">
                    Chart visualization would display here
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Credit Usage Pattern
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-32 flex items-center justify-center bg-muted/20 rounded">
                  <p className="text-sm text-muted-foreground">
                    Chart visualization would display here
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
