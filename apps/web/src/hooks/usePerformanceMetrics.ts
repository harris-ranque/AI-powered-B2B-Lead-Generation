import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger('usePerformanceMetrics');

export interface PerformanceMetrics {
  searchMetrics: {
    totalSearches: number;
    completedSearches: number;
    failedSearches: number;
    averageCompletionTime: number;
    successRate: number;
    averageLeadsPerSearch: number;
    totalLeadsGenerated: number;
  };
  systemMetrics: {
    totalCorrelationLogs: number;
    errorCount: number;
    operationsPerMinute: number;
    averageResponseTime: number;
    systemHealth: 'healthy' | 'warning' | 'critical';
    uptime: number;
  };
  pipelineMetrics: {
    discoveryStage: {
      averageTime: number;
      successRate: number;
      throughput: number;
    };
    enrichmentStage: {
      averageTime: number;
      successRate: number;
      throughput: number;
    };
    analysisStage: {
      averageTime: number;
      successRate: number;
      throughput: number;
    };
  };
  creditMetrics: {
    totalCreditsUsed: number;
    averageCostPerSearch: number;
    creditsUsedToday: number;
    estimatedDailyCost: number;
    creditEfficiency: number;
  };
  realTimeMetrics: {
    activeSearches: number;
    queuedOperations: number;
    systemLoad: number;
    memoryUsage: number;
    errorRate: number;
  };
}

export interface PerformanceTrend {
  timestamp: number;
  metric: string;
  value: number;
  label: string;
}

export interface SystemAlert {
  id: string;
  type: 'performance' | 'error' | 'capacity' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  autoResolve: boolean;
}

/**
 * Hook for comprehensive performance monitoring and metrics
 */
