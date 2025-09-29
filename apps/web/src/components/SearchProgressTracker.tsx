import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
  Mail,
  Bot,
  Loader2,
  X,
  Eye,
  Zap,
  Microscope,
  FileText,
  TrendingUp,
  Brain,
} from "lucide-react";
import {
  useSearchBroadcasts,
  getPriorityDisplay,
  formatBroadcastTime,
} from "@/hooks/useStatusBroadcasts";
import { useSearch } from "@/hooks/useSearches";
import { useSearches } from "@/hooks/useSearches";
import type { Id } from "@genni/convex-types/dataModel";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface SearchProgressTrackerProps {
  searchId: Id<"searches">;
  compact?: boolean;
  showHistory?: boolean;
  className?: string;
}

/**
 * Real-time search progress tracker with live status broadcasting
 * Displays pipeline progress, status updates, and user notifications
 */
export function SearchProgressTracker({
  searchId,
  compact = false,
  showHistory = true,
  className,
}: SearchProgressTrackerProps) {
  const { search } = useSearch(searchId);
  const { cancelSearch } = useSearches();
  const {
    broadcasts,
    latestStatus,
    progressUpdates,
    acknowledgeBroadcast,
    hasUpdates,
  } = useSearchBroadcasts(searchId);

  const [showAllBroadcasts, setShowAllBroadcasts] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  if (!search) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Loading search...
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall progress
  const totalSteps = 4; // Discovery, Enrichment, Analysis, Completion
  let currentStep = 0;
  let progressPercent = 0;

  if (
    search.status === "in_progress" ||
    search.status === "processing" ||
    search.status === "completed"
  ) {
    currentStep = 1; // Discovery started
    if (search.progress?.enriched > 0) currentStep = 2; // Enrichment started
    if (search.progress?.analyzed > 0) currentStep = 3; // Analysis started
    if (search.status === "completed") currentStep = 4; // Completed

    progressPercent = (currentStep / totalSteps) * 100;
  }

  // Get status icon and color
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "pending":
        return { icon: Clock, color: "text-yellow-500", bg: "bg-yellow-50" };
      case "in_progress":
        return { icon: Loader2, color: "text-blue-500", bg: "bg-blue-50" };
      case "processing":
        return { icon: Loader2, color: "text-blue-500", bg: "bg-blue-50" };
      case "completed":
        return {
          icon: CheckCircle,
          color: "text-green-500",
          bg: "bg-green-50",
        };
      case "failed":
        return { icon: AlertCircle, color: "text-red-500", bg: "bg-red-50" };
      case "cancelled":
        return { icon: X, color: "text-gray-500", bg: "bg-gray-50" };
      default:
        return { icon: Clock, color: "text-gray-500", bg: "bg-gray-50" };
    }
  };

  const statusDisplay = getStatusDisplay(search.status);
  const StatusIcon = statusDisplay.icon;

  // Get research tier display
  const getResearchTierDisplay = (tier?: string, confidence?: number) => {
    switch (tier) {
      case "tavily":
        return {
          icon: Zap,
          label: "Standard",
          color: "text-blue-500",
          bg: "bg-blue-50",
          description: "Fast business context research (2-3s)",
          variant: "secondary" as const,
        };
      case "exa":
        return {
          icon: Microscope,
          label: "Enhanced",
          color: "text-purple-500",
          bg: "bg-purple-50",
          description: "Deep competitor & industry analysis (3-4s)",
          variant: "outline" as const,
        };
      case "perplexity":
        return {
          icon: FileText,
          label: "Premium",
          color: "text-amber-600",
          bg: "bg-amber-50",
          description: "Comprehensive research report (10-15s)",
          variant: "default" as const,
        };
      case "error":
        return {
          icon: AlertCircle,
          label: "Error",
          color: "text-red-500",
          bg: "bg-red-50",
          description: "Research failed",
          variant: "destructive" as const,
        };
      default:
        return {
          icon: Brain,
          label: "Research",
          color: "text-gray-500",
          bg: "bg-gray-50",
          description: "Business context research",
          variant: "secondary" as const,
        };
    }
  };

  const researchTierDisplay = getResearchTierDisplay(
    search.researchTier,
    search.researchConfidence,
  );
  const ResearchTierIcon = researchTierDisplay.icon;

  const discoveredCount = search.progress?.discovered ?? 0;
  const enrichedCount = search.progress?.enriched ?? 0;
  const analyzedCount = search.progress?.analyzed ?? 0;
  const totalCount =
    search.progress?.total ??
    search.results?.totalFound ??
    Math.max(discoveredCount, enrichedCount, analyzedCount);

  const discoveryStarted =
    search.status !== "pending" || discoveredCount > 0 || currentStep > 0;
  const discoveryCompleted =
    (search.progress?.total &&
      search.progress.total > 0 &&
      discoveredCount >= search.progress.total) ||
    search.researchStage === "research_started" ||
    search.researchStage === "research_completed" ||
    currentStep > 1;

  const researchStageStatus = search.researchStage;
  const researchStarted =
    researchStageStatus === "research_started" ||
    researchStageStatus === "research_completed";
  const researchCompleted = researchStageStatus === "research_completed";

  const enrichmentStarted =
    enrichedCount > 0 ||
    researchCompleted ||
    currentStep >= 2 ||
    search.status === "processing" ||
    search.status === "completed";
  const enrichmentCompleted =
    (totalCount > 0 && enrichedCount >= totalCount) ||
    analyzedCount > 0 ||
    currentStep >= 3 ||
    search.status === "completed";

  const analysisStarted =
    analyzedCount > 0 ||
    currentStep >= 3 ||
    search.status === "processing" ||
    search.status === "completed";
  const analysisCompleted =
    (totalCount > 0 && analyzedCount >= totalCount) ||
    currentStep >= 4 ||
    search.status === "completed";

  const completionStarted =
    search.status === "processing" || search.status === "completed";
  const completionCompleted = search.status === "completed";

  const stageBlueprint = [
    {
      name: "Discovery",
      icon: Search,
      description: "Finding leads via Google Maps",
      count: discoveredCount,
      started: discoveryStarted,
      completed: discoveryCompleted,
    },
    {
      name: "Research",
      icon: ResearchTierIcon,
      description: researchTierDisplay.description,
      count: search.researchSourcesAnalyzed || 0,
      tier: search.researchTier,
      confidence: search.researchConfidence,
      escalation: search.researchEscalationReason,
      started: researchStarted || discoveryCompleted,
      completed: researchCompleted,
    },
    {
      name: "Enrichment",
      icon: Mail,
      description: "Enriching with contact information",
      count: enrichedCount,
      started: enrichmentStarted,
      completed: enrichmentCompleted,
    },
    {
      name: "Analysis",
      icon: Bot,
      description: "AI analysis and email generation",
      count: analyzedCount,
      started: analysisStarted,
      completed: analysisCompleted,
    },
    {
      name: "Completion",
      icon: CheckCircle,
      description: "Finalizing results and notifications",
      count: search.results?.totalFound || totalCount,
      started: completionStarted,
      completed: completionCompleted,
    },
  ];

  let activeStageAssigned = false;
  const pipelineStages = stageBlueprint.map((stage, index) => {
    let status: "pending" | "in_progress" | "completed" = "pending";

    if (stage.completed) {
      status = "completed";
    } else if (!activeStageAssigned) {
      activeStageAssigned = true;
      status =
        stage.started || index === 0 || search.status === "pending"
          ? "in_progress"
          : "pending";
    }

    return { ...stage, status };
  });

  if (compact) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-full", statusDisplay.bg)}>
              <StatusIcon
                className={cn(
                  "h-4 w-4",
                  statusDisplay.color,
                  search.status === "in_progress" && "animate-spin",
                )}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{search.name}</h3>
                <Badge variant="outline" className="text-xs">
                  {search.status.replace("_", " ")}
                </Badge>
              </div>
              {search.status === "in_progress" && (
                <Progress value={progressPercent} className="mt-2 h-2" />
              )}
            </div>
            {search.researchTier && (
              <Badge variant={researchTierDisplay.variant} className="text-xs">
                <ResearchTierIcon className="w-3 h-3 mr-1" />
                {researchTierDisplay.label}
              </Badge>
            )}
            {latestStatus && (
              <Badge
                variant={getPriorityDisplay(latestStatus.priority).variant}
                className="text-xs"
              >
                {formatBroadcastTime(latestStatus.createdAt)}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <div className={cn("p-2 rounded-full", statusDisplay.bg)}>
              <StatusIcon
                className={cn(
                  "h-5 w-5",
                  statusDisplay.color,
                  search.status === "in_progress" && "animate-spin",
                )}
              />
            </div>
            Search Progress: {search.name}
            {search.researchTier && (
              <Badge variant={researchTierDisplay.variant} className="ml-2">
                <ResearchTierIcon className="w-3 h-3 mr-1" />
                {researchTierDisplay.label} Research
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                search.status === "completed"
                  ? "default"
                  : search.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
            >
              {search.status.replace("_", " ").toUpperCase()}
            </Badge>
            {(search.status === "pending" ||
              search.status === "in_progress" ||
              search.status === "processing") && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isCancelling}>
                    <X className="h-4 w-4 mr-1" />
                    {isCancelling ? "Cancelling..." : "Cancel"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this search?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You can stop the search at any time. Discovery may spend 1
                      credit if already started. No additional credits are
                      charged after cancellation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Running</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        try {
                          setIsCancelling(true);
                          await cancelSearch({ searchId });
                        } finally {
                          setIsCancelling(false);
                          setConfirmOpen(false);
                        }
                      }}
                    >
                      Confirm Cancel
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-8 p-6">
        {(search.status === "in_progress" || search.status === "processing") && (
          <div className="rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Overall Progress</p>
                <p className="text-xs text-muted-foreground">
                  Tracking the live status of your pipeline.
                </p>
              </div>
              <Badge variant="outline" className="text-xs">
                {Math.round(progressPercent)}% complete
              </Badge>
            </div>
            <Progress value={progressPercent} className="mt-3 h-2.5" />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-6">
            <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Pipeline Stages
                </h4>
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  {pipelineStages.filter((stage) => stage.status === "completed").length}
                  /{pipelineStages.length} complete
                </Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {pipelineStages.map((stage) => {
                  const StageIcon = stage.icon;
                  const stageDisplay = getStatusDisplay(stage.status);
                  const StageStatusIcon = stageDisplay.icon;

                  return (
                    <div
                      key={stage.name}
                      className={cn(
                        "flex h-full flex-col justify-between rounded-lg border bg-background p-4 shadow-sm transition-all duration-200",
                        stage.status === "completed" &&
                          "border-emerald-200 bg-emerald-50/80",
                        stage.status === "in_progress" &&
                          "border-primary/40 bg-primary/5 ring-1 ring-primary/20",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <StageIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold">{stage.name}</span>
                        </div>
                        <StageStatusIcon
                          className={cn(
                            "h-4 w-4",
                            stageDisplay.color,
                            stage.status === "in_progress" && stageDisplay.icon === Loader2 && "animate-spin",
                          )}
                        />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {stage.description}
                      </p>
                      <div className="mt-4 space-y-2 text-xs font-medium text-muted-foreground">
                        {stage.count > 0 && (
                          <div className="flex items-center justify-between">
                            <span>{stage.name === "Research" ? "Sources" : "Leads"}</span>
                            <span className="text-foreground">{stage.count}</span>
                          </div>
                        )}
                        {stage.confidence && (
                          <div className="flex items-center justify-between">
                            <span>Confidence</span>
                            <span className="text-foreground">
                              {Math.round(stage.confidence * 100)}%
                            </span>
                          </div>
                        )}
                        {stage.tier && (
                          <Badge variant="outline" className="w-fit text-[10px] uppercase tracking-wide">
                            {stage.tier}
                          </Badge>
                        )}
                        {stage.escalation && (
                          <span className="block text-amber-600">
                            Escalated: {stage.escalation}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest Update
                </h4>
                {latestStatus && (
                  <Badge
                    variant={getPriorityDisplay(latestStatus.priority).variant}
                    className="text-xs"
                  >
                    {formatBroadcastTime(latestStatus.createdAt)}
                  </Badge>
                )}
              </div>
              {latestStatus ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    {latestStatus.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {latestStatus.message}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No updates yet. Progress notifications will appear here.
                </p>
              )}
            </div>

            {showHistory && hasUpdates && (
              <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Status Updates
                  </h4>
                  {broadcasts.length > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllBroadcasts(!showAllBroadcasts)}
                    >
                      <Eye className="mr-1 h-4 w-4" />
                      {showAllBroadcasts
                        ? "Show less"
                        : `Show all (${broadcasts.length})`}
                    </Button>
                  )}
                </div>

                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {(showAllBroadcasts ? broadcasts : broadcasts.slice(0, 3)).map(
                    (broadcast) => {
                      const priorityDisplay = getPriorityDisplay(
                        broadcast.priority,
                      );

                      return (
                        <div
                          key={broadcast._id}
                          className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/80 p-3 shadow-sm"
                        >
                          <span className="text-sm">{priorityDisplay.icon}</span>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={priorityDisplay.variant}
                                className="text-xs"
                              >
                                {priorityDisplay.label}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatBroadcastTime(broadcast.createdAt)}
                              </span>
                            </div>
                            <div>
                              <h5 className="text-sm font-semibold text-foreground">
                                {broadcast.title}
                              </h5>
                              <p className="text-xs text-muted-foreground">
                                {broadcast.message}
                              </p>
                            </div>

                            {broadcast.data?.progress && (
                              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-2 text-xs">
                                <span>
                                  Discovered: {broadcast.data.progress.discovered}
                                </span>
                                <span>
                                  Enriched: {broadcast.data.progress.enriched}
                                </span>
                                <span>
                                  Analyzed: {broadcast.data.progress.analyzed}
                                </span>
                                <span>Total: {broadcast.data.progress.total}</span>
                              </div>
                            )}

                            {broadcast.requiresAck && !broadcast.acknowledged && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="mt-1"
                                onClick={() => acknowledgeBroadcast(broadcast._id)}
                              >
                                Acknowledge
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Pipeline Metrics
                </h4>
                {totalCount > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Target {totalCount}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    label: "Discovered",
                    value: discoveredCount,
                    icon: Search,
                  },
                  {
                    label: "Enriched",
                    value: enrichedCount,
                    icon: Mail,
                  },
                  {
                    label: "Analyzed",
                    value: analyzedCount,
                    icon: Bot,
                  },
                  {
                    label: "Completed",
                    value: search.results?.totalFound || totalCount,
                    icon: CheckCircle,
                  },
                ].map((metric) => {
                  const MetricIcon = metric.icon;
                  return (
                    <div
                      key={metric.label}
                      className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/90 p-3"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <MetricIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-foreground">
                          {metric.value}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {metric.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {search.researchTier && (
              <div className="space-y-4 rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-3">
                    <ResearchTierIcon
                      className={cn("h-5 w-5", researchTierDisplay.color)}
                    />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Research Intelligence
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {researchTierDisplay.label} tier insights
                      </p>
                    </div>
                  </div>
                  <Badge variant={researchTierDisplay.variant} className="w-fit">
                    {search.researchStage?.replace("_", " ") || "In progress"}
                  </Badge>
                </div>

                <p className="text-sm text-muted-foreground">
                  {researchTierDisplay.description}
                </p>

                <div className="grid grid-cols-2 gap-3 text-center text-sm">
                  {search.researchConfidence && (
                    <div className="rounded-lg border border-border/40 bg-background/80 p-3">
                      <div className="text-lg font-semibold">
                        {Math.round(search.researchConfidence * 100)}%
                      </div>
                      <div className="text-xs text-muted-foreground">Confidence</div>
                    </div>
                  )}
                  {search.researchDataPoints && (
                    <div className="rounded-lg border border-border/40 bg-background/80 p-3">
                      <div className="text-lg font-semibold">
                        {search.researchDataPoints}
                      </div>
                      <div className="text-xs text-muted-foreground">Data Points</div>
                    </div>
                  )}
                  {search.researchSourcesAnalyzed && (
                    <div className="rounded-lg border border-border/40 bg-background/80 p-3">
                      <div className="text-lg font-semibold">
                        {search.researchSourcesAnalyzed}
                      </div>
                      <div className="text-xs text-muted-foreground">Sources</div>
                    </div>
                  )}
                  {search.researchResults?.competitors?.length && (
                    <div className="rounded-lg border border-border/40 bg-background/80 p-3">
                      <div className="text-lg font-semibold">
                        {search.researchResults.competitors.length}
                      </div>
                      <div className="text-xs text-muted-foreground">Competitors</div>
                    </div>
                  )}
                </div>

                {search.researchEscalationReason && (
                  <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                    <TrendingUp className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Research Enhanced:</strong>{" "}
                      {search.researchEscalationReason}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/70 p-4 shadow-sm">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Search Details
          </h4>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Started
              </span>
              <p className="mt-1 font-medium text-foreground">
                {new Date(search.createdAt).toLocaleString()}
              </p>
            </div>
            {search.completedAt && (
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Completed
                </span>
                <p className="mt-1 font-medium text-foreground">
                  {new Date(search.completedAt).toLocaleString()}
                </p>
              </div>
            )}
            <div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Credits Used
              </span>
              <p className="mt-1 font-medium text-foreground">
                {search.creditsUsed || 0}
              </p>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Results
              </span>
              <p className="mt-1 font-medium text-foreground">
                {search.results?.totalFound || 0} leads
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
