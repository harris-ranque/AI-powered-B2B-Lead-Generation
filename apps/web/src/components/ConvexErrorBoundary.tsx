import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ConvexErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

interface ConvexErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export class ConvexErrorBoundary extends React.Component<
  ConvexErrorBoundaryProps,
  ConvexErrorBoundaryState
> {
  constructor(props: ConvexErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ConvexErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ConvexErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
    
    // Log to external error tracking service if available
    if (typeof window !== 'undefined' && 'gtag' in window) {
      // @ts-expect-error gtag is loaded dynamically by Google Analytics
      window.gtag('event', 'exception', {
        description: error.message,
        fatal: false,
      });
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      const { fallback: Fallback } = this.props;
      
      if (Fallback) {
        return <Fallback error={this.state.error} resetError={this.resetError} />;
      }

      return (
        <div className="p-4 max-w-2xl mx-auto">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription className="mt-2">
              We encountered an error while loading this section. This might be due to:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Network connectivity issues</li>
                <li>Temporary server problems</li>
                <li>Invalid data format</li>
              </ul>
            </AlertDescription>
            <div className="flex gap-2 mt-4">
              <Button onClick={this.resetError} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button 
                onClick={() => window.location.reload()} 
                variant="outline" 
                size="sm"
              >
                Reload Page
              </Button>
            </div>
          </Alert>
          
          {process.env.NODE_ENV === 'development' && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-gray-600">
                Error Details (Development Only)
              </summary>
              <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
                {this.state.error?.stack}
              </pre>
              {this.state.errorInfo && (
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export function useConvexErrorBoundary() {
  return React.useContext(ConvexErrorBoundaryContext);
}

const ConvexErrorBoundaryContext = React.createContext<{
  reportError: (error: Error) => void;
}>({
  reportError: () => {},
});

export function ConvexErrorBoundaryProvider({ 
  children,
  onError,
}: {
  children: React.ReactNode;
  onError?: (error: Error) => void;
}) {
  const reportError = React.useCallback((error: Error) => {
    console.error('Reported error:', error);
    onError?.(error);
    throw error; // Re-throw to trigger error boundary
  }, [onError]);

  return (
    <ConvexErrorBoundaryContext.Provider value={{ reportError }}>
      <ConvexErrorBoundary onError={onError}>
        {children}
      </ConvexErrorBoundary>
    </ConvexErrorBoundaryContext.Provider>
  );
}