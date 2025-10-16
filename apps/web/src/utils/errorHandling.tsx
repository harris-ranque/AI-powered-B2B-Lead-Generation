import React, { ReactNode, useState, useCallback } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { createLogger } from "@/utils/logger";

const errorHandlingLogger = createLogger("errorHandling");

const reportError = (
  error: unknown,
  context: string,
  extra?: Record<string, unknown>,
) => {
  const errorInstance =
    error instanceof Error ? error : new Error(String(error ?? "Unknown error"));

  errorHandlingLogger.error(context, extra, errorInstance);

  return errorInstance;
};

/**
 * Universal Error Handling Utilities for Bulletproof React Applications
 * Based on successful AdminDashboard error handling pattern
 */

// Error state interface
export interface ErrorState {
  hasError: boolean;
  errorMessage: string;
  errorDetails?: string;
  timestamp: number;
}

// Safe render wrapper function
export function safeRender<T extends unknown[]>(
  renderFunction: (...args: T) => JSX.Element,
  fallbackMessage: string,
  onError?: (error: Error) => void,
) {
  return (...args: T): JSX.Element => {
    try {
      return renderFunction(...args);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      const errorInstance = reportError(error, "safeRender", {
        fallbackMessage,
        args,
      });

      if (onError) {
        onError(errorInstance);
      }

      return (
        <Alert className="m-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Render Error:</strong> {fallbackMessage}
            <br />
            <small className="text-muted-foreground">{errorMsg}</small>
          </AlertDescription>
        </Alert>
      );
    }
  };
}

// Safe array operations utilities
export const safeArray = {
  // Safe filter operation
  filter<T>(
    array: T[] | undefined | null,
    predicate: (value: T, index: number, array: T[]) => boolean,
    fallback: T[] = [],
  ): T[] {
    try {
      if (!array || !Array.isArray(array)) return fallback;
      return array.filter((item, index, arr) => {
        try {
          return predicate(item, index, arr);
        } catch (error) {
          reportError(error, "safeArray.filter-predicate", {
            item,
            index,
          });
          return false;
        }
      });
    } catch (error) {
      reportError(error, "safeArray.filter", { array });
      return fallback;
    }
  },

  // Safe map operation
  map<T, R>(
    array: T[] | undefined | null,
    mapper: (value: T, index: number, array: T[]) => R,
    fallback: R[] = [],
  ): R[] {
    try {
      if (!array || !Array.isArray(array)) return fallback;
      return array.map((item, index, arr) => {
        try {
          return mapper(item, index, arr);
        } catch (error) {
          reportError(error, "safeArray.map-mapper", { item, index });
          throw error; // Re-throw to be caught by outer try-catch
        }
      });
    } catch (error) {
      reportError(error, "safeArray.map", { array });
      return fallback;
    }
  },

  // Safe reduce operation
  reduce<T, R>(
    array: T[] | undefined | null,
    reducer: (
      previousValue: R,
      currentValue: T,
      currentIndex: number,
      array: T[],
    ) => R,
    initialValue: R,
  ): R {
    try {
      if (!array || !Array.isArray(array)) return initialValue;
      return array.reduce((prev, current, index, arr) => {
        try {
          return reducer(prev, current, index, arr);
        } catch (error) {
          reportError(error, "safeArray.reduce-reducer", {
            current,
            index,
          });
          return prev; // Return previous value on error
        }
      }, initialValue);
    } catch (error) {
      reportError(error, "safeArray.reduce", { array });
      return initialValue;
    }
  },

  // Safe find operation
  find<T>(
    array: T[] | undefined | null,
    predicate: (value: T, index: number, obj: T[]) => boolean,
  ): T | undefined {
    try {
      if (!array || !Array.isArray(array)) return undefined;
      return array.find((item, index, arr) => {
        try {
          return predicate(item, index, arr);
        } catch (error) {
          reportError(error, "safeArray.find-predicate", { item, index });
          return false;
        }
      });
    } catch (error) {
      reportError(error, "safeArray.find", { array });
      return undefined;
    }
  },

  // Safe array length
  length(array: unknown[] | undefined | null): number {
    try {
      return array && Array.isArray(array) ? array.length : 0;
    } catch (error) {
      reportError(error, "safeArray.length");
      return 0;
    }
  },
};

