import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle, ArrowLeft, Bot, CreditCard } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useRuntimeConfig,
  getPlanPrice,
  getAnnualSavings,
  formatPrice,
  type PlanType,
} from "@/lib/runtime-config";
import { useFastSpring } from "@/hooks/useFastSpring";

interface PlanConfig {
  id: PlanType;
  name: string;
  description: string;
  features: string[];
  limits: {
    monthlySearches: number;
    maxLeadsPerSearch: number;
    monthlyEnrichments: number;
    monthlyExports: number;
  };
}

const planConfigs: Record<string, PlanConfig> = {
  professional: {
    id: "professional",
    name: "Professional",
    description: "For growing businesses and sales teams",
    features: [
      "50 searches per month",
      "Up to 500 leads per search",
      "25,000 lead enrichments per month",
      "100 exports per month",
      "Managed API keys included",
      "Advanced AI analysis",
      "Email generation",
      "API access",
      "Priority support",
    ],
    limits: {
      monthlySearches: 50,
      maxLeadsPerSearch: 500,
      monthlyEnrichments: 25000,
      monthlyExports: 100,
    },
  },
  business: {
    id: "business",
    name: "Business",
    description: "For established teams scaling their outreach",
    features: [
      "200 searches per month",
      "Up to 2,000 leads per search",
      "100,000 lead enrichments per month",
      "500 exports per month",
      "Managed API keys included",
      "Advanced AI analysis",
      "Email generation & sequences",
      "Full API access",
      "Team collaboration",
      "Custom reporting",
      "CRM integrations",
    ],
    limits: {
      monthlySearches: 200,
      maxLeadsPerSearch: 2000,
      monthlyEnrichments: 100000,
      monthlyExports: 500,
    },
  },
};

export default function Subscribe() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const [isAnnual, setIsAnnual] = useState(false);
  const { config: runtimeConfig } = useRuntimeConfig();

  // FastSpring checkout hook
  const {
    startSubscriptionCheckout,
    isLoading,
    error: checkoutError,
  } = useFastSpring({
    autoLoad: true,
    onOrderComplete: () => {
      toast({
        title: "Subscription activated!",
        description: "Welcome to your new plan. Your account has been upgraded.",
      });
      navigate("/dashboard?upgraded=true");
    },
    onCheckoutClose: () => {
      // User closed the popup without completing
    },
  });

  // Redirect if not signed in
  useEffect(() => {
    if (!isSignedIn) {
      navigate(
        "/signin?redirect=" + encodeURIComponent(`/subscribe/${planId}`),
      );
    }
  }, [isSignedIn, navigate, planId]);

  const plan = planConfigs[planId || ""];

  // Redirect if plan not found
  useEffect(() => {
    if (!plan) {
      toast({
        title: "Plan not found",
        description: "The requested plan does not exist.",
        variant: "destructive",
      });
      navigate("/pricing");
    }
  }, [plan, navigate]);

  // Show error if checkout fails
  useEffect(() => {
    if (checkoutError) {
      toast({
        title: "Checkout Error",
        description: checkoutError,
        variant: "destructive",
      });
    }
  }, [checkoutError]);

  const handleSubscribe = async () => {
    if (!plan) return;

    const billingCycle = isAnnual ? "yearly" : "monthly";

    try {
      await startSubscriptionCheckout(plan.id, billingCycle);
    } catch (error) {
      console.error("Subscription checkout failed:", error);
      toast({
        title: "Checkout Error",
        description: "Failed to start checkout. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (!isSignedIn || !plan) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const planCatalog = runtimeConfig?.planCatalog || [];
  const currentPrice = getPlanPrice(planCatalog, plan.id, isAnnual);
  const savings = isAnnual ? getAnnualSavings(planCatalog, plan.id) : 0;

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
            <Link to="/pricing">
              <Button variant="ghost">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Pricing
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Subscribe to {plan.name}</h1>
          <p className="text-muted-foreground">{plan.description}</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Plan Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{plan.name} Plan</span>
                <Badge variant="secondary">Popular</Badge>
              </CardTitle>
              <CardDescription>
                Everything you need to scale your lead generation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Billing Toggle */}
              <div className="flex items-center justify-center gap-4 p-4 bg-muted/50 rounded-lg">
                <span
                  className={isAnnual ? "text-muted-foreground" : "font-medium"}
                >
                  Monthly
                </span>
                <Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
                <span
                  className={isAnnual ? "font-medium" : "text-muted-foreground"}
                >
                  Annual
                  {savings > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      Save {savings}%
                    </Badge>
                  )}
                </span>
              </div>

              {/* Pricing */}
              <div className="text-center">
                <div className="flex items-baseline justify-center">
                  <span className="text-4xl font-bold">
                    {formatPrice(currentPrice)}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    /{isAnnual ? "month" : "month"}
                  </span>
                </div>
                {isAnnual && savings > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    ${getPlanPrice(planCatalog, plan.id, true) * 12}/year • Save $
                    {getPlanPrice(planCatalog, plan.id, false) * 12 -
                      getPlanPrice(planCatalog, plan.id, true) * 12}
                    /year
                  </p>
                )}
              </div>

              {/* Features */}
              <div>
                <h4 className="font-semibold mb-3">What's included:</h4>
                <ul className="space-y-2">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Checkout */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Complete Your Subscription
              </CardTitle>
              <CardDescription>
                Subscribe for {formatPrice(currentPrice)}/
                {isAnnual ? "month" : "month"} - cancel anytime
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Immediate Access Info */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-medium text-blue-900 mb-1">
                  Immediate Access
                </h4>
                <p className="text-sm text-blue-700">
                  Get instant access to all {plan.name} features. Cancel anytime
                  with no long-term commitment.
                </p>
              </div>

              {/* Billing Summary */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>
                    {plan.name} Plan ({isAnnual ? "Annual" : "Monthly"})
                  </span>
                  <span>
                    {formatPrice(currentPrice)}/{isAnnual ? "month" : "month"}
                  </span>
                </div>
                {isAnnual && savings > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Annual Discount</span>
                    <span>
                      -$
                      {getPlanPrice(planCatalog, plan.id, false) -
                        getPlanPrice(planCatalog, plan.id, true)}
                      /month
                    </span>
                  </div>
                )}
                <div className="border-t pt-3 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>
                    {formatPrice(currentPrice)}/{isAnnual ? "month" : "month"}
                  </span>
                </div>
              </div>

              {/* Subscribe Button */}
              <Button
                onClick={handleSubscribe}
                disabled={isLoading}
                className="w-full"
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating checkout...
                  </>
                ) : (
                  <>Subscribe Now</>
                )}
              </Button>

              {/* Terms */}
              <p className="text-xs text-muted-foreground text-center">
                By subscribing, you agree to our{" "}
                <Link to="/terms" className="underline hover:text-primary">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="underline hover:text-primary">
                  Privacy Policy
                </Link>
                . No commitment required - cancel anytime.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Security & Support */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Secure checkout</span>
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Cancel anytime</span>
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>24/7 support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
