/**
 * Logging utility for web app with environment-based configuration.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  component?: string;
}

class Logger {
  private isDevelopment: boolean;
  private component?: string;

  constructor(component?: string) {
    this.isDevelopment = import.meta.env.MODE === 'development';
    this.component = component;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      component: this.component,
    };
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

  private log(level: LogLevel, message: string, context?: LogContext) {
    const logEntry = this.formatMessage(level, message, context);
    const consoleMethod = this.getConsoleMethod(level);

    if (this.isDevelopment) {
      // Detailed logging for development
      const color = this.getColorForLevel(level);
      const timestamp = new Date().toLocaleTimeString();
      const componentText = this.component ? ` [${this.component}]` : '';
      
      consoleMethod(
        `%c${timestamp}%c ${level.toUpperCase()}${componentText}: ${message}`,
        'color: #9CA3AF; font-weight: normal;',
        `color: ${color}; font-weight: bold;`
      );

      if (context && Object.keys(context).length > 0) {
        console.groupCollapsed(`%cContext for: ${message}`, 'color: #6B7280; font-style: italic;');
        Object.entries(context).forEach(([key, value]) => {
          console.log(`%c${key}:`, 'color: #4B5563; font-weight: bold;', value);
        });
        console.groupEnd();
      }
    } else {
      // Simple logging for production
      if (level !== 'debug') {
        consoleMethod(`[${level.toUpperCase()}] ${message}`, context || '');
      }
    }
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext) {
    this.log('error', message, context);
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
      error: error.stack,
      componentStack,
    });
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
export const warn = (message: string, context?: LogContext) => logger.warn(message, context);
export const error = (message: string, context?: LogContext) => logger.error(message, context);

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

// Error tracking utility
export const trackError = (error: Error, context?: LogContext) => {
  logger.error(`Tracked error: ${error.message}`, {
    ...context,
    stack: error.stack,
    name: error.name,
  });
};