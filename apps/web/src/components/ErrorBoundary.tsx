import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleRefresh = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = "/";
  };

  private isEnvironmentError = (error: Error) => {
    return (
      error.message.includes("VITE_CONVEX_URL") ||
      error.message.includes("environment variable") ||
      error.message.includes("Missing")
    );
  };

  private isNetworkError = (error: Error) => {
    return (
      error.message.includes("network") ||
      error.message.includes("fetch") ||
      error.message.includes("connection")
    );
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isEnvError = this.isEnvironmentError(this.state.error);
      const isNetError = this.isNetworkError(this.state.error);

      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <CardTitle className="text-xl font-semibold text-gray-900">
                {isEnvError ? "Configuration Error" : "Something went wrong"}
              </CardTitle>
              <CardDescription>
                {isEnvError
                  ? "The application is missing required configuration."
                  : isNetError
                    ? "Unable to connect to our services."
                    : "An unexpected error occurred."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error Details</AlertTitle>
                <AlertDescription className="mt-2 text-sm">
                  {this.state.error.message}
                </AlertDescription>
              </Alert>

              {isEnvError && (
                <Alert>
                  <AlertTitle>What can you do?</AlertTitle>
                  <AlertDescription className="mt-2 space-y-2 text-sm">
                    <p>This usually happens when:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>The app is being deployed or updated</li>
                      <li>Environment configuration is being updated</li>
                      <li>There's a temporary service issue</li>
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex space-x-2">
                <Button onClick={this.handleRefresh} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  variant="outline"
                  className="flex-1"
                >
                  <Home className="mr-2 h-4 w-4" />
                  Go Home
                </Button>
              </div>

              {process.env.NODE_ENV === "development" &&
                this.state.errorInfo && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-gray-500">
                      Development Details
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-600 bg-gray-50 p-2 rounded">
                      {this.state.error.stack}
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Functional component wrapper for easier usage
interface ErrorBoundaryWrapperProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ErrorBoundaryWrapper({
  children,
  fallback,
}: ErrorBoundaryWrapperProps) {
  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}
