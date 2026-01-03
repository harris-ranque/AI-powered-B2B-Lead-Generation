import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle,
  Mail,
  PlayCircle,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Search } from "@/lib/types";
import type { PipelineStage } from "@/pipeline/types";
import { PlanStatusCard } from "@/components/PlanStatusCard";
import { DashboardHelpWidget } from "@/components/DashboardHelpWidget";
import { cn } from "@/lib/utils";

export type DashboardTabName =
  | "overview"
  | "pipeline"
  | "search-history"
  | "profile"
  | "performance"
  | "credits"
  | "dashboard"
  | "settings"
  | "admin";

export interface LeadStatsSummary {
  totalLeads?: number;
  withEmails?: number;
  thisWeek?: number;
}

export interface UsageSummary {
  currentPeriodUsage: number;
  totalCreditsUsed: number;
  searchesThisMonth: number;
  leadsGenerated: number;
  emailsGenerated: number;
  avgCostPerLead: number;
}

interface DashboardOverviewProps {
  onNavigate: (tab: DashboardTabName) => void;
  userName?: string;
  businessName?: string | null;
  planId: string;
  credits: number;
  leadStats?: LeadStatsSummary | null;
  emailCount: number;
  searches?: Search[] | null;
  usageSummary: UsageSummary;
  pipelineStage?: PipelineStage;
  hasCompletedProfile: boolean;
  hasNewEmails: boolean;
  isAdmin?: boolean;
}

const pipelineStageCopy: Record<PipelineStage, { title: string; helper: string }> = {
  source_selection: {
    title: "Choose your data source",
    helper: "Pick a lead source to kick off a new search.",
  },
  lead_discovery: {
    title: "Discovering fresh leads",
    helper: "We’re gathering prospects that match your filters.",
  },
  enrichment: {
    title: "Finding contact details",
    helper: "Discovering contact information for your leads.",
  },
  ai_analysis: {
    title: "Analyzing ideal matches",
    helper: "AI is prioritizing the leads that fit best.",
  },
  email_generation: {
    title: "Drafting personalized outreach",
    helper: "AI emails are being composed for each high intent lead.",
  },
  review_export: {
    title: "Ready for review",
    helper: "Preview emails and export leads when you’re satisfied.",
  },
};

function formatPlan(planId: string): { label: string; badgeVariant: "default" | "secondary" } {
  switch (planId) {
    case "professional":
      return { label: "Professional", badgeVariant: "default" };
    case "business":
      return { label: "Business", badgeVariant: "default" };
    case "enterprise":
      return { label: "Enterprise", badgeVariant: "default" };
    case "starter":
    case "free":
    default:
      return { label: "Starter", badgeVariant: "secondary" };
  }
}

