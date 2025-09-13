import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Bot,
  CreditCard,
  Calendar,
  AlertCircle,
  ExternalLink,
  Loader2,
  TrendingUp,
  Download,
  Settings,
  ArrowLeft,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { convex } from "@/lib/convex";

export default function SubscriptionManage() {
  const { isSignedIn, user } = useAuth();
  const navigate = useNavigate();
  const [isLoadingPortal, setIsLoadingPortal] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);

  // Get subscription status
  const { data: subscription, isLoading } = useQuery({
    queryKey: ["subscription-status"],
    queryFn: async () => {
      const result = await convex.mutation(
        "billing/mutations:getSubscriptionStatus",
        {},
      );
      return result;
    },
    enabled: !!isSignedIn,
  });

  // Get current usage
  const { data: usage } = useQuery({
    queryKey: ["current-usage"],
    queryFn: async () => {
      const result = await convex.query(
        "usageTracking/queries:getCurrentUsage",
        {},
      );
      return result;
    },
    enabled: !!isSignedIn,
  });

  const createPortalSession = useMutation({
    mutationFn: async () => {
      const result = await convex.action(
        "billing/mutations:createPortalSession",
        {},
      );
      return result;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open billing portal",
        variant: "destructive",
      });
      setIsLoadingPortal(false);
    },
  });

  const cancelSubscription = useMutation({
    mutationFn: async (cancelAtPeriodEnd: boolean) => {
      const result = await convex.action(
        "billing/mutations:cancelSubscription",
        {
          cancelAtPeriodEnd,
        },
      );
      return result;
    },
    onSuccess: (data) => {
      toast({
        title: data.cancelAtPeriodEnd
          ? "Subscription Canceled"
          : "Cancellation Undone",
        description: data.cancelAtPeriodEnd
          ? "Your subscription will end at the end of the current period"
          : "Your subscription will continue",
      });
      setIsCanceling(false);
      window.location.reload(); // Refresh to get updated data
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update subscription",
        variant: "destructive",
      });
      setIsCanceling(false);
    },
  });

  const handlePortalAccess = () => {
    setIsLoadingPortal(true);
    createPortalSession.mutate();
  };

  const handleCancelSubscription = () => {
    setIsCanceling(true);
    const willCancel = !subscription?.billing?.cancelAtPeriodEnd;
    cancelSubscription.mutate(willCancel);
  };

  if (!isSignedIn) {
    navigate("/signin");
    return null;
  }

  const planDisplayNames = {
    starter: "Starter",
    professional: "Professional",
    business: "Business",
    enterprise: "Enterprise",
  };

  const planName = subscription?.plan
    ? planDisplayNames[subscription.plan as keyof typeof planDisplayNames]
    : "Loading...";

  const getStatusBadge = (status: string, isTrialing: boolean) => {
    if (isTrialing) {
      return <Badge className="bg-blue-500">Free Trial</Badge>;
    }

    switch (status) {
      case "active":
        return <Badge className="bg-green-500">Active</Badge>;
      case "past_due":
        return <Badge variant="destructive">Past Due</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2">
            <Bot className="h-8 w-8 text-primary" />
            <span className="font-bold text-xl">Genni</span>
          </Link>

          <div className="flex items-center space-x-4">
            <Link to="/app">
              <Button variant="ghost">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Subscription Management</h1>
          <p className="text-muted-foreground">
            Manage your plan, view usage, and access billing information
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Subscription Overview */}
            <div className="lg:col-span-2 space-y-6">
              {/* Current Plan */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5" />
                        Current Plan
                      </CardTitle>
                      <CardDescription>
                        Your active subscription details
                      </CardDescription>
                    </div>
                    {subscription?.billing &&
                      getStatusBadge(
                        subscription.billing.status,
                        subscription.isTrialing,
                      )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {subscription?.billing ? (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-lg">{planName}</span>
                        <span className="text-2xl font-bold">
                          ${subscription.billing.amount}/
                          {subscription.billing.billingCycle === "yearly"
                            ? "year"
                            : "month"}
                        </span>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            Billing Cycle:
                          </span>
                          <span className="ml-2 capitalize">
                            {subscription.billing.billingCycle}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Next Payment:
                          </span>
                          <span className="ml-2">
                            {new Date(
                              subscription.billing.currentPeriodEnd,
                            ).toLocaleDateString()}
                          </span>
                        </div>
                        {subscription.isTrialing &&
                          subscription.billing.trialEnd && (
                            <>
                              <div className="md:col-span-2">
                                <span className="text-muted-foreground">
                                  Trial Ends:
                                </span>
                                <span className="ml-2 font-medium">
                                  {new Date(
                                    subscription.billing.trialEnd,
                                  ).toLocaleDateString()}
                                </span>
                              </div>
                            </>
                          )}
                      </div>

                      {subscription.billing.cancelAtPeriodEnd && (
                        <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                          <AlertCircle className="h-4 w-4 text-orange-600" />
                          <p className="text-sm text-orange-800">
                            Your subscription will end on{" "}
                            {new Date(
                              subscription.billing.currentPeriodEnd,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">
                        No active subscription found
                      </p>
                      <Link to="/pricing">
                        <Button className="mt-2">View Plans</Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Usage Overview */}
              {usage && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Usage This Month
                    </CardTitle>
                    <CardDescription>
                      Your current usage for the billing period ending{" "}
                      {new Date(usage.period.end).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Searches */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Searches</span>
                          <span>
                            {usage.searchesUsed} /{" "}
                            {usage.limits.monthlySearches === -1
                              ? "∞"
                              : usage.limits.monthlySearches}
                          </span>
                        </div>
                        <Progress
                          value={usage.percentUsed.searches}
                          className="h-2"
                        />
                      </div>

                      {/* Enrichments */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Enrichments</span>
                          <span>
                            {usage.leadsEnriched.toLocaleString()} /{" "}
                            {usage.limits.monthlyEnrichments === -1
                              ? "∞"
                              : usage.limits.monthlyEnrichments.toLocaleString()}
                          </span>
                        </div>
                        <Progress
                          value={usage.percentUsed.enrichments}
                          className="h-2"
                        />
                      </div>

                      {/* Exports */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Exports</span>
                          <span>
                            {usage.exportsCompleted} /{" "}
                            {usage.limits.monthlyExports === -1
                              ? "∞"
                              : usage.limits.monthlyExports}
                          </span>
                        </div>
                        <Progress
                          value={usage.percentUsed.exports}
                          className="h-2"
                        />
                      </div>

                      {/* Emails Generated */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Emails Generated</span>
                          <span>{usage.emailsGenerated}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {usage.limits.emailGeneration
                            ? "Unlimited"
                            : "Not available on your plan"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Actions Sidebar */}
            <div className="space-y-6">
              {/* Billing Portal */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Manage Billing
                  </CardTitle>
                  <CardDescription>
                    Update payment methods, view invoices, and download receipts
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={handlePortalAccess}
                    disabled={isLoadingPortal}
                    className="w-full"
                  >
                    {isLoadingPortal ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Opening Portal...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open Billing Portal
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Plan Changes */}
              <Card>
                <CardHeader>
                  <CardTitle>Change Plan</CardTitle>
                  <CardDescription>
                    Upgrade or downgrade your subscription
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Link to="/pricing">
                    <Button variant="outline" className="w-full">
                      View All Plans
                    </Button>
                  </Link>

                  {subscription?.hasActiveSubscription && (
                    <Button
                      onClick={handleCancelSubscription}
                      disabled={isCanceling}
                      variant={
                        subscription.billing?.cancelAtPeriodEnd
                          ? "default"
                          : "destructive"
                      }
                      className="w-full"
                    >
                      {isCanceling ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      {subscription.billing?.cancelAtPeriodEnd
                        ? "Reactivate Subscription"
                        : "Cancel Subscription"}
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Quick Stats */}
              {usage && (
                <Card>
                  <CardHeader>
                    <CardTitle>Quick Stats</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Plan
                      </span>
                      <span className="font-medium">{planName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Searches Used
                      </span>
                      <span className="font-medium">{usage.searchesUsed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Leads Enriched
                      </span>
                      <span className="font-medium">
                        {usage.leadsEnriched.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Period End
                      </span>
                      <span className="font-medium">
                        {new Date(usage.period.end).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Support */}
        <div className="mt-12 text-center">
          <p className="text-muted-foreground mb-2">
            Need help with your subscription or have questions about billing?
          </p>
          <Link to="/contact" className="text-primary hover:underline">
            Contact our support team
          </Link>
        </div>
      </div>
    </div>
  );
}
