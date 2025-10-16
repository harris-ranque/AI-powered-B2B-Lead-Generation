/**
 * Universal Error Handling Utilities for Bulletproof Convex Functions
 * Enterprise-grade error handling, logging, and recovery for backend operations
 */

import { ConvexError } from "convex/values";

// Error severity levels
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

// Error categories
export type ErrorCategory =
  | "validation"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "external_api"
  | "database"
  | "business_logic"
  | "system"
  | "unknown";

// Enhanced error interface
export interface EnhancedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  code?: string;
  details?: Record<string, any>;
  timestamp: number;
  correlationId?: string;
  userId?: string;
  functionName?: string;
  retryable: boolean;
}

// Error codes for consistent error handling
export const ERROR_CODES = {
  // Validation errors (4xx equivalent)
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_INPUT: "INVALID_INPUT",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",

  // Authentication/Authorization errors
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",

  // Rate limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",

  // External service errors
  EXTERNAL_API_ERROR: "EXTERNAL_API_ERROR",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",

  // Database errors
  DATABASE_ERROR: "DATABASE_ERROR",
  CONSTRAINT_VIOLATION: "CONSTRAINT_VIOLATION",
  NOT_FOUND: "NOT_FOUND",
  DUPLICATE_RECORD: "DUPLICATE_RECORD",

  // Business logic errors
  BUSINESS_RULE_VIOLATION: "BUSINESS_RULE_VIOLATION",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
  INVALID_STATE: "INVALID_STATE",

  // System errors
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
} as const;

// Create enhanced ConvexError
export function createConvexError(
  category: ErrorCategory,
  message: string,
  options: {
    code?: string;
    severity?: ErrorSeverity;
    details?: Record<string, any>;
    correlationId?: string;
    userId?: string;
    functionName?: string;
    retryable?: boolean;
    originalError?: Error;
  } = {},
): ConvexError<any> {
  const {
    code,
    severity = "medium",
    details = {},
    correlationId,
    userId,
    functionName,
    retryable = false,
    originalError,
  } = options;

  const enhancedError: EnhancedError = {
    category,
    severity,
    message,
    code,
    details: {
      ...details,
      originalError: originalError?.message,
      stack: originalError?.stack,
    },
    timestamp: Date.now(),
    correlationId,
    userId,
    functionName,
    retryable,
  };

  // Log error for debugging and monitoring
  console.error(
    `[${severity.toUpperCase()}] ${category} error in ${functionName || "unknown"}:`,
    {
      ...enhancedError,
      userAgent: details?.userAgent,
      url: details?.url,
    },
  );

  // In production, send to error tracking service
  if (process.env.NODE_ENV === "production") {
    // Integration point for error tracking services
    // await errorTracker.capture(enhancedError);
  }

  return new ConvexError<any>({
    type: category,
    message,
    code,
    severity,
    retryable,
    timestamp: enhancedError.timestamp,
    correlationId,
    details: enhancedError.details,
  });
}

// Safe async wrapper for Convex functions
export async function safeAsyncOperation<T>(
  operation: () => Promise<T>,
  context: {
    functionName: string;
    userId?: string;
    correlationId?: string;
    category?: ErrorCategory;
  },
): Promise<T> {
  const { functionName, userId, correlationId, category = "system" } = context;

  try {
    return await operation();
  } catch (error) {
    // Handle known ConvexError
    if (error instanceof ConvexError) {
      throw error;
    }

    // Handle generic errors
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    throw createConvexError(category, errorMessage, {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      severity: "high",
      functionName,
      userId,
      correlationId,
      retryable: false,
      originalError: error instanceof Error ? error : new Error(String(error)),
      details: {
        errorType: error?.constructor?.name || typeof error,
      },
    });
  }
}

// Safe database operation wrapper
export async function safeDatabaseOperation<T>(
  operation: () => Promise<T>,
  context: {
    functionName: string;
    operationType: string;
    userId?: string;
    correlationId?: string;
  },
): Promise<T> {
  const { functionName, operationType, userId, correlationId } = context;

  try {
    return await operation();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Database operation failed";

    // Determine error severity based on error type
    const severity: ErrorSeverity =
      errorMessage.includes("constraint") || errorMessage.includes("duplicate")
        ? "medium"
        : errorMessage.includes("timeout")
          ? "high"
          : "critical";

    // Determine if retryable based on error type
    const retryable =
      errorMessage.includes("timeout") ||
      errorMessage.includes("connection") ||
      errorMessage.includes("network");

    throw createConvexError(
      "database",
      `${operationType} failed: ${errorMessage}`,
      {
        code: ERROR_CODES.DATABASE_ERROR,
        severity,
        functionName,
        userId,
        correlationId,
        retryable,
        originalError:
          error instanceof Error ? error : new Error(String(error)),
        details: { operationType },
      },
    );
  }
}

// External API call wrapper
export async function safeExternalApiCall<T>(
  apiCall: () => Promise<T>,
  context: {
    functionName: string;
    apiName: string;
    userId?: string;
    correlationId?: string;
    timeout?: number;
  },
): Promise<T> {
  const {
    functionName,
    apiName,
    userId,
    correlationId,
    timeout = 30000,
  } = context;

  try {
    // Add timeout protection
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("API call timeout")), timeout),
    );

    return (await Promise.race([apiCall(), timeoutPromise])) as T;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "External API call failed";

    // Determine if retryable based on error type
    const retryable =
      errorMessage.includes("timeout") ||
      errorMessage.includes("503") ||
      errorMessage.includes("502") ||
      errorMessage.includes("ECONNRESET");

    const severity: ErrorSeverity = retryable ? "medium" : "high";

    throw createConvexError(
      "external_api",
      `${apiName} API error: ${errorMessage}`,
      {
        code: ERROR_CODES.EXTERNAL_API_ERROR,
        severity,
        functionName,
        userId,
        correlationId,
        retryable,
        originalError:
          error instanceof Error ? error : new Error(String(error)),
        details: { apiName, timeout },
      },
    );
  }
}

