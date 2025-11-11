import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
  Mail,
  Bot,
  Loader2,
  Eye,
  Zap,
  FileText,
  TrendingUp,
  Brain,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useSearchBroadcasts,
  getPriorityDisplay,
  formatBroadcastTime,
} from "@/hooks/useStatusBroadcasts";
import { useSearches } from "@/hooks/useSearches";
import type { Id } from "@genni/convex-types/dataModel";
import { cn } from "@/lib/utils";
import { toStandardCase } from "@/utils/string";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";

interface SearchProgressTrackerProps {
  searchId: Id<"searches">;
  compact?: boolean;
  showHistory?: boolean;
  className?: string;
}

type StageId = "discovery" | "enrichment" | "analysis" | "completion";

type TimelineStage = {
  id: StageId;
  label: string;
  icon: LucideIcon;
  count: number | undefined;
  tooltip?: string;
};

const STAGE_ORDER: StageId[] = [
  "discovery",
  "enrichment",
  "analysis",
  "completion",
];

const COMPLETION_HINTS = ["complete", "completed", "ready", "finished", "handoff"];

const ERROR_HINTS = ["failed", "error", "cancelled"];

const CREDIT_TOOLTIP =
  "Discovery and contact finding consume 1 credit per lead. Research tiers may add a dynamic premium when escalated.";

/**
 * Search progress tracker focused on a single narrative of the pipeline.
 */