export function DashboardOverview({
  onNavigate,
  userName,
  businessName,
  planId,
  credits,
  leadStats,
  emailCount,
  searches,
  usageSummary,
  pipelineStage,
  hasCompletedProfile,
  hasNewEmails,
  isAdmin,
}: DashboardOverviewProps) {
  const recentSearches = useMemo(() => {
    if (!searches || searches.length === 0) {
      return [];
    }

    return [...searches]
      .sort((a, b) => (b._creationTime || 0) - (a._creationTime || 0))
      .slice(0, 4)
      .map((search) => ({
        id: search._id,
        name:
          search.name ||
          search.parameters?.keywords?.[0] ||
          search.parameters?.location ||
          "Untitled search",
        status: search.status,
        totalFound: search.results?.totalFound ?? 0,
        createdAt: search._creationTime,
      }));
  }, [searches]);

  const activeSearchCount = useMemo(() => {
    return (searches ?? []).filter((search) => search.status === "in_progress").length;
  }, [searches]);

  const planMeta = formatPlan(planId);
  const greetingName = userName || businessName || "there";

  const totalLeads = leadStats?.totalLeads ?? 0;
  const targetedEmailsCount = totalLeads * 3;

  const stats = [
    {
      label: "Total leads",
      value: totalLeads.toLocaleString(),
      sublabel:
        leadStats?.thisWeek && leadStats.thisWeek > 0
          ? `+${leadStats.thisWeek} this week`
          : "No new leads this week",
      icon: Sparkles,
    },
    {
      label: "Highly targeted emails created",
      value: targetedEmailsCount > 0 ? targetedEmailsCount.toLocaleString() : "0",
      sublabel: targetedEmailsCount > 0 ? `${targetedEmailsCount} personalized email${targetedEmailsCount !== 1 ? 's' : ''} ready` : "No emails generated yet",
      icon: Mail,
    },
  ];

  const pipelineCopy = pipelineStage ? pipelineStageCopy[pipelineStage] : null;

  return (
    <div className="space-y-8" data-testid="dashboard-overview">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="text-3xl font-bold tracking-tight">
            {`Hi ${greetingName}, let's grow your pipeline`}
          </h1>
          <p className="mt-2 text-muted-foreground max-w-2xl">
            Your personal dashboard gives you a quick snapshot across leads, usage, billing, and AI outreach. Pick a
            workspace to dive deeper or jump straight into the pipeline.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start lg:self-auto">
          <Badge
            variant={planMeta.badgeVariant}
            className="text-sm px-4 py-1.5 font-semibold bg-gradient-to-r from-primary/90 to-primary shadow-md border-primary/20"
          >
            {planMeta.label} Plan
          </Badge>
          <Button onClick={() => onNavigate("pipeline")} className="inline-flex items-center gap-2">
            <PlayCircle className="h-4 w-4" />
            Launch Lead Pipeline
          </Button>
        </div>
      </header>

      <section>
        <div className="grid gap-4 sm:grid-cols-2">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="h-full border-border/70 bg-gradient-to-br from-card via-card to-card/80">
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">{stat.label}</CardTitle>
                    <span className="rounded-full bg-primary/10 p-2 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.sublabel}</p>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5" />
              Quick workspaces
            </CardTitle>
            <CardDescription>Choose where you want to go next.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              {[
                {
                  title: "Lead pipeline",
                  description: "Set your criteria, find contacts, and export in minutes.",
                  icon: PlayCircle,
                  tab: "pipeline" as DashboardTabName,
                },
                {
                  title: "Performance workspace",
                  description: "Analytics and billing insights together in one view.",
                  icon: BarChart3,
                  tab: "performance" as DashboardTabName,
                },
                {
                  title: "Recent searches",
                  description: "Review previous runs, restart, or export again.",
                  icon: Search,
                  tab: "search-history" as DashboardTabName,
                },
                {
                  title: "Business profile",
                  description: hasCompletedProfile
                    ? "Keep your positioning sharp for better personalization."
                    : "Complete your profile so AI outreach matches your voice.",
                  icon: Building2,
                  tab: "profile" as DashboardTabName,
                },
              ].map((action) => {
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.title}
                    onClick={() => onNavigate(action.tab)}
                    className={cn(
                      "group flex flex-col rounded-xl border border-border/70 bg-card p-4 text-left transition hover:border-primary hover:shadow-lg",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-primary/10 p-2 text-primary">
                          <ActionIcon className="h-5 w-5" />
                        </span>
                        <span className="text-sm font-semibold">{action.title}</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{action.description}</p>
                  </button>
                );
              })}
            </div>
            {isAdmin && (
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => onNavigate("admin")}
              >
                Open admin workspace
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Search className="h-5 w-5" />
              Recent activity
            </CardTitle>
            <CardDescription>A snapshot of your latest searches and outcomes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentSearches.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="no-results-message">
                No searches yet. Launch the pipeline to discover your next opportunities.
              </div>
            ) : (
              recentSearches.map((search) => (
                <div key={search.id} className="rounded-lg border border-border/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{search.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(search.createdAt, { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {search.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      <TrendingUp className="mr-2 inline h-4 w-4 text-primary" />
                      {search.totalFound.toLocaleString()} leads found
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={() => onNavigate("search-history")}
                    >
                      View details
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Target className="h-5 w-5" />
              Pipeline progress
            </CardTitle>
            <CardDescription>
              {pipelineCopy
                ? pipelineCopy.helper
                : "Move through each stage to take a lead from discovery to outreach."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="text-sm font-semibold text-muted-foreground">Current stage</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {pipelineCopy ? pipelineCopy.title : "Ready to start"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {pipelineCopy
                  ? pipelineCopy.helper
                  : "Set up a search to begin discovering new leads tailored to your business."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">Leads with verified contact info</p>
                <p className="text-2xl font-semibold">
                  {(leadStats?.withEmails ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-xs text-muted-foreground">Average cost per lead</p>
                <p className="text-2xl font-semibold" data-testid="estimated-cost">
                  {usageSummary.avgCostPerLead > 0
                    ? `$${usageSummary.avgCostPerLead.toFixed(2)}`
                    : "Optimizing"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => onNavigate("performance")}
            >
              Explore full analytics
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <PlanStatusCard />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <CheckCircle className="h-5 w-5" />
              Next best actions
            </CardTitle>
            <CardDescription>Guided suggestions to keep momentum.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-lg border border-border/60 p-4">
              <p className="text-sm font-semibold text-foreground">Launch the pipeline</p>
              <p className="text-sm text-muted-foreground">
                Set your filters or duplicate a previous search to discover fresh leads in seconds.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onNavigate("pipeline")}
              >
                Start a new search
              </Button>
            </div>
            <div className="rounded-lg border border-border/60 p-4">
              <p className="text-sm font-semibold text-foreground">Review AI emails</p>
              <p className="text-sm text-muted-foreground">
                {hasNewEmails
                  ? "Personalized outreach is ready to send. Review and export when you're ready."
                  : "Generate tailored outreach directly from the pipeline to accelerate follow-up."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => onNavigate("search-history")}
              >
                View history & exports
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5" />
              Need a hand?
            </CardTitle>
            <CardDescription>Explore tips, tutorials, and concierge support.</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <DashboardHelpWidget />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
