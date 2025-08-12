import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Code, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

interface DeveloperRouteProps {
  children: ReactNode;
}

export function DeveloperRoute({ children }: DeveloperRouteProps) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center mb-4">
              <Code className="h-12 w-12 text-primary" />
            </div>
            <CardTitle>Developer Access Required</CardTitle>
            <CardDescription>
              Please sign in with a developer account to access the royalty dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Link to="/signin">
              <Button className="w-full">
                Sign In
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if user has developer role or is the designated developer
  const isDeveloper = user?.role === 'developer' || 
                     user?.isDeveloper === true ||
                     user?.email === process.env.NEXT_PUBLIC_DEVELOPER_EMAIL;

  if (!isDeveloper) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access the developer royalty dashboard. This section is reserved for Lead Eternity developers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Current user: {user?.email}
              </p>
              <div className="flex flex-col gap-2">
                <Link to="/app">
                  <Button variant="outline" className="w-full">
                    Go to Dashboard
                  </Button>
                </Link>
                <Link to="/contact">
                  <Button variant="ghost" className="w-full">
                    Contact Support
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}