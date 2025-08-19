import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bug, 
  Activity, 
  Database, 
  Zap, 
  AlertTriangle, 
  CheckCircle,
  Clock,
  TrendingUp,
  Settings,
  Download,
  RefreshCw
} from "lucide-react";
import { CorrelationDebugPanel } from "@/components/CorrelationDebugPanel";
import { useCorrelationLogs } from "@/hooks/useCorrelationLogs";
import { useStatusBroadcasts } from "@/hooks/useStatusBroadcasts";
import { useSearches } from "@/hooks/useSearches";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DebugDashboardProps {
  className?: string;
}

/**
 * Comprehensive debugging dashboard for development and troubleshooting
 * Provides correlation tracking, performance monitoring, and system health
 */
export function DebugDashboard({ className }: DebugDashboardProps) {
  const { 
    logs, 
    errorLogs, 
    performanceLogs, 
    correlationTrees, 
    hasErrors,
    hasPerformanceData,
    clearLogs
  } = useCorrelationLogs();
  
  const { 
    broadcasts, 
    urgentBroadcasts,
    acknowledgeBroadcast 
  } = useStatusBroadcasts();
  
  const { searches } = useSearches();
  
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Auto-refresh every 5 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      setRefreshKey(prev => prev + 1);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Calculate system health metrics
  const activeSearches = searches?.filter(s => s.status === 'in_progress') || [];
  const recentErrors = errorLogs.filter(log => 
    Date.now() - log._creationTime < 5 * 60 * 1000 // Last 5 minutes
  );
  const runningOperations = correlationTrees.filter(tree => tree.status === 'running');
  
  // Performance metrics
  const avgPerformance = performanceLogs.length > 0 
    ? performanceLogs.reduce((sum, log) => sum + (log.metadata.duration || 0), 0) / performanceLogs.length
    : 0;
  
  const slowOperations = performanceLogs.filter(log => 
    (log.metadata.duration || 0) > 5000 // Slower than 5 seconds
  );

  // System health status
  const systemHealth = recentErrors.length === 0 && runningOperations.length < 10 
    ? 'healthy' : recentErrors.length > 5 ? 'critical' : 'warning';

  const exportSystemReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      systemHealth,
      metrics: {
        totalLogs: logs.length,
        errorLogs: errorLogs.length,
        performanceLogs: performanceLogs.length,
        correlationTrees: correlationTrees.length,
        activeSearches: activeSearches.length,
        runningOperations: runningOperations.length,
        avgPerformance,
        slowOperations: slowOperations.length,
      },
      recentErrors: recentErrors.slice(0, 10),
      broadcasts: broadcasts.slice(0, 20),
      performanceData: performanceLogs.slice(0, 20),
    };
    
    const dataStr = JSON.stringify(report, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `system-debug-report-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  return (
    <div className={cn("w-full space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bug className="h-8 w-8" />
            Debug Dashboard
          </h1>
          <p className="text-muted-foreground">
            System monitoring, correlation tracking, and performance analysis
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", autoRefresh && "animate-spin")} />
            {autoRefresh ? 'Auto' : 'Manual'}
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={exportSystemReport}
          >
            <Download className="h-4 w-4 mr-1" />
            Export Report
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearLogs(1)}
          >
            Clear Logs
          </Button>
        </div>
      </div>

      {/* System Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className={cn(
                "p-2 rounded-full",
                systemHealth === 'healthy' ? 'bg-green-100' :
                systemHealth === 'warning' ? 'bg-yellow-100' : 'bg-red-100'
              )}>
                {systemHealth === 'healthy' ? 
                  <CheckCircle className="h-5 w-5 text-green-600" /> :
                  <AlertTriangle className={cn("h-5 w-5", 
                    systemHealth === 'warning' ? 'text-yellow-600' : 'text-red-600'
                  )} />
                }
              </div>
              <div>
                <p className="text-sm text-muted-foreground">System Health</p>
                <p className="font-semibold capitalize">{systemHealth}</p>
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
                <p className="text-sm text-muted-foreground">Active Operations</p>
                <p className="font-semibold">{runningOperations.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-full bg-orange-100">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recent Errors</p>
                <p className="font-semibold">{recentErrors.length}</p>
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
                <p className="text-sm text-muted-foreground">Avg Performance</p>
                <p className="font-semibold">
                  {avgPerformance > 0 ? `${Math.round(avgPerformance)}ms` : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Alerts */}
      {recentErrors.length > 0 && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {recentErrors.length} errors in the last 5 minutes
              </span>
              <Badge variant="destructive">
                Needs attention
              </Badge>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {urgentBroadcasts.length > 0 && (
        <Alert className="border-orange-200 bg-orange-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {urgentBroadcasts.length} urgent system notifications
              </span>
              <Button 
                size="sm" 
                onClick={() => urgentBroadcasts.forEach(b => acknowledgeBroadcast(b._id))}
              >
                Acknowledge All
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Debug Interface */}
      <Tabs defaultValue="correlation" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="correlation" className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            Correlation
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-1">
            <Zap className="h-4 w-4" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Errors
          </TabsTrigger>
          <TabsTrigger value="broadcasts" className="flex items-center gap-1">
            <Database className="h-4 w-4" />
            Broadcasts
          </TabsTrigger>
          <TabsTrigger value="system" className="flex items-center gap-1">
            <Settings className="h-4 w-4" />
            System
          </TabsTrigger>
        </TabsList>

        <TabsContent value="correlation" className="space-y-4">
          <CorrelationDebugPanel key={refreshKey} />
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Performance Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasPerformanceData ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold">{Math.round(avgPerformance)}ms</p>
                      <p className="text-sm text-muted-foreground">Average Duration</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">{slowOperations.length}</p>
                      <p className="text-sm text-muted-foreground">Slow Operations</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">{performanceLogs.length}</p>
                      <p className="text-sm text-muted-foreground">Total Measured</p>
                    </div>
                  </div>
                  
                  {slowOperations.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium">Slow Operations (&gt;5s)</h4>
                      {slowOperations.slice(0, 10).map((log) => (
                        <div key={log._id} className="p-2 border rounded bg-yellow-50">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{log.operation}</span>
                            <Badge variant="outline">
                              {Math.round(log.metadata.duration || 0)}ms
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{log.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <Clock className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No performance data available</p>
                  <p className="text-sm text-muted-foreground">
                    Performance metrics will appear as operations complete
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          <CorrelationDebugPanel showOnlyErrors />
        </TabsContent>

        <TabsContent value="broadcasts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                System Broadcasts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {broadcasts.slice(0, 20).map((broadcast) => (
                  <div key={broadcast._id} className="p-3 border rounded">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={broadcast.priority >= 4 ? "destructive" : "secondary"}>
                          {broadcast.type}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(broadcast.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <Badge variant="outline">
                        Priority {broadcast.priority}
                      </Badge>
                    </div>
                    <h4 className="font-medium">{broadcast.title}</h4>
                    <p className="text-sm text-muted-foreground">{broadcast.message}</p>
                  </div>
                ))}
                
                {broadcasts.length === 0 && (
                  <div className="text-center py-8">
                    <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">No recent broadcasts</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">System Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span>Total Logs:</span>
                  <span className="font-medium">{logs.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Error Logs:</span>
                  <span className="font-medium text-red-600">{errorLogs.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Correlation Trees:</span>
                  <span className="font-medium">{correlationTrees.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active Searches:</span>
                  <span className="font-medium">{activeSearches.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Running Operations:</span>
                  <span className="font-medium">{runningOperations.length}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => clearLogs(0.1)} // Clear logs older than 6 minutes
                >
                  Clear Recent Logs
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => clearLogs(24)} // Clear logs older than 24 hours
                >
                  Clear Old Logs
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={exportSystemReport}
                >
                  Export Debug Report
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={() => window.location.reload()}
                >
                  Refresh Page
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}