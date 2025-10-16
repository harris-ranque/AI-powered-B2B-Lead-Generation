import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Home, ArrowLeft, Search } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <AlertTriangle className="h-16 w-16 text-muted-foreground" />
          </div>
          <CardTitle className="text-4xl font-bold">404</CardTitle>
          <CardDescription className="text-xl">
            Oops! Page not found
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-6">
              The page you're looking for doesn't exist or has been moved.
            </p>
            <p className="text-xs text-muted-foreground mb-4 font-mono bg-muted/50 p-2 rounded">
              Attempted path: {location.pathname}
            </p>
            <div className="flex flex-col gap-3">
              <Link to="/">
                <Button className="w-full">
                  <Home className="mr-2 h-4 w-4" />
                  Go Home
                </Button>
              </Link>
              <Link to="/app">
                <Button variant="outline" className="w-full">
                  <Search className="mr-2 h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
              <Button
                variant="ghost"
                onClick={() => window.history.back()}
                className="w-full"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go Back
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default NotFound;
