import { 
  CorrelationContext, 
  LogContext, 
  logWithCorrelation,
  createCorrelationContext,
  createChildContext,
  OPERATION_TYPES
} from "./correlation";
import { logWithCorrelationConsole } from "./logging";

/**
 * Simplified Logger Utility for Convex Backend
 * 
 * Provides easy-to-use logging functions with correlation tracking
 * for Convex's built-in log aggregator and future Sentry integration.
 */

export interface LoggerContext {
  userId?: string;
  searchId?: string;
  leadId?: string;
  batchId?: string;
  metadata?: Record<string, any>;
}

export interface StructuredLogEntry {
  level: LogContext['level'];
  message: string;
  correlationId?: string;
  operationType?: string;
  userId?: string;
  searchId?: string;
  leadId?: string;
  batchId?: string;
  timestamp: string;
  data?: any;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
  performance?: {
    duration?: number;
    startTime?: number;
    endTime?: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Simple Logger Class
 * Provides correlation-aware logging with structured output
 */
export class Logger {
  private correlation?: CorrelationContext;

  constructor(correlation?: CorrelationContext) {
    this.correlation = correlation;
  }

  /**
   * Create a logger with correlation context
   */
  static withCorrelation(correlation: CorrelationContext): Logger {
    return new Logger(correlation);
  }

  /**
   * Create a logger for an operation
   */
  static forOperation(
    operationType: string, 
    userId: string, 
    options?: {
      searchId?: string;
      leadId?: string;
      batchId?: string;
      metadata?: Record<string, any>;
    }
  ): Logger {
    const correlation = createCorrelationContext(operationType, userId, options);
    return new Logger(correlation);
  }

  /**
   * Create child logger for nested operations
   */
  createChild(operationType: string, options?: {
    searchId?: string;
    leadId?: string;
    batchId?: string;
    metadata?: Record<string, any>;
  }): Logger {
    if (!this.correlation) {
      throw new Error("Cannot create child logger without parent correlation");
    }
    const childCorrelation = createChildContext(this.correlation, operationType, options);
    return new Logger(childCorrelation);
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: any, performance?: LogContext['performance']) {
    this.log('debug', message, data, undefined, performance);
  }

  /**
   * Log info message
   */
  info(message: string, data?: any, performance?: LogContext['performance']) {
    this.log('info', message, data, undefined, performance);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any, error?: Error, performance?: LogContext['performance']) {
    this.log('warn', message, data, error, performance);
  }

  /**
   * Log error message
   */
  error(message: string, data?: any, error?: Error, performance?: LogContext['performance']) {
    this.log('error', message, data, error, performance);
  }

  /**
   * Log operation start
   */
  start(message?: string, data?: any) {
    const msg = message || `Starting ${this.correlation?.operationType || 'operation'}`;
    this.info(msg, data);
    return { startTime: Date.now() };
  }

  /**
   * Log operation completion
   */
  complete(startTime: { startTime: number }, message?: string, data?: any) {
    const duration = Date.now() - startTime.startTime;
    const msg = message || `Completed ${this.correlation?.operationType || 'operation'}`;
    this.info(msg, data, { 
      startTime: startTime.startTime, 
      endTime: Date.now(), 
      duration 
    });
    return { duration };
  }

  /**
   * Log operation failure
   */
  failure(startTime: { startTime: number }, error: Error, message?: string, data?: any) {
    const duration = Date.now() - startTime.startTime;
    const msg = message || `Failed ${this.correlation?.operationType || 'operation'}`;
    this.error(msg, data, error, { 
      startTime: startTime.startTime, 
      endTime: Date.now(), 
      duration 
    });
    return { duration, error };
  }

  /**
   * Internal log method
   */
  private log(
    level: LogContext['level'],
    message: string,
    data?: any,
    error?: Error,
    performance?: LogContext['performance']
  ) {
    if (this.correlation) {
      // Use correlation logging
      logWithCorrelationConsole(level, this.correlation, message, data, error, performance);
    } else {
      // Fallback to simple structured console logging
      this.simpleLog(level, message, data, error, performance);
    }
  }

  /**
   * Simple structured logging without correlation
   */
  private simpleLog(
    level: LogContext['level'],
    message: string,
    data?: any,
    error?: Error,
    performance?: LogContext['performance']
  ) {
    const logEntry: StructuredLogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      data,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined,
      performance
    };

    // Remove undefined fields
    Object.keys(logEntry).forEach(key => {
      if (logEntry[key as keyof StructuredLogEntry] === undefined) {
        delete logEntry[key as keyof StructuredLogEntry];
      }
    });

    switch (level) {
      case 'debug':
        console.debug(message, logEntry);
        break;
      case 'info':
        console.info(message, logEntry);
        break;
      case 'warn':
        console.warn(message, logEntry);
        break;
      case 'error':
        console.error(message, logEntry);
        break;
    }
  }

  /**
   * Get correlation ID for this logger
   */
  getCorrelationId(): string | undefined {
    return this.correlation?.correlationId;
  }

  /**
   * Get full correlation context
   */
  getCorrelation(): CorrelationContext | undefined {
    return this.correlation;
  }
}

/**
 * Convenience functions for quick logging without correlation
 */
export const log = {
  debug: (message: string, data?: any) => {
    const logger = new Logger();
    logger.debug(message, data);
  },
  
  info: (message: string, data?: any) => {
    const logger = new Logger();
    logger.info(message, data);
  },
  
  warn: (message: string, data?: any, error?: Error) => {
    const logger = new Logger();
    logger.warn(message, data, error);
  },
  
  error: (message: string, data?: any, error?: Error) => {
    const logger = new Logger();
    logger.error(message, data, error);
  }
};

/**
 * Create logger for specific operation types
 */
export const createOperationLogger = {
  search: (userId: string, searchId?: string) => 
    Logger.forOperation(OPERATION_TYPES.SEARCH_CREATE, userId, { searchId }),
    
  discovery: (userId: string, searchId?: string) =>
    Logger.forOperation(OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY, userId, { searchId }),
    
  enrichment: (userId: string, leadId: string, searchId?: string) =>
    Logger.forOperation(OPERATION_TYPES.LEAD_ENRICHMENT, userId, { leadId, searchId }),
    
  analysis: (userId: string, leadId: string, searchId?: string) =>
    Logger.forOperation(OPERATION_TYPES.AI_ANALYSIS, userId, { leadId, searchId }),
    
  webhook: (userId: string, operationType: string = 'webhook_handler') =>
    Logger.forOperation(operationType, userId),

  credits: (userId: string, operationType: string = OPERATION_TYPES.CREDIT_RESERVATION) =>
    Logger.forOperation(operationType, userId),

  batch: (userId: string, batchId: string, searchId?: string) =>
    Logger.forOperation(OPERATION_TYPES.BATCH_PROCESSING, userId, { batchId, searchId })
};

/**
 * Performance tracking utilities
 */
export const perf = {
  /**
   * Time an operation with automatic logging
   */
  time: async <T>(
    logger: Logger,
    operation: string,
    fn: () => Promise<T> | T
  ): Promise<T> => {
    const start = logger.start(`Starting ${operation}`);
    
    try {
      const result = await fn();
      logger.complete(start, `Completed ${operation}`);
      return result;
    } catch (error) {
      logger.failure(start, error as Error, `Failed ${operation}`);
      throw error;
    }
  },

  /**
   * Simple performance timer
   */
  start: () => ({ startTime: Date.now() }),
  
  end: (start: { startTime: number }) => ({
    duration: Date.now() - start.startTime,
    startTime: start.startTime,
    endTime: Date.now()
  })
};

/**
 * Structured error logging helper
 */
export function logError(
  error: Error,
  context?: {
    message?: string;
    operationType?: string;
    userId?: string;
    data?: any;
    correlation?: CorrelationContext;
  }
) {
  const logger = context?.correlation 
    ? Logger.withCorrelation(context.correlation)
    : new Logger();

  const message = context?.message || `Error: ${error.message}`;
  const data = {
    operationType: context?.operationType,
    userId: context?.userId,
    ...context?.data
  };

  logger.error(message, data, error);
}

/**
 * API call logging helper
 */
export function logApiCall(
  method: string,
  url: string,
  options?: {
    logger?: Logger;
    requestData?: any;
    responseData?: any;
    status?: number;
    duration?: number;
    error?: Error;
  }
) {
  const logger = options?.logger || new Logger();
  
  if (options?.error) {
    logger.error(`API ${method} ${url} failed`, {
      status: options.status,
      requestData: options.requestData,
      responseData: options.responseData
    }, options.error, options.duration ? {
      // Construct a full performance object from duration
      startTime: Date.now() - options.duration,
      endTime: Date.now(),
      duration: options.duration
    } : undefined);
  } else {
    const level = (options?.status && options.status >= 400) ? 'warn' : 'info';
    const message = `API ${method} ${url} ${options?.status || 'completed'}`;
    
    if (level === 'warn') {
      logger.warn(message, {
        status: options?.status,
        requestData: options?.requestData,
        responseData: options?.responseData
      }, undefined, options?.duration ? {
        startTime: Date.now() - options.duration,
        endTime: Date.now(),
        duration: options.duration
      } : undefined);
    } else {
      logger.info(message, {
        status: options?.status,
        requestData: options?.requestData,
        responseData: options?.responseData
      }, options?.duration ? {
        startTime: Date.now() - options.duration,
        endTime: Date.now(),
        duration: options.duration
      } : undefined);
    }
  }
}

// Export operation types for convenience
export { OPERATION_TYPES };
