import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, Crown, Zap, ArrowRight, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import {
  useSubscriptionGuard,
  FeatureKey,
  PlanTier,
} from "@/hooks/useSubscriptionGuard";

interface SubscriptionGuardProps {
  children: React.ReactNode;
  feature?: FeatureKey;
  action?: "search" | "export" | "bulk_operation";
  fallback?: React.ReactNode;
  showUpgrade?: boolean;
}

export function SubscriptionGuard({
  children,
  feature,
  action,
  fallback,
  showUpgrade = true,
}: SubscriptionGuardProps) {
  const {
    hasFeature,
    canPerformAction,
    getUpgradeSuggestion,
    isLoading,
    currentPlan,
  } = useSubscriptionGuard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Check feature access
  if (feature && !hasFeature(feature)) {
    const suggestion = getUpgradeSuggestion(feature);

    if (fallback) {
      return <>{fallback}</>;
    }

    if (!showUpgrade) {
      return null;
    }

    return (
      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-700">
            <Lock className="h-5 w-5" />
            Feature Locked
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-orange-600">
            This feature is not available on your current plan.
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              Current: {currentPlan}
            </Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge className="bg-gradient-to-r from-blue-500 to-purple-600 text-white capitalize">
              Upgrade to: {suggestion.suggestedPlan}
            </Badge>
          </div>
          <Link to="/pricing">
            <Button className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700">
              <Crown className="h-4 w-4 mr-2" />
              Upgrade Plan
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Check action limits
  if (action) {
    const actionResult = canPerformAction(action);

    if (!actionResult.allowed) {
      if (fallback) {
        return <>{fallback}</>;
      }

      if (!showUpgrade) {
        return null;
      }

      return (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              Usage Limit Reached
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-red-600">{actionResult.reason}</p>
            {actionResult.upgradeRequired && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    Current: {currentPlan}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Badge className="bg-gradient-to-r from-blue-500 to-purple-600 text-white capitalize">
                    Upgrade to: {actionResult.upgradeRequired}
                  </Badge>
                </div>
                <Link to="/pricing">
                  <Button className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700">
                    <Zap className="h-4 w-4 mr-2" />
                    Upgrade for More Usage
                  </Button>
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      );
    }
  }

  // Access granted - render children
  return <>{children}</>;
}

// Convenience component for showing upgrade prompts
export function UpgradePrompt({
  feature,
  title,
  description,
}: {
  feature?: FeatureKey;
  title?: string;
  description?: string;
}) {
  const { getUpgradeSuggestion, currentPlan } = useSubscriptionGuard();

  const suggestion = feature
    ? getUpgradeSuggestion(feature)
    : {
        suggestedPlan: "professional" as PlanTier,
        reason: "Upgrade to unlock more features",
      };

  return (
    <Alert className="border-blue-200 bg-blue-50/50">
      <Crown className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-blue-800">
        <div className="flex items-center justify-between">
          <div>
            <strong>{title || "Upgrade Available"}</strong>
            <p className="text-sm mt-1">{description || suggestion.reason}</p>
          </div>
          <Link to="/pricing">
            <Button size="sm" className="ml-4">
              Upgrade
            </Button>
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// Component for showing usage warnings
export function UsageWarnings() {
  const { getUsageWarnings } = useSubscriptionGuard();
  const warnings = getUsageWarnings();

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning, index) => (
        <Alert
          key={`${warning.type}-${index}`}
          className={
            warning.severity === "danger"
              ? "border-red-200 bg-red-50/50"
              : "border-orange-200 bg-orange-50/50"
          }
        >
          <AlertCircle
            className={`h-4 w-4 ${warning.severity === "danger" ? "text-red-600" : "text-orange-600"}`}
          />
          <AlertDescription
            className={
              warning.severity === "danger" ? "text-red-800" : "text-orange-800"
            }
          >
            <div className="flex items-center justify-between">
              <span>{warning.message}</span>
              <Link to="/pricing">
                <Button size="sm" variant="outline">
                  Upgrade
                </Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
