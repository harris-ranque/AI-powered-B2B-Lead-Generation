// Simple UUID v4 implementation for correlation IDs
function generateUuid(): string {
  return 'xxxx-xxxx-xxxx-xxxx'.replace(/[x]/g, () => {
    const r = Math.random() * 16 | 0;
    return r.toString(16);
  });
}

/**
 * Correlation ID System for Enhanced Logging and Tracing
 * 
 * Provides unique correlation IDs that follow operations across the entire
 * search pipeline for better debugging and monitoring.
 */

// Correlation ID structure
export interface CorrelationContext {
  correlationId: string;
  operationType: string;
  parentId?: string;
  userId: string;
  searchId?: string;
  leadId?: string;
  batchId?: string;
  createdAt: number;
  metadata?: Record<string, any>;
}

// Operation types for correlation tracking
export const OPERATION_TYPES = {
  // Main pipeline operations
  SEARCH_CREATE: "search_create",
  SEARCH_ORCHESTRATE: "search_orchestrate", 
  GOOGLE_MAPS_DISCOVERY: "google_maps_discovery",
  LEAD_ENRICHMENT: "lead_enrichment",
  AI_ANALYSIS: "ai_analysis",
  SEARCH_COMPLETION: "search_completion",
  
  // Sub-operations
  CREDIT_RESERVATION: "credit_reservation",
  CREDIT_COMMIT: "credit_commit",
  RATE_LIMIT_CHECK: "rate_limit_check",
  BATCH_CREATION: "batch_creation",
  BATCH_PROCESSING: "batch_processing",
  
  // External API calls
  FINDYMAIL_API: "findymail_api",
  GOOGLE_MAPS_API: "google_maps_api",
  LANGGRAPH_API: "langgraph_api",
  
  // Error handling
  RETRY_OPERATION: "retry_operation",
  ERROR_RECOVERY: "error_recovery",
  
  // Broadcasting
  BROADCAST_STATUS: "broadcast_status",
  NOTIFICATION_SEND: "notification_send",
} as const;

// Generate a new correlation ID
export function generateCorrelationId(): string {
  return `corr_${generateUuid().replace(/-/g, '').substring(0, 16)}`;
}

// Create correlation context
export function createCorrelationContext(
  operationType: string,
  userId: string,
  options?: {
    parentId?: string;
    searchId?: string;
    leadId?: string;
    batchId?: string;
    metadata?: Record<string, any>;
  }
): CorrelationContext {
  const context: CorrelationContext = {
    correlationId: generateCorrelationId(),
    operationType,
    userId,
    createdAt: Date.now(),
  };

  // Add optional fields only if they exist
  if (options?.parentId) context.parentId = options.parentId;
  if (options?.searchId) context.searchId = options.searchId;
  if (options?.leadId) context.leadId = options.leadId;
  if (options?.batchId) context.batchId = options.batchId;
  if (options?.metadata) context.metadata = options.metadata;

  return context;
}

// Create child correlation context
export function createChildContext(
  parent: CorrelationContext,
  operationType: string,
  options?: {
    searchId?: string;
    leadId?: string;
    batchId?: string;
    metadata?: Record<string, any>;
  }
): CorrelationContext {
  const childOptions: any = {
    parentId: parent.correlationId,
  };
  
  if (options?.searchId || parent.searchId) {
    childOptions.searchId = options?.searchId || parent.searchId;
  }
  if (options?.leadId || parent.leadId) {
    childOptions.leadId = options?.leadId || parent.leadId;
  }
  if (options?.batchId || parent.batchId) {
    childOptions.batchId = options?.batchId || parent.batchId;
  }
  if (options?.metadata) {
    childOptions.metadata = options.metadata;
  }
  
  return createCorrelationContext(operationType, parent.userId, childOptions);
}

// Enhanced logging functions with correlation context
export interface LogContext {
  level: 'debug' | 'info' | 'warn' | 'error';
  correlation: CorrelationContext;
  message: string;
  data?: any;
  error?: Error;
  performance?: {
    startTime: number;
    endTime?: number;
    duration?: number;
  };
}

// Create structured log entry
export function createLogEntry(
  level: LogContext['level'],
  correlation: CorrelationContext,
  message: string,
  data?: any,
  error?: Error,
  performance?: LogContext['performance']
): LogContext {
  const logContext: LogContext = {
    level,
    correlation,
    message,
  };
  
  if (data !== undefined) logContext.data = data;
  if (error !== undefined) logContext.error = error;
  if (performance !== undefined) logContext.performance = performance;
  
  return logContext;
}

