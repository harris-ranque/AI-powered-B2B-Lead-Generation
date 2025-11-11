import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  Search,
  Target,
  Download,
  AlertTriangle,
} from "lucide-react";
import { useUsage } from "@/hooks/useUsage";
import { Link } from "react-router-dom";

export function UsageMetersCard() {
  const {
    usage,
    isLoading,
    searchesPercentage,
    enrichmentsPercentage,
    exportsPercentage,
    getUsageColor,
    getProgressColor,
    isNearLimit,
    isOverLimit,
    hasUnlimitedSearches,
    hasUnlimitedEnrichments,
    hasUnlimitedExports,
  } = useUsage();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Usage This Month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading usage data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!usage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Usage This Month
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No usage data available
          </p>
        </CardContent>
      </Card>
    );
  }

  const nearLimitCount = [
    isNearLimit(searchesPercentage) && !hasUnlimitedSearches,
    isNearLimit(enrichmentsPercentage) && !hasUnlimitedEnrichments,
    isNearLimit(exportsPercentage) && !hasUnlimitedExports,
  ].filter(Boolean).length;

  return (
    <Card className={nearLimitCount > 0 ? "border-orange-200" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Usage This Month
          </div>
          {nearLimitCount > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {nearLimitCount} near limit
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Billing period ends {new Date(usage.period.end).toLocaleDateString()}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Searches */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              <span className="text-sm font-medium">Searches</span>
            </div>
            <div className="text-right">
              <span className={`text-lg font-semibold ${getUsageColor(searchesPercentage)}`}>
                {usage.searchesUsed}
              </span>
              <p className="text-xs text-muted-foreground">
                {hasUnlimitedSearches ? "Unlimited" : `${searchesPercentage}% used`}
              </p>
            </div>
          </div>
          {!hasUnlimitedSearches && (
            <div className="relative">
              <Progress value={searchesPercentage} className="h-2" />
              <div
                className={`absolute top-0 left-0 h-2 rounded-full transition-all ${getProgressColor(searchesPercentage)}`}
                style={{ width: `${searchesPercentage}%` }}
              />
            </div>
          )}
          {isNearLimit(searchesPercentage) && !hasUnlimitedSearches && (
            <p className="text-xs text-orange-600">⚠️ Approaching limit</p>
          )}
        </div>

        {/* Enrichments */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span className="text-sm font-medium">Lead Contacts Found</span>
            </div>
            <div className="text-right">
              <span className={`text-lg font-semibold ${getUsageColor(enrichmentsPercentage)}`}>
                {usage.leadsEnriched.toLocaleString()}
              </span>
              <p className="text-xs text-muted-foreground">
                {hasUnlimitedEnrichments ? "Unlimited" : `${enrichmentsPercentage}% used`}
              </p>
            </div>
          </div>
          {!hasUnlimitedEnrichments && (
            <div className="relative">
              <Progress value={enrichmentsPercentage} className="h-2" />
              <div
                className={`absolute top-0 left-0 h-2 rounded-full transition-all ${getProgressColor(enrichmentsPercentage)}`}
                style={{ width: `${enrichmentsPercentage}%` }}
              />
            </div>
          )}
          {isNearLimit(enrichmentsPercentage) && !hasUnlimitedEnrichments && (
            <p className="text-xs text-orange-600">⚠️ Approaching limit</p>
          )}
        </div>

        {/* Exports */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              <span className="text-sm font-medium">Exports</span>
            </div>
            <div className="text-right">
              <span className={`text-lg font-semibold ${getUsageColor(exportsPercentage)}`}>
                {usage.exportsCompleted}
              </span>
              <p className="text-xs text-muted-foreground">
                {hasUnlimitedExports ? "Unlimited" : `${exportsPercentage}% used`}
              </p>
            </div>
          </div>
          {!hasUnlimitedExports && (
            <div className="relative">
              <Progress value={exportsPercentage} className="h-2" />
              <div
                className={`absolute top-0 left-0 h-2 rounded-full transition-all ${getProgressColor(exportsPercentage)}`}
                style={{ width: `${exportsPercentage}%` }}
              />
            </div>
          )}
          {isNearLimit(exportsPercentage) && !hasUnlimitedExports && (
            <p className="text-xs text-orange-600">⚠️ Approaching limit</p>
          )}
        </div>

        {/* Email Generation Feature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Emails Generated</span>
            </div>
            <div className="text-right">
              <span className="text-lg font-semibold text-green-600">
                {usage.emailsGenerated}
              </span>
              <p className="text-xs text-muted-foreground">
                {usage.limits.emailGeneration ? "Unlimited" : "Upgrade to unlock"}
              </p>
            </div>
          </div>
        </div>

        {/* Upgrade prompt if near limits */}
        {nearLimitCount > 0 && (
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-700">
                  Need more capacity?
                </p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to get higher limits
                </p>
              </div>
              <Link to="/pricing">
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
                >
                  Upgrade Plan
                </Button>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
