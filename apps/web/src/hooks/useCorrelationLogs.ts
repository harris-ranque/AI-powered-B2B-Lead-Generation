import { useQuery, useMutation } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { useCallback, useEffect } from "react";
import { createLogger, timeOperation } from "@/utils/logger";

const logger = createLogger('useCorrelationLogs');

export interface CorrelationLog {
  _id: Id<"correlationLogs">;
  correlationId: string;
  parentCorrelationId?: string;
  operation: string;
  phase: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: any;
  metadata: {
    userId?: Id<"users">;
    searchId?: Id<"searches">;
    leadId?: Id<"leads">;
    duration?: number;
    startTime?: number;
    endTime?: number;
    error?: string;
    stackTrace?: string;
  };
  _creationTime: number;
}

export interface CorrelationTree {
  correlationId: string;
  operation: string;
  logs: CorrelationLog[];
  children: CorrelationTree[];
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'failed';
  level: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Hook for accessing correlation logs and debugging data
 */
export function useCorrelationLogs() {
  const logs = useQuery(api.lib.logging.getRecentLogs, {
    limit: 100,
    includeDebug: true,
  });

  const searchLogs = useQuery(api.lib.logging.getSearchLogs, {
    limit: 50,
  });

  const clearLogsAction = useMutation(api.lib.logging.clearOldLogs);

  useEffect(() => {
    if (logs) {
      logger.debug('Correlation logs loaded', {
        count: logs.length,
        levels: logs.reduce((acc, log) => {
          acc[log.level] = (acc[log.level] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      });
    }
  }, [logs]);

  const clearLogs = useCallback(async (olderThanHours = 24) => {
    logger.info('Clearing old correlation logs', { olderThanHours });
    return timeOperation('clearLogs', () => 
      clearLogsAction({ olderThanHours })
    );
  }, [clearLogsAction]);

  // Build correlation tree from logs
  const buildCorrelationTree = useCallback((logs: CorrelationLog[]): CorrelationTree[] => {
    const correlationMap = new Map<string, CorrelationLog[]>();
    const parentMap = new Map<string, string>();

    // Group logs by correlation ID and track parent relationships
    logs.forEach(log => {
      if (!correlationMap.has(log.correlationId)) {
        correlationMap.set(log.correlationId, []);
      }
      correlationMap.get(log.correlationId)!.push(log);

      if (log.parentCorrelationId) {
        parentMap.set(log.correlationId, log.parentCorrelationId);
      }
    });

    // Build tree structure
    const buildNode = (correlationId: string): CorrelationTree | null => {
      const nodeLogs = correlationMap.get(correlationId) || [];
      if (nodeLogs.length === 0) return null;

      // Sort logs by creation time
      nodeLogs.sort((a, b) => a._creationTime - b._creationTime);

      const firstLog = nodeLogs[0];
      const lastLog = nodeLogs[nodeLogs.length - 1];
      
      // Determine status and level
      const hasError = nodeLogs.some(log => log.level === 'error');
      const hasWarn = nodeLogs.some(log => log.level === 'warn');
      const hasRunning = nodeLogs.some(log => 
        log.message.includes('started') || log.message.includes('processing')
      );
      const hasCompleted = nodeLogs.some(log => 
        log.message.includes('completed') || log.message.includes('finished')
      );

      const status: CorrelationTree['status'] = hasError ? 'failed' : 
        hasCompleted ? 'completed' : 'running';
      const level: CorrelationTree['level'] = hasError ? 'error' : 
        hasWarn ? 'warn' : 'info';

      // Calculate duration
      const startTime = firstLog.metadata.startTime || firstLog._creationTime;
      const endTime = lastLog.metadata.endTime || 
        (hasCompleted ? lastLog._creationTime : undefined);
      const duration = endTime ? endTime - startTime : undefined;

      // Find children
      const children: CorrelationTree[] = [];
      for (const [childId, parentId] of parentMap.entries()) {
        if (parentId === correlationId) {
          const childNode = buildNode(childId);
          if (childNode) {
            children.push(childNode);
          }
        }
      }

      return {
        correlationId,
        operation: firstLog.operation,
        logs: nodeLogs,
        children,
        startTime,
        endTime,
        duration,
        status,
        level,
      };
    };

    // Find root correlation IDs (those without parents)
    const rootIds = Array.from(correlationMap.keys()).filter(id => 
      !parentMap.has(id)
    );

    return rootIds.map(buildNode).filter(Boolean) as CorrelationTree[];
  }, []);

  // Filter logs by search ID
  const getSearchLogs = useCallback((searchId: Id<"searches">) => {
    return logs?.filter(log => log.metadata.searchId === searchId) || [];
  }, [logs]);

  // Filter logs by operation
  const getOperationLogs = useCallback((operation: string) => {
    return logs?.filter(log => log.operation === operation) || [];
  }, [logs]);

  // Get error logs
  const errorLogs = logs?.filter(log => log.level === 'error') || [];

  // Get performance logs (with duration data)
  const performanceLogs = logs?.filter(log => 
    log.metadata.duration !== undefined
  ) || [];

  // Build correlation trees
  const correlationTrees = logs ? buildCorrelationTree(logs) : [];

  return {
    logs: logs || [],
    searchLogs: searchLogs || [],
    errorLogs,
    performanceLogs,
    correlationTrees,
    getSearchLogs,
    getOperationLogs,
    buildCorrelationTree,
    clearLogs,
    isLoading: logs === undefined,
    hasErrors: errorLogs.length > 0,
    hasPerformanceData: performanceLogs.length > 0,
  };
}

/**
 * Hook for real-time correlation tracking
 */
export function useCorrelationTracker(correlationId?: string) {
  const { logs, correlationTrees } = useCorrelationLogs();

  // Find the specific correlation tree
  const correlationTree = correlationTrees.find(tree => 
    tree.correlationId === correlationId
  );

  // Get all logs for this correlation (including children)
  const correlationLogs = logs.filter(log => 
    log.correlationId === correlationId ||
    log.parentCorrelationId === correlationId
  );

  // Real-time status
  const isActive = correlationTree?.status === 'running';
  const hasErrors = correlationTree?.level === 'error';
  const progress = correlationTree ? calculateProgress(correlationTree) : 0;

  return {
    correlationTree,
    correlationLogs,
    isActive,
    hasErrors,
    progress,
    isLoading: logs.length === 0 && correlationId !== undefined,
  };
}

/**
 * Calculate progress percentage for a correlation tree
 */
function calculateProgress(tree: CorrelationTree): number {
  const calculateNodeProgress = (node: CorrelationTree): number => {
    if (node.status === 'completed') return 100;
    if (node.status === 'failed') return 100; // Failed is still "complete"
    
    // For running operations, estimate based on common patterns
    const completedSteps = node.logs.filter(log => 
      log.message.includes('completed') || 
      log.message.includes('finished') ||
      log.message.includes('done')
    ).length;
    
    const totalSteps = Math.max(node.logs.length, 4); // Assume at least 4 steps
    return Math.min((completedSteps / totalSteps) * 100, 90); // Cap at 90% for running
  };

  if (tree.children.length === 0) {
    return calculateNodeProgress(tree);
  }

  // Calculate weighted average of children
  const childProgresses = tree.children.map(calculateNodeProgress);
  const totalProgress = childProgresses.reduce((sum, progress) => sum + progress, 0);
  const avgChildProgress = totalProgress / tree.children.length;
  
  const ownProgress = calculateNodeProgress(tree);
  
  // Weight: 30% own, 70% children
  return Math.round(ownProgress * 0.3 + avgChildProgress * 0.7);
}

/**
 * Format duration for display
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  } else if (milliseconds < 60000) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Get log level color
 */
export function getLogLevelColor(level: string): string {
  switch (level) {
    case 'error':
      return 'text-red-600 bg-red-50 border-red-200';
    case 'warn':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'info':
      return 'text-blue-600 bg-blue-50 border-blue-200';
    case 'debug':
      return 'text-gray-600 bg-gray-50 border-gray-200';
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

/**
 * Get operation status icon
 */
export function getOperationStatusIcon(status: CorrelationTree['status']) {
  switch (status) {
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'running':
      return '🔄';
    default:
      return '⏸️';
  }
}