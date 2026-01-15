import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CreditCard,
  Plus,
  TrendingUp,
  Calendar,
  Zap,
  Crown,
  Star,
  CheckCircle,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBilling } from "@/hooks/useBilling";
import { useFastSpring } from "@/hooks/useFastSpring";
import { useRuntimeConfig, type PlanType } from "@/lib/runtime-config";
import { useUser, useUserCredits } from "@/hooks/useUser";
import { useAnalytics } from "@/hooks/useAnalytics";

interface PricingPlan {
  id: PlanType;
  name: string;
  description: string;
  price: number;
  credits: number;
  features: string[];
  popular?: boolean;
  currentPlan?: boolean;
}

interface UsageStats {
  currentPeriodUsage: number;
  totalCreditsUsed: number;
  searchesThisMonth: number;
  leadsGenerated: number;
  emailsGenerated: number;
  avgCostPerLead: number;
}

interface CreditManagerProps {
  // Optional props for backwards compatibility
  onUpgrade?: (planId: string) => void;
  onPurchaseCredits?: (amount: number) => void;
  currentCredits?: number;
  currentPlan?: PlanType;
  usageStats?: UsageStats;
}

export function CreditManager({
  onUpgrade,
  onPurchaseCredits,
  currentCredits: currentCreditsOverride,
  currentPlan: currentPlanOverride,
  usageStats: usageStatsOverride,
}: CreditManagerProps = {}) {
  const [selectedCreditPack, setSelectedCreditPack] = useState<number | null>(
    null,
  );
  const [isProcessing, setIsProcessing] = useState(false);

  const { toast } = useToast();
  const analytics = useAnalytics();

  // Real Convex hooks
  const { user } = useUser();
  const { credits, isLoading: creditsLoading } = useUserCredits();
  const { billing, usage } = useBilling();
  const { config: runtimeConfig } = useRuntimeConfig();

  // FastSpring checkout hook
  const {
    startSubscriptionCheckout,
    startCreditsCheckout,
    isLoading: checkoutLoading,
  } = useFastSpring({
    autoLoad: true,
    onOrderComplete: (order) => {
      // Track successful purchase
      analytics.trackCreditPurchaseCompleted({
        amount: order.items?.[0]?.quantity || 0,
        price: order.total || 0,
        payment_method: "fastspring",
        new_balance: (currentCredits || 0) + (order.items?.[0]?.quantity || 0),
      });

      toast({
        title: "Payment successful!",
        description: "Your purchase has been processed.",
      });
    },
  });

  const normalizePlan = (plan: string | undefined): PlanType => {
    const validPlans: PlanType[] = [
      "starter",
      "professional",
      "business",
      "enterprise",
      "custom",
    ];
    return validPlans.includes((plan as PlanType) || "")
      ? (plan as PlanType)
      : "starter";
  };

  const currentCredits =
    currentCreditsOverride ?? (typeof credits === "number" ? credits : credits || 0);
  const resolvedPlan = normalizePlan(currentPlanOverride ?? user?.plan);
  const currentPlan = resolvedPlan;
  const usageStats: UsageStats =
    usageStatsOverride ?? {
      currentPeriodUsage: usage?.currentPeriodUsage || 0,
      totalCreditsUsed: usage?.totalCreditsUsed || 0,
      searchesThisMonth: usage?.searchesThisMonth || 0,
      leadsGenerated: usage?.leadsGenerated || 0,
      emailsGenerated: usage?.emailsGenerated || 0,
      avgCostPerLead: usage?.avgCostPerLead || 0,
    };

  const showLoadingState = creditsLoading && currentCreditsOverride === undefined;

  const pricingPlans: PricingPlan[] = [
    {
      id: "starter",
      name: "Starter",
      description: "Perfect for trying out the platform",
      price: 0,
      credits: 100,
      features: [
        "100 credits/month",
        "Up to 50 leads per search",
        "Basic lead information",
        "Email support",
      ],
      currentPlan: currentPlan === "starter",
    },
    {
      id: "professional",
      name: "Professional",
      description: "Best for growing businesses",
      price: 49,
      credits: 1000,
      features: [
        "1,000 credits/month",
        "Up to 500 leads per search",
        "Email contact finding included",
        "AI email generation",
        "Priority support",
        "Export to CSV/CRM",
      ],
      popular: true,
      currentPlan: currentPlan === "professional",
    },
    {
      id: "business",
      name: "Business",
      description: "Scale outreach with collaborative tooling",
      price: 99,
      credits: 2500,
      features: [
        "2,500 credits/month",
        "Advanced audience filters",
        "Team workspaces",
        "Sequence analytics",
        "Role-based permissions",
        "Priority support",
      ],
      currentPlan: currentPlan === "business",
    },
    {
      id: "enterprise",
      name: "Enterprise",
      description: "For large-scale operations",
      price: 199,
      credits: 5000,
      features: [
        "5,000 credits/month",
        "Unlimited leads per search",
        "Advanced AI analysis",
        "Custom integrations",
        "Dedicated support",
        "White-label options",
      ],
      currentPlan: currentPlan === "enterprise",
    },
  ];

  const creditPacks = (runtimeConfig?.creditPacks || []).map((p) => ({
    amount: p.credits,
    price: Math.round(p.priceCents / 100),
    bonus: p.bonus || 0,
  }));
  // Fallback defaults if admin hasn't configured packs yet
  const fallbackCreditPacks = [
    { amount: 100, price: 15, bonus: 0 },
    { amount: 550, price: 65, bonus: 0 },
    { amount: 1150, price: 120, bonus: 0 },
    { amount: 3000, price: 280, bonus: 0 },
  ];
  const visiblePacks =
    creditPacks.length > 0 ? creditPacks : fallbackCreditPacks;

  const getCreditUsagePercentage = () => {
    const monthlyAllowance = getPlanCredits();
    return Math.min(
      (usageStats.currentPeriodUsage / monthlyAllowance) * 100,
      100,
    );
  };

  const getPlanCredits = () => {
    const plan = pricingPlans.find((p) => p.id === currentPlan);
    return plan?.credits || 100;
  };

  const getRemainingDays = () => {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const diff = endOfMonth.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const handleUpgrade = async (planId: PlanType) => {
    if (planId === currentPlan) return;

    // Starter is free (no purchase needed), Enterprise is contact sales only
    if (planId === "starter" || planId === "enterprise") {
      if (onUpgrade) {
        onUpgrade(planId);
      }
      return;
    }

    setIsProcessing(true);

    try {
      // Open FastSpring popup checkout for subscription
      await startSubscriptionCheckout(planId, "monthly");

      // Callback for parent component if provided
      if (onUpgrade) {
        onUpgrade(planId);
      }
    } catch (error) {
      console.error("Plan upgrade failed:", error);
      toast({
        title: "Upgrade Failed",
        description: "Failed to start upgrade process. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePurchaseCredits = async (amount: number) => {
    setIsProcessing(true);

    try {
      // Find the matching credit pack to get base credits (without bonus)
      const pack = visiblePacks.find((p) => p.amount + p.bonus === amount);
      if (!pack) throw new Error("Invalid credit pack");

      // Track purchase initiated
      analytics.trackCreditPurchaseInitiated({
        amount: pack.amount + pack.bonus,
        price: pack.price,
        payment_method: "fastspring",
      });

      // Open FastSpring popup checkout for credit purchase
      // Pass the base credit amount (FastSpring product is configured by base amount)
      await startCreditsCheckout(pack.amount);

      // Callback for parent component if provided
      if (onPurchaseCredits) {
        onPurchaseCredits(amount);
      }
    } catch (error) {
      console.error("Credit purchase failed:", error);

      // Track purchase failed
      analytics.trackCreditPurchaseFailed({
        amount,
        error_message: error instanceof Error ? error.message : "Unknown error",
      });

      toast({
        title: "Purchase Failed",
        description: "Failed to start purchase process. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const shouldShowLowCreditWarning = () => {
    return currentCredits < 50 || getCreditUsagePercentage() > 80;
  };

  // Show loading state
  if (showLoadingState) {
    return (
      <div className="space-y-6">
        <Alert>
          <Clock className="h-4 w-4 animate-spin" />
          <AlertDescription>Loading billing information...</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Credit Overview</h3>
          <Badge
            variant={currentPlan === "starter" ? "secondary" : "default"}
            className={`${
              currentPlan === "professional"
                ? "bg-blue-100 text-blue-800"
                : currentPlan === "business"
                  ? "bg-emerald-100 text-emerald-800"
                : currentPlan === "enterprise"
                  ? "bg-purple-100 text-purple-800"
                  : ""
            }`}
          >
            {currentPlan === "starter" && <Star className="h-3 w-3 mr-1" />}
            {currentPlan === "professional" && (
              <Crown className="h-3 w-3 mr-1" />
            )}
            {currentPlan === "business" && (
              <TrendingUp className="h-3 w-3 mr-1" />
            )}
            {currentPlan === "enterprise" && <Zap className="h-3 w-3 mr-1" />}
            {pricingPlans.find((p) => p.id === currentPlan)?.name || "Unknown"} Plan
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">Available Credits</span>
            </div>
            <div className="text-3xl font-bold text-primary" data-testid="credit-balance">
              {currentCredits}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium">Monthly Usage</span>
            </div>
            <div className="text-2xl font-bold">
              {usageStats.currentPeriodUsage}
            </div>
            <div className="text-sm text-muted-foreground">
              of {getPlanCredits()} credits
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium">Resets In</span>
            </div>
            <div className="text-2xl font-bold">{getRemainingDays()}</div>
            <div className="text-sm text-muted-foreground">days</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Monthly usage</span>
            <span>{getCreditUsagePercentage().toFixed(0)}%</span>
          </div>
          <Progress value={getCreditUsagePercentage()} className="h-2" />
        </div>

        {shouldShowLowCreditWarning() && (
          <Alert className="mt-4" variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {currentCredits < 50
                ? `Low credits: Only ${currentCredits} credits remaining.`
                : `High usage: You've used ${getCreditUsagePercentage().toFixed(0)}% of your monthly credits.`}{" "}
              Consider upgrading your plan or purchasing additional credits.
            </AlertDescription>
          </Alert>
        )}
      </Card>

      {/* Usage Statistics */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Usage Statistics</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {usageStats.searchesThisMonth}
            </div>
            <div className="text-sm text-muted-foreground">Searches</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {usageStats.leadsGenerated}
            </div>
            <div className="text-sm text-muted-foreground">Leads Found</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {usageStats.emailsGenerated}
            </div>
            <div className="text-sm text-muted-foreground">
              Emails Generated
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">
              ${usageStats.avgCostPerLead.toFixed(2)}
            </div>
            <div className="text-sm text-muted-foreground">Avg Cost/Lead</div>
          </div>
        </div>
      </Card>

      {/* Quick Credit Purchase */}
      {currentPlan !== "enterprise" && currentPlan !== "custom" && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            Purchase Additional Credits
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {visiblePacks.map((pack, index) => (
              <div
                key={index}
                data-testid="credit-package"
                data-credit-amount={`credit-amount-${pack.amount + pack.bonus}`}
                className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                  selectedCreditPack === index
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => setSelectedCreditPack(index)}
              >
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {pack.amount + pack.bonus}
                  </div>
                  <div className="text-sm text-muted-foreground mb-2">
                    credits
                    {pack.bonus > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        +{pack.bonus} bonus
                      </Badge>
                    )}
                  </div>
                  <div className="text-lg font-semibold">${pack.price}</div>
                  <div className="text-xs text-muted-foreground">
                    ${(pack.price / (pack.amount + pack.bonus)).toFixed(2)}
                    /credit
                  </div>
                </div>
              </div>
            ))}
          </div>

          {selectedCreditPack !== null && (
            <Button
              data-testid="buy-credits-button"
              className="w-full mt-4"
              disabled={isProcessing || checkoutLoading}
              onClick={() => {
                const pack = visiblePacks[selectedCreditPack];
                handlePurchaseCredits(pack.amount + pack.bonus);
              }}
            >
              {isProcessing || checkoutLoading ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Purchase{" "}
                  {visiblePacks[selectedCreditPack].amount +
                    visiblePacks[selectedCreditPack].bonus}{" "}
                  Credits for ${visiblePacks[selectedCreditPack].price}
                </>
              )}
            </Button>
          )}
        </Card>
      )}

      {/* Plan Upgrade */}
      {currentPlan !== "enterprise" && currentPlan !== "custom" && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Upgrade Your Plan</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pricingPlans.map((plan) => (
              <div
                key={plan.id}
                className={`border rounded-lg p-6 relative ${
                  plan.popular ? "border-primary shadow-lg" : "border-border"
                } ${plan.currentPlan ? "bg-muted/30" : ""}`}
              >
                {plan.popular && (
                  <Badge className="absolute -top-2 left-1/2 transform -translate-x-1/2 bg-primary">
                    Most Popular
                  </Badge>
                )}

                {plan.currentPlan && (
                  <Badge variant="secondary" className="absolute top-4 right-4">
                    Current Plan
                  </Badge>
                )}

                <div className="text-center mb-4">
                  <h4 className="text-xl font-bold">{plan.name}</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    {plan.description}
                  </p>
                  <div className="text-3xl font-bold">
                    ${plan.price}
                    {plan.price > 0 && (
                      <span className="text-sm font-normal">/month</span>
                    )}
                  </div>
                </div>

                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={
                    plan.currentPlan
                      ? "secondary"
                      : plan.popular
                        ? "default"
                        : "outline"
                  }
                  disabled={plan.currentPlan || isProcessing || checkoutLoading}
                  onClick={() => !plan.currentPlan && handleUpgrade(plan.id)}
                >
                  {isProcessing || checkoutLoading ? (
                    <>
                      <Clock className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : plan.currentPlan ? (
                    "Current Plan"
                  ) : (
                    `Upgrade to ${plan.name}`
                  )}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
