import React, { Component, ErrorInfo, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Bug } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorBoundaryId: string;
}

/**
 * Global Error Boundary for bulletproof React error handling
 * Catches all uncaught JavaScript errors and prevents app crashes
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorBoundaryId: Math.random().toString(36).substring(7),
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging
    console.error("Global Error Boundary caught error:", {
      error,
      errorInfo,
      errorBoundaryId: this.state.errorBoundaryId,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      stack: error.stack,
    });

    this.setState({
      error,
      errorInfo,
    });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // In production, send to error tracking service
    if (process.env.NODE_ENV === "production") {
      // Integration point for error tracking services like Sentry
      // window.errorTracker?.captureException(error, {
      //   extra: { errorInfo, errorBoundaryId: this.state.errorBoundaryId }
      // });
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-2xl">
            <Alert className="border-destructive">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <AlertDescription>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg mb-2">
                      Application Error
                    </h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Sorry, something went wrong. The application encountered
                      an unexpected error.
                    </p>
                    {this.state.error && (
                      <div className="bg-muted p-3 rounded text-sm">
                        <strong>Error:</strong> {this.state.error.message}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <Button onClick={this.handleReset} variant="default">
                      Try Again
                    </Button>
                    <Button onClick={this.handleRefresh} variant="outline">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh Page
                    </Button>
                  </div>

                  {process.env.NODE_ENV === "development" &&
                    this.state.errorInfo && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm font-medium flex items-center gap-2">
                          <Bug className="h-4 w-4" />
                          Developer Details
                        </summary>
                        <div className="mt-2 p-3 bg-muted rounded text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                          <div className="mb-2">
                            <strong>Error Boundary ID:</strong>{" "}
                            {this.state.errorBoundaryId}
                          </div>
                          <div className="mb-2">
                            <strong>Component Stack:</strong>
                          </div>
                          {this.state.errorInfo.componentStack}
                          {this.state.error?.stack && (
                            <div className="mt-4">
                              <strong>Error Stack:</strong>
                              <br />
                              {this.state.error.stack}
                            </div>
                          )}
                        </div>
                      </details>
                    )}

                  <div className="text-xs text-muted-foreground">
                    <p>Error ID: {this.state.errorBoundaryId}</p>
                    <p>Time: {new Date().toLocaleString()}</p>
                    <p>If this problem persists, please contact support.</p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// HOC for easy wrapping of components
export function withGlobalErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode,
) {
  return function ErrorBoundaryWrappedComponent(props: P) {
    return (
      <GlobalErrorBoundary fallback={fallback}>
        <Component {...props} />
      </GlobalErrorBoundary>
    );
  };
}

// Hook for programmatic error boundary usage
export function useErrorHandler() {
  const [errorBoundaryKey, setErrorBoundaryKey] = React.useState(0);

  const resetErrorBoundary = React.useCallback(() => {
    setErrorBoundaryKey((prev) => prev + 1);
  }, []);

  const captureError = React.useCallback((error: Error, errorInfo?: string) => {
    console.error("Manual error capture:", error, errorInfo);
    throw error; // Re-throw to trigger error boundary
  }, []);

  return {
    resetErrorBoundary,
    captureError,
    errorBoundaryKey,
  };
}
