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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription className="mt-2">
            Unable to connect to the backend service. This may be due to:
            <ul className="list-disc pl-4 mt-2 space-y-1">
              <li>Temporary service maintenance</li>
              <li>Network connectivity issues</li>
              <li>Configuration updates in progress</li>
            </ul>
          </AlertDescription>
        </Alert>
        <div className="mt-4 text-center">
          <Button onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </div>
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
    return <ConvexErrorFallback />;
  }
}