import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreditCard, AlertCircle, Zap, Key } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { Link } from "react-router-dom";

export function SubscriptionStatusCard() {
  const {
    subscription,
    isLoading,
    planName,
    getStatusBadge,
    isStarter,
    hasActiveSubscription,
  } = useSubscription();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Loading subscription status...
          </p>
        </CardContent>
      </Card>
    );
  }

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isStarter ? (
              <Key className="h-5 w-5" />
            ) : (
              <CreditCard className="h-5 w-5" />
            )}
            Current Plan
          </div>
          {statusBadge && (
            <Badge
              variant={statusBadge.variant}
              className={statusBadge.className}
            >
              {statusBadge.text}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg">{planName}</span>
            </div>
            {subscription?.billing && (
              <p className="text-sm text-muted-foreground">
                ${subscription.billing.amount}/
                {subscription.billing.billingCycle === "yearly"
                  ? "year"
                  : "month"}
              </p>
            )}
            {isStarter && (
              <p className="text-sm text-muted-foreground">
                Managed API keys included
              </p>
            )}
          </div>
          <div className="text-right">
            <Zap className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Managed APIs</p>
          </div>
        </div>

        {subscription?.billing && (
          <>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                Next billing:{" "}
                {new Date(
                  subscription.billing.currentPeriodEnd,
                ).toLocaleDateString()}
              </p>
              {subscription.isTrialing && subscription.billing.trialEnd && (
                <p className="text-blue-600">
                  Trial ends:{" "}
                  {new Date(subscription.billing.trialEnd).toLocaleDateString()}
                </p>
              )}
            </div>

            {subscription.billing.cancelAtPeriodEnd && (
              <div className="flex items-center gap-2 p-2 bg-orange-50 border border-orange-200 rounded-lg">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <p className="text-xs text-orange-800">
                  Subscription ends{" "}
                  {new Date(
                    subscription.billing.currentPeriodEnd,
                  ).toLocaleDateString()}
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2">
          {isStarter ? (
            <Link to="/pricing" className="flex-1">
              <Button size="sm" variant="outline" className="w-full">
                Upgrade Plan
              </Button>
            </Link>
          ) : (
            <Link to="/billing" className="flex-1">
              <Button size="sm" variant="outline" className="w-full">
                Manage Billing
              </Button>
            </Link>
          )}
          {!isStarter && (
            <Link to="/pricing">
              <Button size="sm" variant="ghost">
                Change Plan
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