// Log with correlation context
export function logWithCorrelation(
  level: LogContext['level'],
  correlation: CorrelationContext,
  message: string,
  data?: any,
  error?: Error
) {
  const logEntry = createLogEntry(level, correlation, message, data, error);
  
  // Format the log message with correlation info
  const correlationInfo = [
    `[${correlation.correlationId}]`,
    `[${correlation.operationType}]`,
    correlation.parentId ? `[parent:${correlation.parentId.substring(0, 8)}]` : '',
    correlation.searchId ? `[search:${correlation.searchId}]` : '',
    correlation.leadId ? `[lead:${correlation.leadId}]` : '',
    correlation.batchId ? `[batch:${correlation.batchId}]` : '',
  ].filter(Boolean).join(' ');
  
  const fullMessage = `${correlationInfo} ${message}`;
  
  // Log to console with appropriate level
  switch (level) {
    case 'debug':
      if (data && error) {
        console.debug(fullMessage, { data, error: error.message, stack: error.stack });
      } else if (data) {
        console.debug(fullMessage, data);
      } else if (error) {
        console.debug(fullMessage, { error: error.message, stack: error.stack });
      } else {
        console.debug(fullMessage);
      }
      break;
    case 'info':
      if (data) {
        console.info(fullMessage, data);
      } else {
        console.info(fullMessage);
      }
      break;
    case 'warn':
      if (data && error) {
        console.warn(fullMessage, { data, error: error.message });
      } else if (data) {
        console.warn(fullMessage, data);
      } else if (error) {
        console.warn(fullMessage, { error: error.message });
      } else {
        console.warn(fullMessage);
      }
      break;
    case 'error':
      if (data && error) {
        console.error(fullMessage, { data, error: error.message, stack: error.stack });
      } else if (data) {
        console.error(fullMessage, data);
      } else if (error) {
        console.error(fullMessage, { error: error.message, stack: error.stack });
      } else {
        console.error(fullMessage);
      }
      break;
  }
}

// Performance tracking helpers
export function startPerformanceTracking(): { startTime: number } {
  return { startTime: Date.now() };
}

export function endPerformanceTracking(start: { startTime: number }): LogContext['performance'] {
  const endTime = Date.now();
  return {
    startTime: start.startTime,
    endTime,
    duration: endTime - start.startTime,
  };
}

// Correlation context middleware for operations
export function withCorrelationContext<T extends any[], R>(
  operationType: string,
  fn: (correlation: CorrelationContext, ...args: T) => Promise<R>
) {
  return async (userId: string, ...args: T): Promise<R> => {
    const correlation = createCorrelationContext(operationType, userId);
    
    logWithCorrelation('info', correlation, `Starting ${operationType}`);
    const perf = startPerformanceTracking();
    
    try {
      const result = await fn(correlation, ...args);
      
      const perfData = endPerformanceTracking(perf);
      logWithCorrelation('info', correlation, `Completed ${operationType}`, { 
        duration: perfData?.duration 
      });
      
      return result;
    } catch (error) {
      const perfData = endPerformanceTracking(perf);
      logWithCorrelation('error', correlation, `Failed ${operationType}`, { 
        duration: perfData?.duration 
      }, error as Error);
      
      throw error;
    }
  };
}

// Batch correlation context for multiple operations
export function createBatchCorrelationContext(
  parentCorrelation: CorrelationContext,
  batchSize: number,
  batchNumber: number
): CorrelationContext {
  return createChildContext(parentCorrelation, OPERATION_TYPES.BATCH_PROCESSING, {
    metadata: {
      batchSize,
      batchNumber,
      totalBatches: Math.ceil(batchSize), // Will be updated by caller
    },
  });
}

// Error context enhancement
export function enhanceError(
  error: Error,
  correlation: CorrelationContext,
  context?: Record<string, any>
): Error {
  const enhancedMessage = `[${correlation.correlationId}] ${error.message}`;
  const enhancedError = new Error(enhancedMessage);
  
  // Preserve original stack and add correlation context
  if (error.stack) {
    enhancedError.stack = error.stack;
  }
  (enhancedError as any).correlationId = correlation.correlationId;
  (enhancedError as any).operationType = correlation.operationType;
  (enhancedError as any).context = context;
  
  return enhancedError;
}

// Correlation-aware timeout helper
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  correlation: CorrelationContext,
  operationName: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        const timeoutError = new Error(`Operation ${operationName} timed out after ${timeoutMs}ms`);
        reject(enhanceError(timeoutError, correlation, { timeoutMs, operationName }));
      }, timeoutMs);
    }),
  ]);
}

// Format correlation context for external logging systems
export function formatCorrelationForLogging(correlation: CorrelationContext): Record<string, any> {
  return {
    correlation_id: correlation.correlationId,
    operation_type: correlation.operationType,
    parent_id: correlation.parentId,
    user_id: correlation.userId,
    search_id: correlation.searchId,
    lead_id: correlation.leadId,
    batch_id: correlation.batchId,
    created_at: correlation.createdAt,
    metadata: correlation.metadata,
  };
}