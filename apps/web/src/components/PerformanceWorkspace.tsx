import { useCallback, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CreditCard,
  LineChart,
  Mail,
  PiggyBank,
  Rocket,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import type { Search } from "@/lib/types";
import { SearchProgressTracker } from "@/components/SearchProgressTracker";
import { UsageWarnings } from "@/components/SubscriptionGuard";
import { SubscriptionStatusCard } from "@/components/SubscriptionStatusCard";
import { UsageMetersCard } from "@/components/UsageMetersCard";
import { CreditManager } from "@/components/CreditManager";
import { withErrorBoundary } from "@/utils/errorHandling";
import { createLogger } from "@/utils/logger";
import { DashboardHelpWidget } from "@/components/DashboardHelpWidget";
import {
  useStatusBroadcasts,
  getPriorityDisplay,
  formatBroadcastTime,
} from "@/hooks/useStatusBroadcasts";
import type {
  DashboardTabName,
  LeadStatsSummary,
  UsageSummary,
} from "@/components/DashboardOverview";
import type { PlanType } from "@/lib/pricing-config";

const performanceLogger = createLogger("PerformanceWorkspace");

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

interface PerformanceWorkspaceProps {
  userCredits: number;
  userPlan: PlanType;
  usageSummary: UsageSummary;
  leadStats?: LeadStatsSummary | null;
  searches?: Search[] | null;
  emailCount: number;
  onNavigate: (tab: DashboardTabName) => void;
  onUpgradePlan: (planId: string) => void;
  onPurchaseCredits: (amount: number) => void;
}

function PerformanceWorkspaceComponent({
  userCredits,
  userPlan,
  usageSummary,
  leadStats,
  searches,
  emailCount,
  onNavigate,
  onUpgradePlan,
  onPurchaseCredits,
}: PerformanceWorkspaceProps) {
  const [componentError, setComponentError] = useState<string | null>(null);
  const {
    urgentBroadcasts,
    rateLimitWarnings,
    acknowledgeBroadcast,
    markAsRead,
    hasUrgent,
    needsAcknowledgment,
  } = useStatusBroadcasts();

  const handleComponentError = useCallback(
    (error: unknown, context: string, extra?: Record<string, unknown>) => {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      performanceLogger.error(`Performance workspace error: ${context}`, extra, errorInstance);
      setComponentError(`${context}: ${errorInstance.message}`);
    },
    [],
  );

  const dismissComponentError = useCallback(() => {
    setComponentError(null);
  }, []);

  const highlightCards = useMemo(() => {
    const verifiedEmails = leadStats?.withEmails ?? 0;
    const totalLeads = leadStats?.totalLeads ?? 0;

    return [
      {
        title: "Leads generated",
        value: totalLeads.toLocaleString(),
        helper:
          leadStats?.thisWeek && leadStats.thisWeek > 0
            ? `+${leadStats.thisWeek} this week`
            : "Grow your pipeline by launching a new search",
        icon: Rocket,
      },
      {
        title: "Verified emails",
        value: verifiedEmails.toLocaleString(),
        helper:
          totalLeads > 0
            ? `${Math.round((verifiedEmails / Math.max(totalLeads, 1)) * 100)}% coverage`
            : "Enrich leads to unlock outreach",
        icon: Mail,
      },
      {
        title: "Credits remaining",
        value: userCredits.toLocaleString(),
        helper:
          usageSummary.currentPeriodUsage > 0
            ? `${usageSummary.currentPeriodUsage} used this cycle`
            : "You haven't spent any credits this month",
        icon: CreditCard,
      },
      {
        title: "Avg cost per lead",
        value:
          usageSummary.avgCostPerLead > 0
            ? currencyFormatter.format(usageSummary.avgCostPerLead)
            : "Optimizing",
        helper:
          usageSummary.totalCreditsUsed > 0
            ? `${usageSummary.totalCreditsUsed} credits lifetime`
            : "Drive costs down by refining filters",
        icon: LineChart,
      },
    ];
  }, [leadStats?.thisWeek, leadStats?.totalLeads, leadStats?.withEmails, usageSummary, userCredits]);

  const activeSearches = useMemo(() => {
    try {
      return (
        searches?.filter((search) => search.status === "in_progress") || []
      );
    } catch (error) {
      handleComponentError(error, "active-searches", {
        searchCount: searches?.length,
      });
      return [];
    }
  }, [handleComponentError, searches]);

  const completedSearches = useMemo(() => {
    try {
      return (
        searches
          ?.filter((search) => search.status === "completed")
          .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)) || []
      );
    } catch (error) {
      handleComponentError(error, "completed-searches", {
        searchCount: searches?.length,
      });
      return [];
    }
  }, [handleComponentError, searches]);

  const creditUsagePercentage = useMemo(() => {
    if (usageSummary.totalCreditsUsed === 0) {
      return 0;
    }
    const denominator = usageSummary.totalCreditsUsed + userCredits;
    if (denominator === 0) {
      return 0;
    }
    return Math.min(100, Math.round((usageSummary.totalCreditsUsed / denominator) * 100));
  }, [usageSummary.totalCreditsUsed, userCredits]);

  return (
    <div className="space-y-6" data-testid="performance-workspace">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          Unified performance & billing workspace
        </div>
        <h2 className="text-3xl font-bold tracking-tight">Stay ahead of your growth metrics</h2>
        <p className="max-w-2xl text-muted-foreground">
          Monitor lead generation trends, track usage, and manage credits in one place. This workspace gives you the
          context you need before making your next move.
        </p>
      </header>

      {componentError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{componentError}</span>
            <Button size="sm" variant="outline" onClick={dismissComponentError}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {hasUrgent && urgentBroadcasts.length > 0 && (
        <Alert className="border-orange-200 bg-orange-50/70">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="space-y-2 text-orange-700">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {urgentBroadcasts.length} urgent notification{urgentBroadcasts.length > 1 ? "s" : ""}
              {needsAcknowledgment > 0 && (
                <Badge variant="destructive">{needsAcknowledgment} require acknowledgment</Badge>
              )}
            </div>
            <div className="space-y-2">
              {urgentBroadcasts.slice(0, 2).map((broadcast) => {
                const priority = getPriorityDisplay(broadcast.priority);
                return (
                  <div key={broadcast._id} className="rounded-lg border border-orange-200 bg-white/60 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-orange-800">{broadcast.title}</span>
                      <Badge variant={priority.variant} className={priority.className}>
                        {priority.label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-orange-600">
                      {formatBroadcastTime(broadcast.createdAt)}
                    </p>
                    <p className="mt-2 text-sm text-orange-700">{broadcast.message}</p>
                    <div className="mt-3 flex items-center gap-2">
                      {broadcast.requiresAck && !broadcast.acknowledged && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void acknowledgeBroadcast(broadcast._id)}
                        >
                          Mark as resolved
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => void markAsRead(broadcast._id)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {rateLimitWarnings.length > 0 && (
        <Alert className="border-yellow-200 bg-yellow-50/70">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="space-y-1 text-yellow-800">
            <p className="text-sm font-semibold">We noticed some rate limits recently.</p>
            {rateLimitWarnings.slice(0, 2).map((warning) => (
              <p key={warning._id} className="text-xs">
                {warning.title} · {warning.message} · {formatBroadcastTime(warning.createdAt)}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {highlightCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="h-full border-border/70">
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">{card.title}</CardTitle>
                  <CardDescription>{card.helper}</CardDescription>
                </div>
                <span className="rounded-full bg-primary/10 p-2 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <TrendingUp className="h-5 w-5" />
                Performance metrics
              </CardTitle>
              <CardDescription>Key trends from your recent lead generation activity.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs text-muted-foreground">Searches this month</p>
                  <p className="mt-1 text-2xl font-semibold">{usageSummary.searchesThisMonth}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {usageSummary.searchesThisMonth > 0
                      ? "Keep the momentum going"
                      : "Run a search to populate your funnel"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs text-muted-foreground">Emails generated</p>
                  <p className="mt-1 text-2xl font-semibold">{emailCount.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use AI outreach to convert leads faster.
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs text-muted-foreground">Total credits used</p>
                  <p className="mt-1 text-2xl font-semibold">{usageSummary.totalCreditsUsed.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Includes searches, enrichments, and exports to date.
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 p-4">
                  <p className="text-xs text-muted-foreground">Plan tier</p>
                  <p className="mt-1 text-2xl font-semibold capitalize">{userPlan}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upgrade to unlock higher limits when you’re ready.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {activeSearches.length > 0 ? (
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Activity className="h-5 w-5" />
                  Active searches
                </CardTitle>
                <CardDescription>Track progress and know which stage each search is in.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeSearches.slice(0, 3).map((search) => (
                  <SearchProgressTracker key={search._id} searchId={search._id} compact showHistory={false} />
                ))}
                {activeSearches.length > 3 && (
                  <p className="text-center text-xs text-muted-foreground">
                    +{activeSearches.length - 3} more searches in progress
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border-border/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Sparkles className="h-5 w-5" />
                  Launch your next search
                </CardTitle>
                <CardDescription>
                  Start a new search to discover prospects tailored to your ideal customer profile.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => onNavigate("pipeline")}>
                  Configure search options
                </Button>
              </CardContent>
            </Card>
          )}

          {completedSearches.length > 0 && (
            <Card className="border-border/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Bot className="h-5 w-5" />
                  Recently completed
                </CardTitle>
                <CardDescription>Your most recent completed searches and outcomes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {completedSearches.slice(0, 4).map((search) => (
                  <div key={search._id} className="rounded-lg border border-border/60 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">
                        {search.name || search.parameters?.keywords?.join(", ") || "Untitled search"}
                      </span>
                      <Badge variant="outline">{search.results?.totalFound ?? 0} leads</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Completed {search.completedAt ? format(search.completedAt, "MMM d, yyyy h:mma") : "recently"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Credits used: {search.creditsUsed ?? "—"}
                    </p>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => onNavigate("search-history")}
                >
                  View full search history
                </Button>
              </CardContent>
            </Card>
          )}

          <UsageWarnings />
        </div>

        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <PiggyBank className="h-5 w-5" />
                Credit health
              </CardTitle>
              <CardDescription>Monitor usage and forecast when you'll need more credits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Credits remaining</span>
                  <span className="font-semibold">{userCredits.toLocaleString()}</span>
                </div>
                <Progress value={100 - creditUsagePercentage} className="mt-2 h-2" />
                <p className="mt-2 text-xs text-muted-foreground">
                  You've used {creditUsagePercentage}% of the credits you've purchased to date.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
                <p>
                  Keep an eye on credit usage across searches and enrichment. Upgrade or top up credits when you're close
                  to heavy campaign periods.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Target className="h-5 w-5" />
                Account status
              </CardTitle>
              <CardDescription>Your current plan and usage at a glance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SubscriptionStatusCard />
              <UsageMetersCard />
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5" />
                Need strategic help?
              </CardTitle>
              <CardDescription>Explore tips, templates, and concierge support.</CardDescription>
            </CardHeader>
            <CardContent>
              <DashboardHelpWidget />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <CreditManager
              currentCredits={userCredits}
              currentPlan={userPlan}
              usageStats={usageSummary}
              onUpgrade={onUpgradePlan}
              onPurchaseCredits={onPurchaseCredits}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

PerformanceWorkspaceComponent.displayName = "PerformanceWorkspace";

export const PerformanceWorkspace = withErrorBoundary(
  PerformanceWorkspaceComponent,
  "Performance workspace failed to render",
);