export function SearchProgressTracker({
  searchId,
  compact = false,
  showHistory = true,
  className,
}: SearchProgressTrackerProps) {
  // Try to reuse data from UserDataContext first (for recent searches)
  const { searches, cancelSearch } = useSearches();
  const searchFromList = searches.find((s) => s._id === searchId);

  // Fallback to direct query for older searches not in the paginated list
  const searchDirect = useQuery(
    api.search.queries.getSearchById,
    searchFromList ? "skip" : { searchId }
  );

  // Use whichever source has the data
  const search = searchFromList ?? searchDirect;

  const {
    broadcasts,
    latestStatus,
    acknowledgeBroadcast,
    currentStage,
  } = useSearchBroadcasts(searchId);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!search) {
    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="p-6">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Loading search...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formattedSearchName = toStandardCase(search.name || "");
  const discoveredCount = search.progress?.discovered ?? 0;
  const enrichedCount = search.progress?.enriched ?? 0;
  const analyzedCount = search.progress?.analyzed ?? 0;
  const totalCount =
    search.progress?.total ||
    search.results?.totalFound ||
    Math.max(discoveredCount, enrichedCount, analyzedCount);
  const researchSources = search.researchSourcesAnalyzed ?? undefined;
  const creditsEstimate = search.creditsReserved ?? search.creditsUsed ?? totalCount;
  const duplicateStats = {
    placeId: search.duplicatesFilteredPlaceId ?? 0,
    placeName: search.duplicatesFilteredPlaceName ?? 0,
    address: search.duplicatesFilteredAddress ?? 0,
    email: search.duplicatesFilteredEmail ?? 0,
  };
  const totalDuplicatesFiltered =
    duplicateStats.placeId +
    duplicateStats.placeName +
    duplicateStats.address +
    duplicateStats.email;
  const finalRadiusMiles =
    search.finalSearchRadius && search.finalSearchRadius > 0
      ? (search.finalSearchRadius / 1609.34).toFixed(1)
      : null;
  const discoveryMetadata = search.discoveryMetadata;

  const researchTierDisplay = getResearchTierDisplay(search.researchTier);
  const analysisStageIcon: LucideIcon =
    search.researchTier && search.researchTier !== "error"
      ? researchTierDisplay.icon
      : Bot;
  const StatusIcon = getStatusIcon(search.status);

  const statusBadgeVariant =
    search.status === "completed"
      ? "default"
      : search.status === "failed" || search.status === "cancelled"
        ? "destructive"
        : "secondary";

  const normalizedStage = (currentStage || "").toLowerCase();

  const baseStageIndex = (() => {
    const stageIndex = STAGE_ORDER.findIndex((stageId) => {
      const stageMatchers = getStageMatchers(stageId);
      return stageMatchers.some((matcher) => normalizedStage.includes(matcher));
    });

    if (stageIndex >= 0) {
      if (
        stageIndex < STAGE_ORDER.length - 1 &&
        COMPLETION_HINTS.some((hint) => normalizedStage.includes(hint))
      ) {
        return stageIndex + 1;
      }
      return stageIndex;
    }

    if (search.status === "completed") {
      return STAGE_ORDER.length - 1;
    }

    if (analyzedCount > 0 ||
      (search.researchStage && search.researchStage !== "research_failed")) {
      return STAGE_ORDER.indexOf("analysis");
    }
    if (enrichedCount > 0 || search.status === "processing") {
      return STAGE_ORDER.indexOf("enrichment");
    }
    if (discoveredCount > 0 || search.status !== "pending") {
      return STAGE_ORDER.indexOf("discovery");
    }

    return 0;
  })();

  const timelineStages: TimelineStage[] = [
    {
      id: "discovery",
      label: "Find Leads",
      icon: Search,
      count: discoveredCount,
    },
    {
      id: "enrichment",
      label: "Get Contacts",
      icon: Mail,
      count: enrichedCount,
      tooltip: "Finding email contacts for each lead",
    },
    {
      id: "analysis",
      label: "Create Emails",
      icon: analysisStageIcon,
      count: analyzedCount,
      tooltip:
        search.researchTier === "error"
          ? "Research escalated due to earlier tier failure"
          : researchSources && researchSources > 0
            ? `${researchSources} research sources analyzed`
            : search.researchTier && search.researchTier !== "error"
              ? `${researchTierDisplay.label} research with AI personalization`
              : "AI-powered email personalization",
    },
    {
      id: "completion",
      label: "Ready",
      icon: CheckCircle,
      count: search.results?.totalFound ?? (search.status === "completed" ? totalCount : undefined),
    },
  ];

  const pipelineStarted = search.status !== "pending";
  const activeIndex = Math.max(0, Math.min(baseStageIndex, timelineStages.length - 1));

  const metrics = [
    {
      label: "Found",
      value: discoveredCount,
      stageIndex: STAGE_ORDER.indexOf("discovery"),
    },
    {
      label: "Contacts",
      value: enrichedCount,
      stageIndex: STAGE_ORDER.indexOf("enrichment"),
    },
    {
      label: "Created",
      value: analyzedCount,
      stageIndex: STAGE_ORDER.indexOf("analysis"),
    },
    {
      label: "Total",
      value: totalCount,
      stageIndex: STAGE_ORDER.indexOf("completion"),
    },
  ];

  const latestUpdate = broadcasts[0] ?? latestStatus;
  const latestStageLabel = timelineStages[activeIndex]?.label ?? "Pipeline";
  const latestMessage =
    typeof latestUpdate?.message === "string"
      ? latestUpdate.message
      : search.status === "completed"
        ? "Pipeline complete"
        : pipelineStarted
          ? `Continuing ${latestStageLabel.toLowerCase()}...`
          : "Ready to begin";
  const latestTimestamp =
    typeof latestUpdate?.createdAt === "number"
      ? formatBroadcastTime(latestUpdate.createdAt)
      : search.startedAt
        ? formatBroadcastTime(search.startedAt)
        : undefined;

  const topUpdates = broadcasts.slice(0, 3);
  const hasErrors = ERROR_HINTS.some((hint) => normalizedStage.includes(hint)) || search.status === "failed";
  const canViewResults = search.status === "completed" || (search.results?.totalFound ?? 0) > 0;

  const handleCancel = async () => {
    try {
      setIsCancelling(true);
      await cancelSearch({ searchId });
    } finally {
      setIsCancelling(false);
      setConfirmOpen(false);
    }
  };

  const handleViewResults = () => {
    window.location.hash = "#lead-history";
  };

  if (compact) {
    const ActiveStageIcon = timelineStages[activeIndex]?.icon ?? Search;
    const activeStageLabel = timelineStages[activeIndex]?.label ?? "Pipeline";

    return (
      <Card className={cn("w-full", className)}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full border",
              search.status === "completed"
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : search.status === "failed"
                  ? "border-red-200 bg-red-50 text-red-600"
                  : "border-primary/30 bg-primary/5 text-primary",
            )}
          >
            <ActiveStageIcon className="h-4 w-4" />
          </span>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {formattedSearchName || "Lead pipeline"}
              </span>
              <Badge variant={statusBadgeVariant} className="text-[10px] uppercase">
                {search.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {pipelineStarted ? `${activeStageLabel} stage` : "Ready to begin"}
            </span>
          </div>

          {canViewResults && (
            <Button size="sm" variant="outline" onClick={handleViewResults} className="gap-1">
              <Eye className="h-3.5 w-3.5" />
              View
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("w-full", className)}>
      <TooltipProvider delayDuration={200}>
        <CardHeader className="gap-4 pb-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border",
                    search.status === "completed"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                      : search.status === "failed"
                        ? "border-red-200 bg-red-50 text-red-600"
                        : "border-primary/30 bg-primary/5 text-primary",
                  )}
                >
                  <StatusIcon
                    className={cn(
                      "h-4 w-4",
                      (search.status === "in_progress" || search.status === "processing") && "animate-spin",
                    )}
                  />
                </span>
                <CardTitle className="text-base font-semibold">
                  {formattedSearchName || "Lead pipeline"}
                </CardTitle>
                <Badge variant={statusBadgeVariant}>{search.status.replace(/_/g, " ")}</Badge>
                {search.researchTier && (
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                    {researchTierDisplay.icon && (
                      <researchTierDisplay.icon className={cn("h-3.5 w-3.5", researchTierDisplay.accent)} />
                    )}
                    {researchTierDisplay.label}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span>
                    {creditsEstimate ?? 0} credits scoped
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-[10px] font-semibold text-muted-foreground"
                        aria-label="Credit usage details"
                      >
                        ?
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      {CREDIT_TOOLTIP}
                    </TooltipContent>
                  </Tooltip>
                </div>
                {latestTimestamp && (
                  <span>Updated {latestTimestamp}</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canViewResults && (
                <Button size="sm" onClick={handleViewResults} className="gap-2">
                  <Eye className="h-4 w-4" />
                  View results
                </Button>
              )}

              {(search.status === "pending" ||
                search.status === "in_progress" ||
                search.status === "processing") && (
                <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10">
                      <XCircle className="h-4 w-4" />
                      Cancel Search
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Cancel this search?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Cancelling now will stop the search pipeline. Credits for stages that have not started yet will be preserved. Any work already completed will be saved.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isCancelling}>Keep running</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleCancel}
                        disabled={isCancelling}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isCancelling ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Cancelling...
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 mr-2" />
                            Cancel Search
                          </>
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Pipeline
              </h3>
              <span className="text-xs text-muted-foreground">
                {activeIndex + 1}/{timelineStages.length} stages
              </span>
            </div>

            <div className="relative flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                {timelineStages.map((stage, index) => {
                  const StageIcon = stage.icon;
                  const isActive = pipelineStarted && index === activeIndex && !hasErrors;
                  const isComplete = index < activeIndex || search.status === "completed";
                  const isFuture = index > activeIndex && !(search.status === "completed" && index === activeIndex);

                  return (
                    <div key={stage.id} className="flex flex-1 flex-col items-center gap-2">
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                "flex h-11 w-11 items-center justify-center rounded-full border transition-all",
                                isComplete
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                                  : isActive
                                    ? "border-primary/60 bg-primary/10 text-primary shadow-[0_0_0_4px_rgba(59,130,246,0.12)] animate-pulse"
                                    : isFuture
                                      ? "border-dashed border-muted text-muted-foreground"
                                      : "border-muted bg-muted/40 text-muted-foreground",
                                hasErrors && index === activeIndex && "border-red-300 bg-red-50 text-red-600",
                              )}
                            >
                              <StageIcon className="h-5 w-5" />
                            </div>
                          </TooltipTrigger>
                          {(stage.tooltip || (stage.id === "analysis" && search.researchEscalationReason)) && (
                            <TooltipContent className="max-w-xs text-xs">
                              {stage.tooltip || search.researchEscalationReason}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                      <div className="text-center text-xs">
                        <div className="font-medium text-foreground">{stage.label}</div>
                        <div className="text-muted-foreground">
                          {typeof stage.count === "number" ? `${stage.count} leads` : "–"}
                        </div>
                      </div>
                      {index < timelineStages.length - 1 && (
                        <div
                          className={cn(
                            "absolute left-0 right-0 top-1/2 -z-10 h-px translate-y-1/2 bg-gradient-to-r",
                            index < activeIndex
                              ? "from-emerald-200 via-emerald-200 to-transparent"
                              : index === activeIndex
                                ? "from-primary/60 via-primary/20 to-transparent"
                                : "from-muted/40 via-muted/20 to-transparent",
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-dashed border-border/60 bg-background/80 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full",
                    hasErrors
                      ? "bg-red-100 text-red-600"
                      : search.status === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-primary/10 text-primary",
                  )}
                >
                  {hasErrors ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {latestUpdate?.title ?? `${latestStageLabel} in progress`}
                  </p>
                  <p className="text-xs text-muted-foreground">{latestMessage}</p>
                </div>
              </div>
              {latestTimestamp && (
                <span className="text-xs text-muted-foreground">{latestTimestamp}</span>
              )}
            </div>

            {latestUpdate?.data && typeof latestUpdate.data === "object" && "progress" in latestUpdate.data && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                {Object.entries(latestUpdate.data.progress as Record<string, number | undefined>)
                  .filter(([key]) => ["discovered", "enriched", "analyzed", "total"].includes(key))
                  .map(([key, value]) => {
                    const labelMap: Record<string, string> = {
                      discovered: "Found",
                      enriched: "Contacts",
                      analyzed: "Created",
                      total: "Total",
                    };
                    const displayLabel = labelMap[key] || key;
                    return (
                      <div key={key} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                        <span className="uppercase tracking-wide">{displayLabel}</span>
                        <span className="font-semibold text-foreground">{value ?? 0}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          {showHistory && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent updates
                </h3>
                {broadcasts.length > 0 && (
                  <Sheet open={isLogOpen} onOpenChange={setIsLogOpen}>
                    <SheetTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        View full log
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-full sm:max-w-xl">
                      <SheetHeader>
                        <SheetTitle>Pipeline activity</SheetTitle>
                        <SheetDescription>Most recent 20 status updates</SheetDescription>
                      </SheetHeader>
                      <Separator className="my-4" />
                      <ScrollArea className="h-[70vh]">
                        <div className="space-y-4 pr-4">
                          {broadcasts.slice(0, 20).map((broadcast) => {
                            const priorityDisplay = getPriorityDisplay(broadcast.priority);
                            return (
                              <div key={broadcast._id} className="space-y-2 rounded-lg border border-border/60 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">{broadcast.title}</p>
                                    <p className="text-xs text-muted-foreground">{broadcast.message}</p>
                                  </div>
                                  <Badge variant={priorityDisplay.variant} className="text-[10px] uppercase">
                                    {formatBroadcastTime(broadcast.createdAt)}
                                  </Badge>
                                </div>
                                {broadcast.data && typeof broadcast.data === "object" && "progress" in broadcast.data && (
                                  <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
                                    {Object.entries(broadcast.data.progress as Record<string, number | undefined>).map(
                                      ([key, value]) => (
                                        <div key={key} className="flex items-center justify-between">
                                          <span className="uppercase tracking-wide">{key}</span>
                                          <span className="font-semibold text-foreground">{value ?? 0}</span>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                                {broadcast.requiresAck && !broadcast.acknowledged && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => acknowledgeBroadcast(broadcast._id)}
                                  >
                                    Mark as read
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </SheetContent>
                  </Sheet>
                )}
              </div>

              <div className="space-y-2">
                {topUpdates.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
                    Updates will appear here once the run begins.
                  </div>
                )}
                {topUpdates.map((broadcast) => {
                  const priorityDisplay = getPriorityDisplay(broadcast.priority);
                  const isLive =
                    broadcasts[0]?._id === broadcast._id &&
                    (search.status === "in_progress" || search.status === "processing");

                  return (
                    <div
                      key={broadcast._id}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border border-border/60 bg-background/80 p-3",
                        isLive && "border-primary/50 shadow-sm",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-1 h-2 w-2 rounded-full",
                          priorityDisplay.variant === "destructive"
                            ? "bg-red-500"
                            : priorityDisplay.variant === "default"
                              ? "bg-primary"
                              : "bg-amber-400",
                          isLive && "animate-pulse",
                        )}
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-foreground">{broadcast.title}</p>
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {formatBroadcastTime(broadcast.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{broadcast.message}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <Separator />

          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Run details
                </h3>
                <p className="text-xs text-muted-foreground">
                  Start and completion times, credit usage, and research insights.
                </p>
              </div>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 text-xs">
                  {detailsOpen ? "Hide" : "Show"}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="pt-4">
              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Started</span>
                  <p className="font-medium text-foreground">
                    {search.startedAt ? new Date(search.startedAt).toLocaleString() : "Pending"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Completed</span>
                  <p className="font-medium text-foreground">
                    {search.completedAt ? new Date(search.completedAt).toLocaleString() : "In progress"}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Credits used</span>
                  <p className="font-medium text-foreground">{search.creditsUsed ?? 0}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Results</span>
                  <p className="font-medium text-foreground">{search.results?.totalFound ?? 0} leads</p>
                </div>
              </div>

              {discoveryMetadata && (
                <div className="mt-6 space-y-3 rounded-md border border-border/60 bg-muted/10 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {discoveryMetadata.expanded
                          ? `Expanded search (${search.expansionIterations ?? 0} iterations)`
                          : "Original search area"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {discoveryMetadata.expansionMessage}
                      </p>
                    </div>
                    <Badge variant={discoveryMetadata.expanded ? "outline" : "secondary"}>
                      {discoveryMetadata.delivered} / {discoveryMetadata.requested} leads
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground md:grid-cols-3">
                    <div className="rounded-md bg-background/70 p-3">
                      <p className="text-sm font-semibold text-foreground">
                        {discoveryMetadata.originalAreaLeads}
                      </p>
                      <p className="uppercase tracking-wide">Original area</p>
                    </div>
                    <div className="rounded-md bg-background/70 p-3">
                      <p className="text-sm font-semibold text-foreground">
                        {discoveryMetadata.expansionAreaLeads}
                      </p>
                      <p className="uppercase tracking-wide">Expansion area</p>
                    </div>
                    <div className="rounded-md bg-background/70 p-3">
                      <p className="text-sm font-semibold text-foreground">
                        {finalRadiusMiles ? `${finalRadiusMiles} mi` : "-"}
                      </p>
                      <p className="uppercase tracking-wide">Final radius</p>
                    </div>
                  </div>
                  <div className="rounded-md bg-background/70 p-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <p className="uppercase tracking-wide">Duplicates filtered</p>
                      <span className="text-sm font-semibold text-foreground">
                        {totalDuplicatesFiltered}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                      <span>Place IDs {duplicateStats.placeId}</span>
                      <span>Names {duplicateStats.placeName}</span>
                      <span>Addresses {duplicateStats.address}</span>
                      <span>Emails {duplicateStats.email}</span>
                    </div>
                  </div>
                </div>
              )}

              {(search.researchConfidence ||
                search.researchDataPoints ||
                search.researchSourcesAnalyzed ||
                search.researchEscalationReason) && (
                <div className="mt-6 space-y-3 rounded-md border border-border/60 bg-background/80 p-4 text-sm">
                  <div className="flex items-center gap-2">
                    {researchTierDisplay.icon && (
                      <researchTierDisplay.icon className={cn("h-4 w-4", researchTierDisplay.accent)} />
                    )}
                    <span className="font-semibold text-foreground">Research summary</span>
                    {search.researchStage && (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {search.researchStage.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground md:grid-cols-4">
                    {search.researchConfidence && (
                      <div className="rounded-md bg-muted/30 p-3">
                        <p className="text-sm font-semibold text-foreground">
                          {Math.round(search.researchConfidence * 100)}%
                        </p>
                        <p className="uppercase tracking-wide">Confidence</p>
                      </div>
                    )}
                    {search.researchDataPoints && (
                      <div className="rounded-md bg-muted/30 p-3">
                        <p className="text-sm font-semibold text-foreground">{search.researchDataPoints}</p>
                        <p className="uppercase tracking-wide">Data points</p>
                      </div>
                    )}
                    {search.researchSourcesAnalyzed && (
                      <div className="rounded-md bg-muted/30 p-3">
                        <p className="text-sm font-semibold text-foreground">{search.researchSourcesAnalyzed}</p>
                        <p className="uppercase tracking-wide">Sources</p>
                      </div>
                    )}
                    {search.researchResults?.competitors?.length && (
                      <div className="rounded-md bg-muted/30 p-3">
                        <p className="text-sm font-semibold text-foreground">
                          {search.researchResults.competitors.length}
                        </p>
                        <p className="uppercase tracking-wide">Competitors</p>
                      </div>
                    )}
                  </div>
                  {search.researchEscalationReason && (
                    <div className="rounded-md bg-amber-50/80 px-3 py-2 text-xs text-amber-800">
                      <TrendingUp className="mr-2 inline h-3.5 w-3.5" />
                      Research escalated: {search.researchEscalationReason}
                    </div>
                  )}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </TooltipProvider>
    </Card>
  );
}

function getStageMatchers(stage: StageId) {
  switch (stage) {
    case "discovery":
      return ["discovery", "google_maps", "maps_discovery"];
    case "enrichment":
      return ["enrich", "enrichment", "contact", "lead_enrichment"];
    case "analysis":
      return [
        "analysis",
        "ai_analysis",
        "email_generation",
        "research",
        "tier1",
        "tier2",
        "tier3",
        "context",
        "intel",
      ];
    case "completion":
      return ["complete", "completed", "handoff", "pipeline", "ready", "wrap", "final"];
    default:
      return [];
  }
}

function getStatusIcon(status: string): LucideIcon {
  switch (status) {
    case "pending":
      return Clock;
    case "in_progress":
    case "processing":
      return Loader2;
    case "completed":
      return CheckCircle;
    case "failed":
    case "cancelled":
      return AlertCircle;
    default:
      return Clock;
  }
}

function getResearchTierDisplay(tier?: string) {
  switch (tier) {
    case "tavily":
      return { icon: Zap, label: "Standard", accent: "text-blue-500" };
    case "perplexity":
      return { icon: FileText, label: "Deep Research", accent: "text-amber-600" };
    case "error":
      return { icon: AlertCircle, label: "Research error", accent: "text-red-500" };
    default:
      return { icon: Brain, label: "Research", accent: "text-muted-foreground" };
  }
}