export function usePerformanceMetrics() {
  // Get search data for metrics calculation
  const searches = useQuery(api.search.queries.getUserSearches);
  
  // Get correlation logs for system metrics
  const logs = useQuery(api.lib.logging.getRecentLogs, {
    limit: 1000,
    includeDebug: false,
  });
  
  // Get performance-specific logs
  const performanceLogs = useQuery(api.lib.logging.getPerformanceLogs, {
    limit: 500,
    timeWindowHours: 24,
  });
  
  // Get credit usage data
  const creditUsage = useQuery(api.billing.queries.getCreditUsage);
  
  // Get system status
  const systemStatus = useQuery(api.admin.queries.getSystemStatus);
  
  // Local state for real-time updates
  const [realTimeData, setRealTimeData] = useState({
    activeSearches: 0,
    queuedOperations: 0,
    systemLoad: 0,
    memoryUsage: 0,
    errorRate: 0,
  });

  useEffect(() => {
    if (searches && logs) {
      logger.debug('Performance metrics data loaded', {
        searches: searches.searches?.length,
        logs: logs.length,
        performanceLogs: performanceLogs?.length,
      });
    }
  }, [searches, logs, performanceLogs]);

  // Calculate search metrics
  const searchMetrics = useMemo(() => {
    if (!searches?.searches) {
      return {
        totalSearches: 0,
        completedSearches: 0,
        failedSearches: 0,
        averageCompletionTime: 0,
        successRate: 0,
        averageLeadsPerSearch: 0,
        totalLeadsGenerated: 0,
      };
    }

    const totalSearches = searches.searches.length;
    const completedSearches = searches.searches.filter(s => s.status === 'completed').length;
    const failedSearches = searches.searches.filter(s => s.status === 'failed').length;
    
    const completionTimes = searches.searches
      .filter(s => s.status === 'completed' && s.completedAt)
      .map(s => s.completedAt - s._creationTime);
    
    const averageCompletionTime = completionTimes.length > 0 
      ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length
      : 0;

    const successRate = totalSearches > 0 ? (completedSearches / totalSearches) * 100 : 0;
    
    const totalLeadsGenerated = searches.searches
      .filter(s => s.results?.totalFound)
      .reduce((sum, s) => sum + (s.results?.totalFound || 0), 0);
    
    const averageLeadsPerSearch = completedSearches > 0 ? totalLeadsGenerated / completedSearches : 0;

    return {
      totalSearches,
      completedSearches,
      failedSearches,
      averageCompletionTime,
      successRate,
      averageLeadsPerSearch,
      totalLeadsGenerated,
    };
  }, [searches]);

  // Calculate system metrics
  const systemMetrics = useMemo(() => {
    if (!logs) {
      return {
        totalCorrelationLogs: 0,
        errorCount: 0,
        operationsPerMinute: 0,
        averageResponseTime: 0,
        systemHealth: 'healthy' as const,
        uptime: 0,
      };
    }

    const errorCount = logs.filter(log => log.level === 'error').length;
    const recentLogs = logs.filter(log => Date.now() - log._creationTime < 60 * 60 * 1000); // Last hour
    const operationsPerMinute = recentLogs.length / 60;
    
    const responseTimes = logs
      .filter(log => log.metadata.duration !== undefined)
      .map(log => log.metadata.duration!);
    
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
      : 0;

    // Determine system health based on error rate and response time
    const errorRate = logs.length > 0 ? (errorCount / logs.length) * 100 : 0;
    let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    if (errorRate > 5 || averageResponseTime > 5000) {
      systemHealth = 'critical';
    } else if (errorRate > 2 || averageResponseTime > 2000) {
      systemHealth = 'warning';
    }

    // Calculate uptime (simplified - time since oldest log)
    const oldestLog = logs.reduce((oldest, log) => 
      log._creationTime < oldest._creationTime ? log : oldest, 
      logs[0]
    );
    const uptime = oldestLog ? Date.now() - oldestLog._creationTime : 0;

    return {
      totalCorrelationLogs: logs.length,
      errorCount,
      operationsPerMinute,
      averageResponseTime,
      systemHealth,
      uptime,
    };
  }, [logs]);

  // Calculate pipeline metrics
  const pipelineMetrics = useMemo(() => {
    if (!performanceLogs) {
      return {
        discoveryStage: { averageTime: 0, successRate: 0, throughput: 0 },
        enrichmentStage: { averageTime: 0, successRate: 0, throughput: 0 },
        analysisStage: { averageTime: 0, successRate: 0, throughput: 0 },
      };
    }

    const calculateStageMetrics = (stage: string) => {
      const stageLogs = performanceLogs.filter(log => 
        log.operation.toLowerCase().includes(stage.toLowerCase())
      );
      
      const times = stageLogs
        .filter(log => log.metadata.duration !== undefined)
        .map(log => log.metadata.duration!);
      
      const averageTime = times.length > 0 
        ? times.reduce((sum, time) => sum + time, 0) / times.length 
        : 0;
      
      const completedOperations = stageLogs.filter(log => 
        log.message.includes('completed') || log.message.includes('finished')
      ).length;
      
      const successRate = stageLogs.length > 0 
        ? (completedOperations / stageLogs.length) * 100 
        : 0;
      
      const throughput = stageLogs.length; // Operations in time window
      
      return { averageTime, successRate, throughput };
    };

    return {
      discoveryStage: calculateStageMetrics('discovery'),
      enrichmentStage: calculateStageMetrics('enrichment'),
      analysisStage: calculateStageMetrics('analysis'),
    };
  }, [performanceLogs]);

  // Calculate credit metrics
  const creditMetrics = useMemo(() => {
    if (!creditUsage || !searches?.searches) {
      return {
        totalCreditsUsed: 0,
        averageCostPerSearch: 0,
        creditsUsedToday: 0,
        estimatedDailyCost: 0,
        creditEfficiency: 0,
      };
    }

    const totalCreditsUsed = creditUsage.totalCreditsUsed || 0;
    const completedSearches = searches.searches.filter(s => s.status === 'completed').length;
    const averageCostPerSearch = completedSearches > 0 ? totalCreditsUsed / completedSearches : 0;
    
    // Calculate today's usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySearches = searches.searches.filter(s => 
      s._creationTime >= today.getTime() && s.status === 'completed'
    );
    const creditsUsedToday = todaySearches.reduce((sum, s) => sum + (s.creditsUsed || 0), 0);
    
    // Estimate daily cost based on current hour
    const currentHour = new Date().getHours();
    const estimatedDailyCost = currentHour > 0 ? (creditsUsedToday / currentHour) * 24 : creditsUsedToday;
    
    // Calculate efficiency (leads per credit)
    const totalLeads = searchMetrics.totalLeadsGenerated;
    const creditEfficiency = totalCreditsUsed > 0 ? totalLeads / totalCreditsUsed : 0;

    return {
      totalCreditsUsed,
      averageCostPerSearch,
      creditsUsedToday,
      estimatedDailyCost,
      creditEfficiency,
    };
  }, [creditUsage, searches, searchMetrics]);

  // Update real-time metrics
  useEffect(() => {
    const updateRealTimeMetrics = () => {
      if (!searches?.searches || !logs) return;
      
      const activeSearches = searches.searches.filter(s => 
        s.status === 'in_progress' || s.status === 'pending'
      ).length;
      
      const recentErrors = logs.filter(log => 
        log.level === 'error' && Date.now() - log._creationTime < 5 * 60 * 1000
      ).length;
      
      const errorRate = logs.length > 0 ? (recentErrors / Math.min(logs.length, 100)) * 100 : 0;
      
      setRealTimeData({
        activeSearches,
        queuedOperations: 0, // TODO: Get from real queue monitoring
        systemLoad: Math.min(50 + (activeSearches * 10), 100), // Based on active searches
        memoryUsage: Math.min(30 + (activeSearches * 5), 100), // Based on active searches
        errorRate,
      });
    };

    updateRealTimeMetrics();
    const interval = setInterval(updateRealTimeMetrics, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, [searches, logs]);

  // Generate system alerts
  const systemAlerts = useMemo((): SystemAlert[] => {
    const alerts: SystemAlert[] = [];
    
    if (systemMetrics.errorCount > 10) {
      alerts.push({
        id: 'high-error-count',
        type: 'error',
        severity: 'high',
        title: 'High Error Count',
        message: `${systemMetrics.errorCount} errors detected in recent logs`,
        timestamp: Date.now(),
        acknowledged: false,
        autoResolve: false,
      });
    }
    
    if (systemMetrics.averageResponseTime > 3000) {
      alerts.push({
        id: 'slow-response',
        type: 'performance',
        severity: 'medium',
        title: 'Slow Response Times',
        message: `Average response time is ${Math.round(systemMetrics.averageResponseTime)}ms`,
        timestamp: Date.now(),
        acknowledged: false,
        autoResolve: true,
      });
    }
    
    if (realTimeData.systemLoad > 80) {
      alerts.push({
        id: 'high-system-load',
        type: 'capacity',
        severity: 'high',
        title: 'High System Load',
        message: `System load at ${Math.round(realTimeData.systemLoad)}%`,
        timestamp: Date.now(),
        acknowledged: false,
        autoResolve: true,
      });
    }
    
    if (searchMetrics.successRate < 80 && searchMetrics.totalSearches > 5) {
      alerts.push({
        id: 'low-success-rate',
        type: 'performance',
        severity: 'medium',
        title: 'Low Search Success Rate',
        message: `Success rate is ${Math.round(searchMetrics.successRate)}%`,
        timestamp: Date.now(),
        acknowledged: false,
        autoResolve: false,
      });
    }

    return alerts;
  }, [systemMetrics, realTimeData, searchMetrics]);

  // Generate performance trends
  const generateTrends = useCallback((metric: keyof PerformanceMetrics, timeRange: '1h' | '24h' | '7d' = '24h'): PerformanceTrend[] => {
    // This would typically come from historical data
    // For now, generating simulated trend data
    const points = timeRange === '1h' ? 12 : timeRange === '24h' ? 24 : 168;
    const interval = timeRange === '1h' ? 5 * 60 * 1000 : timeRange === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    
    return Array.from({ length: points }, (_, i) => ({
      timestamp: Date.now() - (points - i - 1) * interval,
      metric: metric as string,
      value: 0, // TODO: Replace with real metrics data from backend
      label: new Date(Date.now() - (points - i - 1) * interval).toLocaleTimeString(),
    }));
  }, []);

  // Combined metrics object
  const metrics: PerformanceMetrics = {
    searchMetrics,
    systemMetrics,
    pipelineMetrics,
    creditMetrics,
    realTimeMetrics: realTimeData,
  };

  return {
    metrics,
    systemAlerts,
    generateTrends,
    isLoading: searches === undefined || logs === undefined,
    lastUpdated: Date.now(),
    refreshMetrics: () => {
      // Force refresh - in real implementation this would trigger data refresh
      logger.info('Refreshing performance metrics');
    },
  };
}

/**
 * Utility functions for performance metrics
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  } else if (milliseconds < 60000) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

export function formatPercentage(value: number): string {
  return `${Math.round(value * 100) / 100}%`;
}

export function formatUptime(milliseconds: number): string {
  const days = Math.floor(milliseconds / (24 * 60 * 60 * 1000));
  const hours = Math.floor((milliseconds % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000));
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export function getHealthColor(health: 'healthy' | 'warning' | 'critical'): string {
  switch (health) {
    case 'healthy':
      return 'text-green-600 bg-green-50 border-green-200';
    case 'warning':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'critical':
      return 'text-red-600 bg-red-50 border-red-200';
  }
}

export function getAlertColor(severity: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (severity) {
    case 'low':
      return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'medium':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'high':
      return 'text-orange-600 bg-orange-50 border-orange-200';
    case 'critical':
      return 'text-red-600 bg-red-50 border-red-200';
  }
}