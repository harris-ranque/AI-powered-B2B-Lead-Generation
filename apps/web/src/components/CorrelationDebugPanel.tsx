import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { 
  ChevronDown, 
  ChevronRight, 
  Search, 
  RefreshCw, 
  Trash2, 
  Download,
  Filter,
  Clock,
  Activity,
  AlertTriangle,
  Bug,
  Zap,
  Eye,
  EyeOff
} from "lucide-react";
import { 
  useCorrelationLogs, 
  useCorrelationTracker,
  formatDuration,
  getLogLevelColor,
  getOperationStatusIcon,
  type CorrelationTree,
  type CorrelationLog 
} from "@/hooks/useCorrelationLogs";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface CorrelationDebugPanelProps {
  searchId?: string;
  correlationId?: string;
  compact?: boolean;
  showOnlyErrors?: boolean;
  className?: string;
}

/**
 * Comprehensive correlation debugging panel for operation tracing
 * Provides real-time correlation tree visualization and log analysis
 */
export function CorrelationDebugPanel({
  searchId,
  correlationId,
  compact = false,
  showOnlyErrors = false,
  className
}: CorrelationDebugPanelProps) {
  const {
    logs,
    errorLogs,
    performanceLogs,
    correlationTrees,
    getSearchLogs,
    getOperationLogs,
    clearLogs,
    isLoading,
    hasErrors,
    hasPerformanceData
  } = useCorrelationLogs();

  const [searchFilter, setSearchFilter] = useState("");
  const [operationFilter, setOperationFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filter logs based on current filters
  const filteredLogs = useMemo(() => {
    let filtered = logs;

    if (searchId) {
      filtered = getSearchLogs(searchId as any);
    }

    if (showOnlyErrors) {
      filtered = filtered.filter(log => log.level === 'error');
    }

    if (searchFilter) {
      filtered = filtered.filter(log =>
        log.correlationId.toLowerCase().includes(searchFilter.toLowerCase()) ||
        log.operation.toLowerCase().includes(searchFilter.toLowerCase()) ||
        log.message.toLowerCase().includes(searchFilter.toLowerCase())
      );
    }

    if (operationFilter) {
      filtered = filtered.filter(log =>
        log.operation.toLowerCase().includes(operationFilter.toLowerCase())
      );
    }

    if (levelFilter !== "all") {
      filtered = filtered.filter(log => log.level === levelFilter);
    }

    if (!showDebugLogs) {
      filtered = filtered.filter(log => log.level !== 'debug');
    }

    return filtered;
  }, [logs, searchId, showOnlyErrors, searchFilter, operationFilter, levelFilter, showDebugLogs, getSearchLogs]);

  // Filter correlation trees
  const filteredTrees = useMemo(() => {
    return correlationTrees.filter(tree => {
      if (correlationId && tree.correlationId !== correlationId) {
        return false;
      }
      if (searchFilter) {
        return tree.correlationId.toLowerCase().includes(searchFilter.toLowerCase()) ||
               tree.operation.toLowerCase().includes(searchFilter.toLowerCase());
      }
      return true;
    });
  }, [correlationTrees, correlationId, searchFilter]);

  const toggleNodeExpansion = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const exportLogs = () => {
    const dataStr = JSON.stringify(filteredLogs, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `correlation-logs-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  if (isLoading) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Loading correlation data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4" />
              <span className="text-sm font-medium">Debug Panel</span>
              {hasErrors && (
                <Badge variant="destructive" className="text-xs">
                  {errorLogs.length} errors
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {logs.length} logs
              </Badge>
              <Badge variant="outline" className="text-xs">
                {correlationTrees.length} traces
              </Badge>
            </div>
          </div>
          
          {hasErrors && (
            <Alert className="mt-3 bg-red-50 border-red-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {errorLogs.length} errors detected in recent operations
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Correlation Debug Panel
            {autoRefresh && (
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={hasErrors ? "destructive" : "secondary"}>
              {logs.length} logs
            </Badge>
            <Badge variant="outline">
              {correlationTrees.length} traces
            </Badge>
            {hasPerformanceData && (
              <Badge variant="outline" className="text-green-600">
                <Zap className="h-3 w-3 mr-1" />
                Perf data
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search correlation IDs, operations..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-64"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="px-3 py-1 border rounded-md text-sm"
            >
              <option value="all">All Levels</option>
              <option value="error">Errors</option>
              <option value="warn">Warnings</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDebugLogs(!showDebugLogs)}
          >
            {showDebugLogs ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            Debug Logs
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Activity className="h-4 w-4 mr-1" />
            {autoRefresh ? 'Pause' : 'Resume'}
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={exportLogs}
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearLogs(1)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear Old
          </Button>
        </div>

        {/* Error Summary */}
        {hasErrors && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {errorLogs.length} errors detected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLevelFilter("error")}
                >
                  View Errors
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Correlation Trees */}
        {filteredTrees.length > 0 && (
          <div className="space-y-4">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Operation Traces ({filteredTrees.length})
            </h4>
            
            <div className="space-y-3">
              {filteredTrees.map((tree) => (
                <CorrelationTreeNode
                  key={tree.correlationId}
                  tree={tree}
                  expanded={expandedNodes.has(tree.correlationId)}
                  onToggle={() => toggleNodeExpansion(tree.correlationId)}
                  level={0}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recent Logs */}
        <div className="space-y-4">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Logs ({filteredLogs.length})
          </h4>
          
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredLogs.slice(0, 50).map((log) => (
              <LogEntry key={log._id} log={log} />
            ))}
            
            {filteredLogs.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Bug className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No logs match current filters</p>
                <p className="text-sm">Try adjusting your search criteria</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Individual correlation tree node component
 */
function CorrelationTreeNode({
  tree,
  expanded,
  onToggle,
  level = 0
}: {
  tree: CorrelationTree;
  expanded: boolean;
  onToggle: () => void;
  level: number;
}) {
  const { progress } = useCorrelationTracker(tree.correlationId);
  
  const levelColors = {
    error: 'border-red-300 bg-red-50',
    warn: 'border-yellow-300 bg-yellow-50',
    info: 'border-blue-300 bg-blue-50',
    debug: 'border-gray-300 bg-gray-50',
  };

  return (
    <div className={cn("border rounded-lg p-3", levelColors[tree.level])}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="h-6 w-6 p-0"
          >
            {tree.children.length > 0 ? (
              expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <div className="w-4 h-4" />
            )}
          </Button>
          
          <span className="text-lg">{getOperationStatusIcon(tree.status)}</span>
          
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{tree.operation}</span>
              <Badge variant="outline" className="text-xs">
                {tree.correlationId.slice(0, 8)}...
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {tree.duration ? formatDuration(tree.duration) : 'Running...'}
              {tree.children.length > 0 && ` • ${tree.children.length} sub-operations`}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant={tree.status === 'failed' ? 'destructive' : 
                         tree.status === 'completed' ? 'default' : 'secondary'}>
            {tree.status}
          </Badge>
          {tree.status === 'running' && (
            <div className="w-20">
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </div>
      </div>
      
      {expanded && (
        <div className="mt-3 space-y-2">
          {/* Child operations */}
          {tree.children.map((child) => (
            <div key={child.correlationId} className="ml-6">
              <CorrelationTreeNode
                tree={child}
                expanded={false}
                onToggle={() => {}}
                level={level + 1}
              />
            </div>
          ))}
          
          {/* Logs for this operation */}
          <div className="ml-6 space-y-1">
            {tree.logs.slice(0, 5).map((log) => (
              <LogEntry key={log._id} log={log} compact />
            ))}
            {tree.logs.length > 5 && (
              <p className="text-xs text-muted-foreground">
                +{tree.logs.length - 5} more logs...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Individual log entry component
 */
function LogEntry({ log, compact = false }: { log: CorrelationLog; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const levelColor = getLogLevelColor(log.level);
  
  return (
    <div className={cn("border rounded p-2 text-sm", levelColor)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {log.level.toUpperCase()}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {log.correlationId.slice(0, 8)}...
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(log._creationTime).toLocaleTimeString()}
            </span>
            {log.metadata.duration && (
              <Badge variant="outline" className="text-xs">
                {formatDuration(log.metadata.duration)}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="font-medium">{log.operation}</span>
            <span>•</span>
            <span>{log.phase}</span>
          </div>
          
          <p className={cn("mt-1", compact && "truncate")}>
            {log.message}
          </p>
          
          {!compact && log.data && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="mt-1 h-6 px-2 text-xs"
            >
              {expanded ? 'Hide' : 'Show'} data
            </Button>
          )}
        </div>
      </div>
      
      {expanded && log.data && (
        <div className="mt-2 p-2 bg-background/50 rounded border text-xs">
          <pre className="whitespace-pre-wrap break-words">
            {JSON.stringify(log.data, null, 2)}
          </pre>
        </div>
      )}
      
      {log.metadata.error && (
        <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs">
          <strong>Error:</strong> {log.metadata.error}
        </div>
      )}
    </div>
  );
}