import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Navigate, useLocation } from "react-router-dom";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirectUrl = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        replace
        to={`/signin?redirect_url=${encodeURIComponent(redirectUrl)}`}
      />
    );
  }

  return <>{children}</>;
}
