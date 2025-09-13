import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
  Mail,
  Bot,
  Loader2,
  Play,
  Pause,
  X,
  Eye,
  Zap,
  Microscope,
  FileText,
  TrendingUp,
  Users,
  Brain,
} from "lucide-react";
import {
  useSearchBroadcasts,
  getPriorityDisplay,
  formatBroadcastTime,
} from "@/hooks/useStatusBroadcasts";
import { useSearch } from "@/hooks/useSearches";
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
  const {
    broadcasts,
    latestStatus,
    progressUpdates,
    acknowledgeBroadcast,
    hasUpdates,
  } = useSearchBroadcasts(searchId);

  const [showAllBroadcasts, setShowAllBroadcasts] = useState(false);

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

  // Enhanced pipeline stages with research tier
  const pipelineStages = [
    {
      name: "Discovery",
      icon: Search,
      status: currentStep >= 1 ? "completed" : "pending",
      description: "Finding leads via Google Maps",
      count: search.progress?.discovered || 0,
    },
    {
      name: "Research",
      icon: ResearchTierIcon,
      status:
        search.researchStage === "research_completed"
          ? "completed"
          : search.researchStage && search.researchStage !== "research_started"
            ? "in_progress"
            : "pending",
      description: researchTierDisplay.description,
      count: search.researchSourcesAnalyzed || 0,
      tier: search.researchTier,
      confidence: search.researchConfidence,
      escalation: search.researchEscalationReason,
    },
    {
      name: "Enrichment",
      icon: Mail,
      status:
        currentStep >= 2
          ? "completed"
          : currentStep === 1
            ? "in_progress"
            : "pending",
      description: "Enriching with contact information",
      count: search.progress?.enriched || 0,
    },
    {
      name: "Analysis",
      icon: Bot,
      status:
        currentStep >= 3
          ? "completed"
          : currentStep === 2
            ? "in_progress"
            : "pending",
      description: "AI analysis and email generation",
      count: search.progress?.analyzed || 0,
    },
    {
      name: "Completion",
      icon: CheckCircle,
      status: currentStep >= 4 ? "completed" : "pending",
      description: "Finalizing results and notifications",
      count: search.results?.totalFound || 0,
    },
  ];

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
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Bar */}
        {search.status === "in_progress" && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall Progress</span>
              <span>{Math.round(progressPercent)}%</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
          </div>
        )}

        {/* Pipeline Stages */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Pipeline Stages</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {pipelineStages.map((stage, index) => {
              const StageIcon = stage.icon;
              const stageDisplay = getStatusDisplay(stage.status);
              const StageStatusIcon = stageDisplay.icon;

              return (
                <Card
                  key={stage.name}
                  className={cn(
                    "p-3 transition-all duration-200",
                    stage.status === "completed" &&
                      "border-green-200 bg-green-50",
                    stage.status === "in_progress" &&
                      "border-blue-200 bg-blue-50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <StageIcon className="h-4 w-4 text-muted-foreground" />
                      <StageStatusIcon
                        className={cn(
                          "h-3 w-3",
                          stageDisplay.color,
                          stage.status === "in_progress" && "animate-spin",
                        )}
                      />
                    </div>
                    <span className="font-medium text-sm">{stage.name}</span>
                    {stage.tier && (
                      <Badge variant="outline" className="text-xs px-1 py-0">
                        {stage.tier}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stage.description}
                  </p>
                  {stage.count > 0 && (
                    <p className="text-xs font-medium mt-1">
                      {stage.name === "Research" ? "Sources: " : "Count: "}
                      {stage.count}
                    </p>
                  )}
                  {stage.confidence && (
                    <p className="text-xs font-medium mt-1">
                      Confidence: {Math.round(stage.confidence * 100)}%
                    </p>
                  )}
                  {stage.escalation && (
                    <p className="text-xs text-amber-600 mt-1">
                      Escalated: {stage.escalation}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>

        {/* Research Intelligence Section */}
        {search.researchTier && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Research Intelligence
            </h4>
            <Card className={cn("p-4", researchTierDisplay.bg)}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ResearchTierIcon
                    className={cn("h-5 w-5", researchTierDisplay.color)}
                  />
                  <span className="font-semibold">
                    {researchTierDisplay.label} Research Tier
                  </span>
                </div>
                <Badge variant={researchTierDisplay.variant}>
                  {search.researchStage?.replace("_", " ") || "In Progress"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {search.researchConfidence && (
                  <div className="text-center">
                    <div className="font-semibold text-lg">
                      {Math.round(search.researchConfidence * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Confidence
                    </div>
                  </div>
                )}
                {search.researchDataPoints && (
                  <div className="text-center">
                    <div className="font-semibold text-lg">
                      {search.researchDataPoints}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Data Points
                    </div>
                  </div>
                )}
                {search.researchSourcesAnalyzed && (
                  <div className="text-center">
                    <div className="font-semibold text-lg">
                      {search.researchSourcesAnalyzed}
                    </div>
                    <div className="text-xs text-muted-foreground">Sources</div>
                  </div>
                )}
                {search.researchResults?.competitors?.length && (
                  <div className="text-center">
                    <div className="font-semibold text-lg">
                      {search.researchResults.competitors.length}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Competitors
                    </div>
                  </div>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                {researchTierDisplay.description}
              </p>

              {search.researchEscalationReason && (
                <Alert className="mt-3">
                  <TrendingUp className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Research Enhanced:</strong>{" "}
                    {search.researchEscalationReason}
                  </AlertDescription>
                </Alert>
              )}

              {search.researchResults?.competitors?.length > 0 && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-2 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Discovered Competitors
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {search.researchResults.competitors
                      .slice(0, 5)
                      .map(
                        (
                          competitor: Record<string, unknown>,
                          index: number,
                        ) => (
                          <Badge
                            key={index}
                            variant="outline"
                            className="text-xs"
                          >
                            {(competitor.name as string) ||
                              (competitor.title as string) ||
                              "Competitor"}
                          </Badge>
                        ),
                      )}
                    {search.researchResults.competitors.length > 5 && (
                      <Badge variant="outline" className="text-xs">
                        +{search.researchResults.competitors.length - 5} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Latest Status Broadcast */}
        {latestStatus && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Latest Update</h4>
            <Alert
              className={getPriorityDisplay(latestStatus.priority).bgColor}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg">
                  {getPriorityDisplay(latestStatus.priority).icon}
                </span>
                <div className="flex-1">
                  <h5 className="font-medium text-sm">{latestStatus.title}</h5>
                  <p className="text-sm">{latestStatus.message}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">
                      {formatBroadcastTime(latestStatus.createdAt)}
                    </span>
                    {latestStatus.requiresAck && !latestStatus.acknowledged && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledgeBroadcast(latestStatus._id)}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Alert>
          </div>
        )}

        {/* Real-time Broadcasts History */}
        {showHistory && hasUpdates && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Status Updates</h4>
              {broadcasts.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllBroadcasts(!showAllBroadcasts)}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  {showAllBroadcasts
                    ? "Show Less"
                    : `Show All (${broadcasts.length})`}
                </Button>
              )}
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(showAllBroadcasts ? broadcasts : broadcasts.slice(0, 3)).map(
                (broadcast) => {
                  const priorityDisplay = getPriorityDisplay(
                    broadcast.priority,
                  );

                  return (
                    <div
                      key={broadcast._id}
                      className="flex items-start gap-2 p-2 rounded-lg border bg-card"
                    >
                      <span className="text-sm">{priorityDisplay.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
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
                        <h5 className="font-medium text-sm mt-1">
                          {broadcast.title}
                        </h5>
                        <p className="text-xs text-muted-foreground">
                          {broadcast.message}
                        </p>

                        {/* Show progress data if available */}
                        {broadcast.data?.progress && (
                          <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                            <div className="grid grid-cols-2 gap-2">
                              <span>
                                Discovered: {broadcast.data.progress.discovered}
                              </span>
                              <span>
                                Enriched: {broadcast.data.progress.enriched}
                              </span>
                              <span>
                                Analyzed: {broadcast.data.progress.analyzed}
                              </span>
                              <span>
                                Total: {broadcast.data.progress.total}
                              </span>
                            </div>
                          </div>
                        )}

                        {broadcast.requiresAck && !broadcast.acknowledged && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
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

        {/* Search Details */}
        <div className="pt-4 border-t space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Started:</span>
              <p className="font-medium">
                {new Date(search.createdAt).toLocaleString()}
              </p>
            </div>
            {search.completedAt && (
              <div>
                <span className="text-muted-foreground">Completed:</span>
                <p className="font-medium">
                  {new Date(search.completedAt).toLocaleString()}
                </p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Credits Used:</span>
              <p className="font-medium">{search.creditsUsed || 0}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Results:</span>
              <p className="font-medium">
                {search.results?.totalFound || 0} leads
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
