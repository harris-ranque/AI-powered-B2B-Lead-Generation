/**
 * Subscription Status Component
 *
 * Customer-facing component showing:
 * - Current subscription status
 * - Credit balance breakdown (subscription vs purchased)
 * - Billing period information
 * - Quick actions
 */

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CreditCard,
  Coins,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";

interface CreditBreakdown {
  subscriptionCredits: number;
  purchasedCredits: number;
  totalCredits: number;
  subscriptionLimit?: number;
}

type SubscriptionStatus = "active" | "pending_checkout" | "past_due" | "cancelled" | "paused";

const statusConfig: Record<
  SubscriptionStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; message: string }
> = {
  active: {
    label: "Active",
    variant: "default",
    icon: <CheckCircle className="h-4 w-4" />,
    message: "Your subscription is active and credits renew on your billing date.",
  },
  pending_checkout: {
    label: "Pending Setup",
    variant: "secondary",
    icon: <Clock className="h-4 w-4" />,
    message: "Please complete checkout to activate your subscription.",
  },
  past_due: {
    label: "Past Due",
    variant: "destructive",
    icon: <AlertTriangle className="h-4 w-4" />,
    message: "Your payment failed. Please update your payment method to restore credits.",
  },
  cancelled: {
    label: "Cancelled",
    variant: "outline",
    icon: <AlertTriangle className="h-4 w-4" />,
    message: "Your subscription has been cancelled.",
  },
  paused: {
    label: "Paused",
    variant: "secondary",
    icon: <Clock className="h-4 w-4" />,
    message: "Your subscription is paused. Credits are not being allocated.",
  },
};

export function SubscriptionStatus() {
  // Get current user data with credit breakdown
  const userData = useQuery(api.users.queries.getCurrentUserData);

  // Get user's active subscription if they have one
  const subscription = useQuery(
    api.billing.stripe.subscriptions.getActiveSubscriptionForUser,
    userData ? { userId: userData._id } : "skip"
  );

  if (!userData) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const creditBreakdown: CreditBreakdown = {
    subscriptionCredits: userData.subscriptionCredits || 0,
    purchasedCredits: userData.credits || 0,
    totalCredits: (userData.subscriptionCredits || 0) + (userData.credits || 0),
    subscriptionLimit: subscription?.monthlyCredits,
  };

  const hasSubscription = subscription && subscription.status !== "cancelled";
  const status = subscription?.status as SubscriptionStatus | undefined;
  const statusInfo = status ? statusConfig[status] : null;

  // Calculate subscription credit usage percentage
  const subscriptionUsagePercent = subscription?.monthlyCredits
    ? Math.round(((subscription.monthlyCredits - creditBreakdown.subscriptionCredits) / subscription.monthlyCredits) * 100)
    : 0;

  // Format date helper
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Format currency helper
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="space-y-6">
      {/* Subscription Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Subscription
              </CardTitle>
              <CardDescription>
                {hasSubscription
                  ? "Your custom subscription plan"
                  : "You don't have an active subscription"}
              </CardDescription>
            </div>
            {statusInfo && (
              <Badge variant={statusInfo.variant} className="flex items-center gap-1">
                {statusInfo.icon}
                {statusInfo.label}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasSubscription && subscription ? (
            <>
              {/* Status Alert */}
              {statusInfo && (
                <Alert>
                  <AlertDescription>{statusInfo.message}</AlertDescription>
                </Alert>
              )}

              {/* Pricing Info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">Monthly Price</div>
                  <div className="text-lg font-semibold">
                    {formatCurrency(subscription.monthlyPriceCents)}
                  </div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">Monthly Credits</div>
                  <div className="text-lg font-semibold">{subscription.monthlyCredits}</div>
                </div>
                {subscription.currentPeriodEnd && (
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Next Billing
                    </div>
                    <div className="text-lg font-semibold">
                      {formatDate(subscription.currentPeriodEnd)}
                    </div>
                  </div>
                )}
              </div>

              {/* Checkout Link for Pending */}
              {status === "pending_checkout" && subscription.checkoutUrl && (
                <Button asChild className="w-full">
                  <a href={subscription.checkoutUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Complete Checkout
                  </a>
                </Button>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">
                Contact our sales team to get a custom subscription plan.
              </p>
              <Button variant="outline" asChild>
                <a href="mailto:sales@genni.ai">Contact Sales</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credit Balance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Credit Balance
          </CardTitle>
          <CardDescription>
            Your available credits for lead generation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Total Credits */}
          <div className="text-center p-4 bg-primary/5 rounded-lg">
            <div className="text-3xl font-bold">{creditBreakdown.totalCredits}</div>
            <div className="text-sm text-muted-foreground">Total Available Credits</div>
          </div>

          {/* Credit Breakdown */}
          <div className="space-y-4">
            {/* Subscription Credits */}
            {hasSubscription && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-primary" />
                    Subscription Credits
                  </span>
                  <span className="text-sm">
                    {creditBreakdown.subscriptionCredits}
                    {creditBreakdown.subscriptionLimit && (
                      <span className="text-muted-foreground">
                        {" "}
                        / {creditBreakdown.subscriptionLimit}
                      </span>
                    )}
                  </span>
                </div>
                <Progress value={100 - subscriptionUsagePercent} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Used first. Resets on your billing date (no rollover).
                </p>
              </div>
            )}

            {/* Purchased Credits */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Coins className="h-4 w-4 text-green-500" />
                  Purchased Credits
                </span>
                <span className="text-sm">{creditBreakdown.purchasedCredits}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {hasSubscription
                  ? "Used after subscription credits are depleted. Never expire."
                  : "Your available credits. Never expire."}
              </p>
            </div>
          </div>

          {/* Credit Usage Info */}
          {hasSubscription && (
            <Alert>
              <Coins className="h-4 w-4" />
              <AlertDescription>
                <strong>Credit Priority:</strong> Subscription credits are used first, then
                purchased credits. Subscription credits reset monthly and don't roll over.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