// Input validation wrapper
export function validateInput<T>(
  input: unknown,
  validator: (input: unknown) => input is T,
  fieldName: string,
  context: {
    functionName: string;
    userId?: string;
    correlationId?: string;
  },
): T {
  const { functionName, userId, correlationId } = context;

  try {
    if (!validator(input)) {
      throw createConvexError("validation", `Invalid ${fieldName}`, {
        code: ERROR_CODES.VALIDATION_FAILED,
        severity: "low",
        functionName,
        userId,
        correlationId,
        retryable: false,
        details: { fieldName, receivedType: typeof input },
      });
    }
    return input;
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }

    throw createConvexError("validation", `Validation error for ${fieldName}`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      severity: "low",
      functionName,
      userId,
      correlationId,
      retryable: false,
      originalError: error instanceof Error ? error : new Error(String(error)),
      details: { fieldName },
    });
  }
}

// Rate limiting wrapper
export async function withRateLimit<T>(
  operation: () => Promise<T>,
  context: {
    functionName: string;
    userId: string;
    correlationId?: string;
    rateLimitKey: string;
    maxAttempts: number;
    windowMs: number;
  },
): Promise<T> {
  const {
    functionName,
    userId,
    correlationId,
    rateLimitKey,
    maxAttempts,
    windowMs,
  } = context;

  // Note: Actual rate limiting logic would be implemented here
  // This is a placeholder for the wrapper structure

  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConvexError && error.data?.type === "rate_limit") {
      throw error;
    }

    throw createConvexError("rate_limit", "Rate limit check failed", {
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      severity: "medium",
      functionName,
      userId,
      correlationId,
      retryable: true,
      originalError: error instanceof Error ? error : new Error(String(error)),
      details: { rateLimitKey, maxAttempts, windowMs },
    });
  }
}

// Credit operation wrapper
export async function withCreditCheck<T>(
  operation: () => Promise<T>,
  context: {
    functionName: string;
    userId: string;
    correlationId?: string;
    requiredCredits: number;
  },
): Promise<T> {
  const { functionName, userId, correlationId, requiredCredits } = context;

  try {
    // Note: Actual credit checking logic would be implemented here
    return await operation();
  } catch (error) {
    if (
      error instanceof ConvexError &&
      error.data?.code === ERROR_CODES.INSUFFICIENT_CREDITS
    ) {
      throw error;
    }

    throw createConvexError("business_logic", "Credit check failed", {
      code: ERROR_CODES.INSUFFICIENT_CREDITS,
      severity: "medium",
      functionName,
      userId,
      correlationId,
      retryable: false,
      originalError: error instanceof Error ? error : new Error(String(error)),
      details: { requiredCredits },
    });
  }
}

// Authentication wrapper
export function requireAuth(
  userId: string | undefined,
  context: {
    functionName: string;
    correlationId?: string;
    requiredRole?: string;
  },
): string {
  const { functionName, correlationId, requiredRole } = context;

  if (!userId) {
    throw createConvexError("authentication", "Authentication required", {
      code: ERROR_CODES.UNAUTHORIZED,
      severity: "low",
      functionName,
      correlationId,
      retryable: false,
      details: { requiredRole },
    });
  }

  return userId;
}

// Retry mechanism with exponential backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  context: {
    functionName: string;
    userId?: string;
    correlationId?: string;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<T> {
  const {
    functionName,
    userId,
    correlationId,
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
  } = context;

  let lastError: Error | ConvexError<any> | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError =
        error instanceof Error || error instanceof ConvexError
          ? error
          : new Error(String(error));

      // Don't retry on last attempt or non-retryable errors
      if (attempt > maxRetries) break;

      if (error instanceof ConvexError && !error.data?.retryable) {
        break;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));

      console.warn(
        `Retry attempt ${attempt} for ${functionName} after ${delay}ms delay`,
      );
    }
  }

  // All retries exhausted, throw the last error
  if (lastError instanceof ConvexError) {
    throw lastError;
  }

  throw createConvexError("system", "Operation failed after retries", {
    code: ERROR_CODES.INTERNAL_SERVER_ERROR,
    severity: "high",
    functionName,
    userId,
    correlationId,
    retryable: false,
    originalError: lastError,
    details: { maxRetries, attempts: maxRetries + 1 },
  });
}

// Performance monitoring wrapper
export async function withPerformanceMonitoring<T>(
  operation: () => Promise<T>,
  context: {
    functionName: string;
    userId?: string;
    correlationId?: string;
    warningThresholdMs?: number;
    errorThresholdMs?: number;
  },
): Promise<T> {
  const {
    functionName,
    userId,
    correlationId,
    warningThresholdMs = 5000,
    errorThresholdMs = 30000,
  } = context;

  const startTime = Date.now();

  try {
    const result = await operation();
    const duration = Date.now() - startTime;

    // Log performance warnings
    if (duration > warningThresholdMs) {
      console.warn(`Slow operation in ${functionName}: ${duration}ms`, {
        functionName,
        userId,
        correlationId,
        duration,
        threshold: warningThresholdMs,
      });
    }

    // Log performance metrics
    console.log(`Performance: ${functionName} completed in ${duration}ms`, {
      functionName,
      duration,
      userId,
      correlationId,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error(`Failed operation in ${functionName} after ${duration}ms`, {
      functionName,
      userId,
      correlationId,
      duration,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