// Safe object property access
export function safeGet<T>(
  object: Record<string, unknown>,
  path: string | string[],
  fallback?: T,
): T | undefined {
  try {
    if (!object || typeof object !== "object") return fallback;

    const keys = Array.isArray(path) ? path : path.split(".");
    let result = object;

    for (const key of keys) {
      if (result?.[key] === undefined || result?.[key] === null) {
        return fallback;
      }
      result = result[key];
    }

    return result as T;
  } catch (error) {
    reportError(error, "safeGet", { path, object });
    return fallback;
  }
}

// Error boundary hook
export function useErrorBoundary() {
  const [error, setError] = useState<ErrorState | null>(null);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const captureError = useCallback((error: Error, errorInfo?: string) => {
    const errorState: ErrorState = {
      hasError: true,
      errorMessage: error.message || "Unknown error occurred",
      errorDetails: errorInfo || error.stack,
      timestamp: Date.now(),
    };

    setError(errorState);
    reportError(error, "useErrorBoundary.captureError", {
      errorInfo,
    });
  }, []);

  const refreshPage = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    error,
    resetError,
    captureError,
    refreshPage,
    hasError: error?.hasError || false,
  };
}

// Error display component
interface ErrorDisplayProps {
  error: ErrorState;
  onReset: () => void;
  onRefresh: () => void;
  className?: string;
}

export function ErrorDisplay({
  error,
  onReset,
  onRefresh,
  className = "m-4",
}: ErrorDisplayProps) {
  return (
    <Alert className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <div>
            <strong>Application Error:</strong> {error.errorMessage}
          </div>
          {error.errorDetails && (
            <details className="text-xs text-muted-foreground">
              <summary>Error Details</summary>
              <pre className="mt-1 whitespace-pre-wrap">
                {error.errorDetails}
              </pre>
            </details>
          )}
          <div className="flex gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={onReset}>
              Try Again
            </Button>
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh Page
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Error occurred at: {new Date(error.timestamp).toLocaleString()}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// Safe component wrapper HOC
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallbackMessage?: string,
) {
  return function SafeComponent(props: P) {
    const { error, resetError, captureError, refreshPage, hasError } =
      useErrorBoundary();

    // Wrap component rendering in error boundary
    const renderSafeComponent = safeRender(
      () => <Component {...props} />,
      fallbackMessage ||
        `${Component.displayName || Component.name || "Component"} failed to render`,
      captureError,
    );

    if (hasError && error) {
      return (
        <ErrorDisplay
          error={error}
          onReset={resetError}
          onRefresh={refreshPage}
        />
      );
    }

    return renderSafeComponent();
  };
}

// Async operation wrapper
export async function safeAsync<T>(
  asyncOperation: () => Promise<T>,
  fallbackValue?: T,
  onError?: (error: Error) => void,
): Promise<T | typeof fallbackValue> {
  try {
    return await asyncOperation();
  } catch (error) {
    const errorObj = reportError(error, "safeAsync");

    if (onError) {
      onError(errorObj);
    }

    return fallbackValue;
  }
}

// Type-safe data validation
export function validateData<T>(
  data: unknown,
  validator: (data: unknown) => data is T,
  fallback: T,
): T {
  try {
    if (validator(data)) {
      return data;
    }
    reportError(new Error("Data validation failed"), "validateData", {
      data,
    });
    return fallback;
  } catch (error) {
    reportError(error, "validateData", { data });
    return fallback;
  }
}

// Performance-aware error logging
export function logError(
  context: string,
  error: Error,
  additionalData?: Record<string, unknown>,
) {
  const errorData = {
    context,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: window.location.href,
    ...additionalData,
  };

  reportError(error, `logError:${context}`, errorData);
}
