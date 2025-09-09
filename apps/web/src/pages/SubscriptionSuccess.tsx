import { useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Bot, ArrowRight, Mail, Calendar, CreditCard } from "lucide-react";
import { convex } from "@/lib/convex";
import { useMutation, useQuery } from "@tanstack/react-query";

export default function SubscriptionSuccess() {
  const [searchParams] = useSearchParams();
  const { isSignedIn, user } = useAuth();
  const navigate = useNavigate();
  const sessionId = searchParams.get('session_id');

  // Redirect if not signed in
  useEffect(() => {
    if (!isSignedIn) {
      navigate('/signin');
    }
  }, [isSignedIn, navigate]);

  // Get subscription status
  const { data: subscription, isLoading } = useQuery({
    queryKey: ['subscription-status'],
    queryFn: async () => {
      const result = await convex.mutation("billing/mutations:getSubscriptionStatus", {});
      return result;
    },
    enabled: !!isSignedIn,
    refetchInterval: 5000, // Poll for updates
    refetchIntervalInBackground: false,
  });

  if (!isSignedIn) {
    return null;
  }

  const planDisplayNames = {
    starter: "Starter",
    professional: "Professional", 
    business: "Business",
    enterprise: "Enterprise"
  };

  const planName = subscription?.plan ? planDisplayNames[subscription.plan as keyof typeof planDisplayNames] : "Premium";

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
              <Button variant="ghost">Dashboard</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Success Content */}
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome to {planName}! 🎉</h1>
          <p className="text-muted-foreground">
            Your subscription is now active and you're ready to supercharge your lead generation.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 mb-12">
          {/* Subscription Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Subscription Details
              </CardTitle>
              <CardDescription>
                Your subscription is active and ready to use
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {subscription && subscription.billing ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Plan</span>
                    <span className="font-medium">{planName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <span className="font-medium text-green-600">
                      {subscription.isTrialing ? "Free Trial" : "Active"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Billing Cycle</span>
                    <span className="font-medium capitalize">{subscription.billing.billingCycle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Next Payment</span>
                    <span className="font-medium">
                      {new Date(subscription.billing.currentPeriodEnd).toLocaleDateString()}
                    </span>
                  </div>
                  {subscription.isTrialing && subscription.billing.trialEnd && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Trial Ends</span>
                      <span className="font-medium">
                        {new Date(subscription.billing.trialEnd).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-muted-foreground">Loading subscription details...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Next Steps */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Next Steps
              </CardTitle>
              <CardDescription>
                Get the most out of your subscription
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Start Your First Search</p>
                    <p className="text-sm text-muted-foreground">
                      Head to your dashboard and create your first lead search
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Set Up Your Business Profile</p>
                    <p className="text-sm text-muted-foreground">
                      Complete your profile for better AI-generated emails
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Explore Email Generation</p>
                    <p className="text-sm text-muted-foreground">
                      Generate personalized emails for your leads
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plan Features Highlight */}
        {subscription?.billing?.planLimits && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your {planName} Plan Includes</CardTitle>
              <CardDescription>
                Here's what you can do with your subscription
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">
                    {subscription.billing.planLimits.monthlySearches === -1 ? "∞" : subscription.billing.planLimits.monthlySearches}
                  </div>
                  <p className="text-sm text-muted-foreground">Searches/month</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">
                    {subscription.billing.planLimits.maxLeadsPerSearch === -1 ? "∞" : subscription.billing.planLimits.maxLeadsPerSearch}
                  </div>
                  <p className="text-sm text-muted-foreground">Leads/search</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">
                    {subscription.billing.planLimits.monthlyEnrichments === -1 ? "∞" : (subscription.billing.planLimits.monthlyEnrichments / 1000).toFixed(0) + "K"}
                  </div>
                  <p className="text-sm text-muted-foreground">Enrichments/month</p>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">
                    {subscription.billing.planLimits.monthlyExports === -1 ? "∞" : subscription.billing.planLimits.monthlyExports}
                  </div>
                  <p className="text-sm text-muted-foreground">Exports/month</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Call to Action */}
        <div className="text-center">
          <div className="inline-flex flex-col sm:flex-row gap-4">
            <Link to="/app">
              <Button size="lg">
                Go to Dashboard
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
            <Link to="/billing">
              <Button size="lg" variant="outline">
                <Mail className="h-4 w-4 mr-2" />
                Manage Subscription
              </Button>
            </Link>
          </div>
        </div>

        {/* Contact Support */}
        <div className="mt-12 text-center">
          <p className="text-muted-foreground mb-2">
            Questions about your subscription or need help getting started?
          </p>
          <Link to="/contact" className="text-primary hover:underline">
            Contact our support team
          </Link>
        </div>
      </div>
    </div>
  );
}