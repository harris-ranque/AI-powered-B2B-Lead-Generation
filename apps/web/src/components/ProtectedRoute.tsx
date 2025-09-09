import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { SubscriptionGuard } from "./SubscriptionGuard";
import { FeatureKey } from "@/hooks/useSubscriptionGuard";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  requireFeature?: FeatureKey;
  requireAction?: "search" | "export" | "bulk_operation";
  redirectTo?: string;
}

export function ProtectedRoute({
  children,
  requireAuth = true,
  requireFeature,
  requireAction,
  redirectTo = "/signin"
}: ProtectedRouteProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const location = useLocation();

  // Wait for auth to load
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Check authentication
  if (requireAuth && !isSignedIn) {
    return <Navigate to={`${redirectTo}?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // Check subscription requirements
  if (requireFeature || requireAction) {
    return (
      <SubscriptionGuard
        feature={requireFeature}
        action={requireAction}
        showUpgrade={true}
      >
        {children}
      </SubscriptionGuard>
    );
  }

  return <>{children}</>;
}

// Specific route protection components for common use cases
export function DashboardRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute requireAuth={true}>
      {children}
    </ProtectedRoute>
  );
}

export function EmailGenerationRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute requireAuth={true} requireFeature="email_generation">
      {children}
    </ProtectedRoute>
  );
}

export function BulkOperationsRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute requireAuth={true} requireFeature="bulk_operations">
      {children}
    </ProtectedRoute>
  );
}

export function APIAccessRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute requireAuth={true} requireFeature="api_access">
      {children}
    </ProtectedRoute>
  );
}

export function AdvancedAnalyticsRoute({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute requireAuth={true} requireFeature="advanced_analytics">
      {children}
    </ProtectedRoute>
  );
}