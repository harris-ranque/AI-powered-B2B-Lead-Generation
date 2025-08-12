import { ConvexProvider as BaseConvexProvider } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ReactNode } from "react";
import { convex, isConvexConfigured } from "@/lib/convex";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConvexProviderProps {
  children: ReactNode;
}

function ConvexErrorFallback() {
  const handleRefresh = () => {
    window.location.reload();
  };

  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  const isDev = import.meta.env.DEV;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription className="mt-2">
            Unable to connect to the backend service. 
            {!convexUrl || convexUrl.includes('placeholder') ? (
              <div className="mt-2">
                <strong>Configuration Issue:</strong> Missing or invalid Convex URL.
                {isDev && <div className="text-xs mt-1 font-mono">Current URL: {convexUrl || 'undefined'}</div>}
              </div>
            ) : (
              <div>
                This may be due to:
                <ul className="list-disc pl-4 mt-2 space-y-1">
                  <li>Temporary service maintenance</li>
                  <li>Network connectivity issues</li>
                  <li>Backend deployment in progress</li>
                </ul>
              </div>
            )}
          </AlertDescription>
        </Alert>
        <div className="mt-4 text-center">
          <Button onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </div>
        {isDev && (
          <div className="mt-4 text-xs text-gray-600 bg-gray-100 p-2 rounded">
            <div><strong>Debug Info:</strong></div>
            <div>Environment: {import.meta.env.MODE}</div>
            <div>Convex URL: {convexUrl || 'Not set'}</div>
            <div>All VITE_ vars: {Object.keys(import.meta.env).filter(k => k.startsWith('VITE_')).join(', ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConvexProvider({ children }: ConvexProviderProps) {
  // Check if Convex is properly configured
  if (!isConvexConfigured()) {
    return <ConvexErrorFallback />;
  }

  try {
    return (
      <BaseConvexProvider client={convex}>
        <ConvexAuthProvider>
          {children}
        </ConvexAuthProvider>
      </BaseConvexProvider>
    );
  } catch (error) {
    console.error("ConvexProvider error:", error);
    // If this is the specific "options" error, provide more specific guidance
    if (error instanceof Error && error.message.includes("options")) {
      console.error("This appears to be a Convex auth configuration issue. Please check version compatibility.");
    }
    return <ConvexErrorFallback />;
  }
}