/**
 * Logging utility for web app with environment-based configuration.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

// Enhanced LogEntry with correlation support
interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  component?: string;
  // Future Sentry integration fields
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private isDevelopment: boolean;
  private component?: string;
  private correlationId?: string;
  private userId?: string;
  private sessionId?: string;

  constructor(component?: string, options?: {
    correlationId?: string;
    userId?: string;
    sessionId?: string;
  }) {
    this.isDevelopment = import.meta.env.MODE === 'development';
    this.component = component;
    this.correlationId = options?.correlationId;
    this.userId = options?.userId;
    this.sessionId = options?.sessionId;
  }

  /**
   * Create logger with correlation context
   */
  static withCorrelation(component: string, options: {
    correlationId?: string;
    userId?: string;
    sessionId?: string;
  }): Logger {
    return new Logger(component, options);
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext, error?: Error): LogEntry {
    const logEntry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      component: this.component,
    };

    // Add correlation data if available
    if (this.correlationId) logEntry.correlationId = this.correlationId;
    if (this.userId) logEntry.userId = this.userId;
    if (this.sessionId) logEntry.sessionId = this.sessionId;
    
    // Add error information if provided
    if (error) {
      logEntry.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    }

    return logEntry;
  }

  private getConsoleMethod(level: LogLevel): Console['log'] {
    switch (level) {
      case 'debug':
        return console.debug;
      case 'info':
        return console.info;
      case 'warn':
        return console.warn;
      case 'error':
        return console.error;
      default:
        return console.log;
    }
  }

  private getColorForLevel(level: LogLevel): string {
    switch (level) {
      case 'debug':
        return '#6B7280'; // Gray
      case 'info':
        return '#3B82F6'; // Blue
      case 'warn':
        return '#F59E0B'; // Yellow
      case 'error':
        return '#EF4444'; // Red
      default:
        return '#000000'; // Black
    }
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    const logEntry = this.formatMessage(level, message, context, error);
    const consoleMethod = this.getConsoleMethod(level);

    if (this.isDevelopment) {
      // Enhanced development logging with correlation info
      const color = this.getColorForLevel(level);
      const timestamp = new Date().toLocaleTimeString();
      const componentText = this.component ? ` [${this.component}]` : '';
      const correlationText = this.correlationId ? ` 🔗 ${this.correlationId.substring(5, 13)}` : '';
      
      consoleMethod(
        `%c${timestamp}%c ${level.toUpperCase()}${componentText}${correlationText}: ${message}`,
        'color: #9CA3AF; font-weight: normal;',
        `color: ${color}; font-weight: bold;`
      );

      // Show structured log entry for debugging
      if (this.correlationId || context || error) {
        console.groupCollapsed(`%cStructured Data:`, 'color: #6B7280; font-style: italic;');
        console.log('Full Log Entry:', logEntry);
        if (error) {
          console.error('Error Details:', error);
        }
        console.groupEnd();
      }
    } else {
      // Structured production logging (ready for Sentry)
      if (level !== 'debug') {
        const productionMessage = this.correlationId 
          ? `[${this.correlationId.substring(5, 13)}] ${message}`
          : message;
        
        consoleMethod(`[${level.toUpperCase()}] ${productionMessage}`, logEntry);
      }
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext, error?: Error) {
    this.log('warn', message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error) {
    this.log('error', message, context, error);
  }

  /**
   * Set correlation ID for this logger instance
   */
  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /**
   * Set user ID for this logger instance
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Get current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  // Convenience methods for common scenarios
  apiRequest(endpoint: string, method: string, data?: unknown) {
    this.debug(`API Request: ${method} ${endpoint}`, { data });
  }

  apiResponse(endpoint: string, status: number, data?: unknown, duration?: number) {
    const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info';
    this.log(level, `API Response: ${status} ${endpoint}`, {
      data: this.isDevelopment ? data : undefined,
      duration: duration ? `${duration}ms` : undefined,
    });
  }

  componentMount(componentName: string) {
    this.debug(`Component mounted: ${componentName}`);
  }

  componentUnmount(componentName: string) {
    this.debug(`Component unmounted: ${componentName}`);
  }

  userAction(action: string, details?: LogContext) {
    this.info(`User action: ${action}`, details);
  }

  performance(operation: string, duration: number, details?: LogContext) {
    const level = duration > 1000 ? 'warn' : 'info';
    this.log(level, `Performance: ${operation} took ${duration}ms`, details);
  }

  errorBoundary(error: Error, componentStack?: string) {
    this.error(`React Error Boundary caught error: ${error.message}`, {
      componentStack,
    }, error);
  }
}

// Create default logger instance
export const logger = new Logger();

// Factory function to create component-specific loggers
export const createLogger = (component: string): Logger => new Logger(component);

// Hook for React components
export const useLogger = (component: string): Logger => {
  return new Logger(component);
};

// Convenience functions using default logger
export const debug = (message: string, context?: LogContext) => logger.debug(message, context);
export const info = (message: string, context?: LogContext) => logger.info(message, context);
export const warn = (message: string, context?: LogContext, error?: Error) => logger.warn(message, context, error);
export const error = (message: string, context?: LogContext, errorObj?: Error) => logger.error(message, context, errorObj);

// Utility functions for correlation tracking
export const setGlobalCorrelationId = (correlationId: string) => {
  logger.setCorrelationId(correlationId);
};

export const setGlobalUserId = (userId: string) => {
  logger.setUserId(userId);
};

export const getGlobalCorrelationId = (): string | undefined => {
  return logger.getCorrelationId();
};

// Performance timing utility
export const timeOperation = <T>(
  operation: string,
  fn: () => T | Promise<T>
): T | Promise<T> => {
  const start = performance.now();
  
  try {
    const result = fn();
    
    if (result instanceof Promise) {
      return result.then((value) => {
        const duration = performance.now() - start;
        logger.performance(operation, duration);
        return value;
      }).catch((err) => {
        const duration = performance.now() - start;
        logger.performance(operation, duration, { error: err.message });
        throw err;
      });
    } else {
      const duration = performance.now() - start;
      logger.performance(operation, duration);
      return result;
    }
  } catch (err) {
    const duration = performance.now() - start;
    logger.performance(operation, duration, { 
      error: err instanceof Error ? err.message : 'Unknown error' 
    });
    throw err;
  }
};

// Enhanced error tracking utility with correlation support
export const trackError = (error: Error, context?: LogContext, correlationId?: string) => {
  const errorLogger = correlationId 
    ? Logger.withCorrelation('ErrorTracker', { correlationId })
    : logger;
    
  errorLogger.error(`Tracked error: ${error.message}`, context, error);
};

// Create correlated logger for React components
export const createCorrelatedLogger = (component: string, options?: {
  correlationId?: string;
  userId?: string;
  sessionId?: string;
}): Logger => {
  return Logger.withCorrelation(component, options || {});
};

// API request logger with correlation support
export const logApiRequest = (
  method: string,
  url: string,
  options?: {
    correlationId?: string;
    requestData?: unknown;
    status?: number;
    duration?: number;
    error?: Error;
  }
) => {
  const apiLogger = options?.correlationId 
    ? Logger.withCorrelation('ApiClient', { correlationId: options.correlationId })
    : createLogger('ApiClient');

  if (options?.error) {
    apiLogger.error(`API ${method} ${url} failed`, {
      status: options.status,
      duration: options.duration,
      requestData: options.requestData
    }, options.error);
  } else {
    const level = (options?.status && options.status >= 400) ? 'warn' : 'info';
    const message = `API ${method} ${url} ${options?.status || 'completed'}`;
    
    if (level === 'warn') {
      apiLogger.warn(message, {
        status: options?.status,
        duration: options?.duration,
        requestData: options?.requestData
      });
    } else {
      apiLogger.info(message, {
        status: options?.status,
        duration: options?.duration,
        requestData: options?.requestData
      });
    }
  }
};
