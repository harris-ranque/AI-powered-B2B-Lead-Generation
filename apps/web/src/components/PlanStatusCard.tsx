import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CreditCard,
  AlertCircle,
  Zap,
  Key,
  Search,
  Target,
  Download,
  TrendingUp,
  Calendar,
  Building2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCustomSubscription } from "@/hooks/useCustomSubscription";
import { useSubscription } from "@/hooks/useSubscription";
import { useUsage } from "@/hooks/useUsage";

export function PlanStatusCard() {
  const customSub = useCustomSubscription();
  const standardSub = useSubscription();
  const usage = useUsage();

  // Loading state
  if (customSub.isLoading || standardSub.isLoading || usage.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading plan details...</p>
        </CardContent>
      </Card>
    );
  }

  // Custom subscription view
  if (customSub.hasCustomSubscription && customSub.subscription) {
    return <CustomPlanCard customSub={customSub} />;
  }

  // Standard plan view
  return <StandardPlanCard standardSub={standardSub} usage={usage} />;
}

// Custom subscription plan card with credit bar chart
function CustomPlanCard({ customSub }: { customSub: ReturnType<typeof useCustomSubscription> }) {
  const { subscription, currentAllocation, creditUsagePercent } = customSub;
  const statusBadge = customSub.getStatusBadge(subscription?.status);
  const progressColor = customSub.getProgressColor(creditUsagePercent);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Current Plan
          </div>
          <Badge variant={statusBadge.variant} className={statusBadge.className}>
            {statusBadge.text}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Plan details */}
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-lg">Custom Plan</span>
            <p className="text-sm text-muted-foreground">
              {customSub.formatPrice(subscription?.monthlyPriceCents)}/mo · {customSub.getPaymentMethodName(subscription?.paymentMethodType)}
            </p>
          </div>
          <div className="text-right">
            <Zap className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Managed APIs</p>
          </div>
        </div>

        {/* Credit usage bar chart */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Credit Usage</span>
            <span className={`text-sm font-semibold ${customSub.getUsageColor(creditUsagePercent)}`}>
              {creditUsagePercent}%
            </span>
          </div>
          <div className="relative">
            <Progress value={creditUsagePercent} className="h-3" />
            <div
              className={`absolute top-0 left-0 h-3 rounded-full transition-all ${progressColor}`}
              style={{ width: `${creditUsagePercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{currentAllocation?.creditsUsed.toLocaleString() ?? 0} used</span>
            <span>{currentAllocation?.creditsRemaining.toLocaleString() ?? 0} remaining</span>
            <span>{currentAllocation?.creditsAllocated.toLocaleString() ?? subscription?.monthlyCredits.toLocaleString()} allocated</span>
          </div>
        </div>

        {/* Next allocation date */}
        {currentAllocation && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
            <Calendar className="h-4 w-4" />
            <span>
              Next allocation: {new Date(currentAllocation.periodEnd).toLocaleDateString()} ({currentAllocation.daysRemaining} days)
            </span>
          </div>
        )}

        {/* Warning for near limit */}
        {creditUsagePercent >= 80 && (
          <div className="flex items-center gap-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            <p className="text-xs text-orange-800">
              {creditUsagePercent >= 90
                ? "Credit usage critical - consider purchasing additional credits"
                : "Approaching credit limit for this period"}
            </p>
          </div>
        )}

        {/* Past due warning */}
        {subscription?.status === "past_due" && (
          <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <p className="text-xs text-red-800">
              Payment past due - please update your payment method
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Link to="/billing" className="flex-1">
            <Button size="sm" variant="outline" className="w-full">
              Manage Billing
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// Standard plan card with usage meters
function StandardPlanCard({
  standardSub,
  usage,
}: {
  standardSub: ReturnType<typeof useSubscription>;
  usage: ReturnType<typeof useUsage>;
}) {
  const { subscription, planName, getStatusBadge, isStarter, hasActiveSubscription } = standardSub;
  const {
    usage: usageData,
    searchesPercentage,
    enrichmentsPercentage,
    exportsPercentage,
    getUsageColor,
    getProgressColor,
    hasUnlimitedSearches,
    hasUnlimitedEnrichments,
    hasUnlimitedExports,
    isNearLimit,
  } = usage;

  // No subscription state
  if (!subscription?.billing && !hasActiveSubscription && !isStarter) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            No Active Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You don't have an active subscription. Choose a plan to get started.
          </p>
          <Link to="/pricing">
            <Button size="sm" className="w-full bg-primary hover:bg-primary/90">
              View Plans
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const statusBadge = subscription?.billing
    ? getStatusBadge(subscription.billing.status, subscription.isTrialing)
    : null;

  const nearLimitCount = [
    isNearLimit(searchesPercentage) && !hasUnlimitedSearches,
    isNearLimit(enrichmentsPercentage) && !hasUnlimitedEnrichments,
    isNearLimit(exportsPercentage) && !hasUnlimitedExports,
  ].filter(Boolean).length;

  return (
    <Card className={nearLimitCount > 0 ? "border-orange-200" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isStarter ? <Key className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
            Current Plan
          </div>
          {statusBadge && (
            <Badge variant={statusBadge.variant} className={statusBadge.className}>
              {statusBadge.text}
            </Badge>
          )}
        </CardTitle>
        {usageData && (
          <p className="text-sm text-muted-foreground">
            Billing period ends {new Date(usageData.period.end).toLocaleDateString()}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Plan info */}
        <div className="flex items-center justify-between">
          <div>
            <span className="font-semibold text-lg">{planName}</span>
            {subscription?.billing && (
              <p className="text-sm text-muted-foreground">
                ${subscription.billing.amount}/{subscription.billing.billingCycle === "yearly" ? "year" : "month"}
              </p>
            )}
            {isStarter && (
              <p className="text-sm text-muted-foreground">Managed API keys included</p>
            )}
          </div>
          <div className="text-right">
            <Zap className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Managed APIs</p>
          </div>
        </div>

        {/* Usage meters */}
        {usageData && (
          <div className="space-y-4 pt-2 border-t">
            {/* Searches */}
            <UsageMeter
              icon={<Search className="h-4 w-4" />}
              label="Searches"
              used={usageData.searchesUsed}
              percentage={searchesPercentage}
              isUnlimited={hasUnlimitedSearches}
              getUsageColor={getUsageColor}
              getProgressColor={getProgressColor}
              isNearLimit={isNearLimit(searchesPercentage) && !hasUnlimitedSearches}
            />

            {/* Enrichments */}
            <UsageMeter
              icon={<Target className="h-4 w-4" />}
              label="Lead Contacts Found"
              used={usageData.leadsEnriched}
              percentage={enrichmentsPercentage}
              isUnlimited={hasUnlimitedEnrichments}
              getUsageColor={getUsageColor}
              getProgressColor={getProgressColor}
              isNearLimit={isNearLimit(enrichmentsPercentage) && !hasUnlimitedEnrichments}
            />

            {/* Exports */}
            <UsageMeter
              icon={<Download className="h-4 w-4" />}
              label="Exports"
              used={usageData.exportsCompleted}
              percentage={exportsPercentage}
              isUnlimited={hasUnlimitedExports}
              getUsageColor={getUsageColor}
              getProgressColor={getProgressColor}
              isNearLimit={isNearLimit(exportsPercentage) && !hasUnlimitedExports}
            />

            {/* Emails */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-medium">Emails Generated</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-semibold text-green-600">
                  {usageData.emailsGenerated}
                </span>
                <p className="text-xs text-muted-foreground">
                  {usageData.limits.emailGeneration ? "Unlimited" : "Upgrade to unlock"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Near limit warning */}
        {nearLimitCount > 0 && (
          <div className="flex items-center gap-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
            <AlertCircle className="h-4 w-4 text-orange-600" />
            <p className="text-xs text-orange-800">
              {nearLimitCount} resource{nearLimitCount > 1 ? "s" : ""} approaching limit
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {isStarter ? (
            <Link to="/pricing" className="flex-1">
              <Button size="sm" variant="outline" className="w-full">
                Upgrade Plan
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/billing" className="flex-1">
                <Button size="sm" variant="outline" className="w-full">
                  Manage Billing
                </Button>
              </Link>
              <Link to="/pricing">
                <Button size="sm" variant="ghost">
                  Change Plan
                </Button>
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Reusable usage meter component
function UsageMeter({
  icon,
  label,
  used,
  percentage,
  isUnlimited,
  getUsageColor,
  getProgressColor,
  isNearLimit,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  percentage: number;
  isUnlimited: boolean;
  getUsageColor: (p: number) => string;
  getProgressColor: (p: number) => string;
  isNearLimit: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="text-right">
          <span className={`text-lg font-semibold ${getUsageColor(percentage)}`}>
            {used.toLocaleString()}
          </span>
          <p className="text-xs text-muted-foreground">
            {isUnlimited ? "Unlimited" : `${percentage}% used`}
          </p>
        </div>
      </div>
      {!isUnlimited && (
        <div className="relative">
          <Progress value={percentage} className="h-2" />
          <div
            className={`absolute top-0 left-0 h-2 rounded-full transition-all ${getProgressColor(percentage)}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      {isNearLimit && (
        <p className="text-xs text-orange-600">⚠️ Approaching limit</p>
      )}
    </div>
  );
}
