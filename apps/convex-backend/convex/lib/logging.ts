import {
  CorrelationContext,
  LogContext,
  createLogEntry,
  formatCorrelationForLogging,
} from "./correlation";

/**
 * Console-Only Logging Service with Correlation ID Support
 *
 * Provides structured console logging for Convex's built-in log aggregator
 * with correlation tracking for better debugging and monitoring.
 */

// Enhanced console logging function for Convex log aggregator
export function logWithCorrelationConsole(
  level: LogContext["level"],
  correlation: CorrelationContext,
  message: string,
  data?: any,
  error?: Error,
  performance?: LogContext["performance"],
) {
  // Create structured log entry for better Convex dashboard visibility
  const logEntry = {
    correlationId: correlation.correlationId,
    operationType: correlation.operationType,
    parentId: correlation.parentId,
    userId: correlation.userId,
    searchId: correlation.searchId,
    leadId: correlation.leadId,
    batchId: correlation.batchId,
    level,
    message,
    timestamp: new Date().toISOString(),
    data,
    error: error
      ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        }
      : undefined,
    performance,
    metadata: correlation.metadata,
  };

  // Remove undefined fields for cleaner output
  Object.keys(logEntry).forEach((key) => {
    if (logEntry[key as keyof typeof logEntry] === undefined) {
      delete logEntry[key as keyof typeof logEntry];
    }
  });

  // Format correlation info for readable console output
  const correlationInfo = [
    `[${correlation.correlationId}]`,
    `[${correlation.operationType}]`,
    correlation.parentId
      ? `[parent:${correlation.parentId.substring(0, 8)}]`
      : "",
    correlation.searchId ? `[search:${correlation.searchId}]` : "",
    correlation.leadId ? `[lead:${correlation.leadId}]` : "",
    correlation.batchId ? `[batch:${correlation.batchId}]` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const displayMessage = `${correlationInfo} ${message}`;

  // Console logging with structured data
  switch (level) {
    case "debug":
      console.debug(displayMessage, logEntry);
      break;
    case "info":
      console.info(displayMessage, logEntry);
      break;
    case "warn":
      console.warn(displayMessage, logEntry);
      break;
    case "error":
      console.error(displayMessage, logEntry);
      break;
  }
}

// Console-only logging functions - no database queries needed
// Logs are viewable through Convex dashboard and CLI tools
