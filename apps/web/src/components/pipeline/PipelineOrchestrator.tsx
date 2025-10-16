import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePipeline } from "@/pipeline/context";
import type { Lead } from "@/lib/api-client";
import { STAGE_CONFIGS, STAGE_ORDER } from "@/pipeline/config";
import { SourceSelector } from "./SourceSelector";
import { LeadDiscoveryStage } from "./LeadDiscoveryStage";
import { EnrichmentStage } from "./EnrichmentStage";
import { AIPersonalizationStage } from "./AIPersonalizationStage";
import { ReviewExportStage } from "./ReviewExportStage";
import { SearchProgressTracker } from "../SearchProgressTracker";
import { StageTracker } from "./StageTracker";
import { SourceInlinePanel } from "./SourceInlinePanel";
import {
  CheckCircle,
  Clock,
  Sparkles,
  Search,
  Users,
  Brain,
  Zap,
  AlertTriangle,
  RotateCcw,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearch } from "@/hooks/useSearches";
import { useSearchBroadcasts } from "@/hooks/useStatusBroadcasts";
import { useAdminSystemControl } from "@/hooks/useAdmin";
import { SourceRegistry } from "@/pipeline/sources/SourceRegistry";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { PipelineProgressProvider } from "@/contexts/PipelineProgressContext";
import { PipelineProgressPanel } from "@/components/PipelineProgressPanel";
import { featureFlags } from "@/lib/featureFlags";

interface PipelineOrchestratorProps {
  userCredits: number;
  userPlan: "free" | "pro" | "enterprise";
  onGenerateEmail?: (lead: Lead) => void;
  onOpenLeadHistory?: () => void;
}

export function PipelineOrchestrator({
  userCredits,
  userPlan,
  onGenerateEmail,
  onOpenLeadHistory,
}: PipelineOrchestratorProps) {
  const { state, setStage, canProgressToStage } = usePipeline();
  const [isPipelineCollapsed, setIsPipelineCollapsed] = useState(false);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const lastCompletedSearchIdRef = useRef<string | null>(null);
  const { toast } = useToast();

  // Get search data and real-time updates
  const { search } = useSearch(state.searchId || undefined);
  const { broadcasts, latestStatus } = useSearchBroadcasts(
    state.searchId || undefined,
  );

  // Get system status and configuration for health checks
  const { systemStatus, systemConfiguration } = useAdminSystemControl();

  const isUnifiedProgressEnabled = featureFlags.unifiedProgressPanel;

  // Check if search is completed
  const searchStatus = search?.status;
  const isSearchCompleted = searchStatus === "completed";
  const activeSearchId = (search?._id ?? state.searchId) ?? null;
  const totalFound = search?.results?.totalFound ?? 0;
  const enrichedCount = search?.results?.enrichedCount ?? 0;

  const openLeadHistory = useCallback(() => {
    setShowCompletionDialog(false);
    if (onOpenLeadHistory) {
      onOpenLeadHistory();
    } else {
      window.location.hash = "#lead-history";
    }

    setIsPipelineCollapsed(true);
  }, [onOpenLeadHistory, setIsPipelineCollapsed]);

  const currentStageIndex = STAGE_ORDER.indexOf(state.currentStage);

  const availableStages = STAGE_ORDER.filter((stageId) =>
    canProgressToStage(stageId),
  );

  const selectedSource = state.selectedSource
    ? SourceRegistry.getSource(state.selectedSource)
    : undefined;

  const inlineSourcePanel = selectedSource ? (
    <SourceInlinePanel
      icon={React.createElement(selectedSource.icon, {
        className: "h-5 w-5",
      })}
      title={selectedSource.name}
      subtitle={selectedSource.description}
      onChange={() => setStage("source_selection")}
    />
  ) : undefined;

  // Compute processing state from backend + local state
  const isBusy =
    state.isProcessing ||
    search?.status === "in_progress" ||
    search?.status === "processing";

  const trackerInlineContent = inlineSourcePanel || isBusy
    ? (
        <div className="flex flex-col gap-3">
          {inlineSourcePanel}
          {isBusy && (
            <div className="flex items-center gap-2 self-start rounded-full bg-slate-100/80 px-3 py-1 text-sm text-genniBlue dark:bg-slate-800/70 dark:text-genniBlue">
              <Clock className="h-4 w-4 animate-spin" />
              Processing...
            </div>
          )}
        </div>
      )
    : undefined;

  const handleStageSelect = (stage: (typeof STAGE_ORDER)[number]) => {
    if (stage === state.currentStage) return;
    if (
      state.completedStages.includes(stage) ||
      canProgressToStage(stage)
    ) {
      setStage(stage);
    }
  };

  // Get research tier display info
  const getResearchTierInfo = (tier?: string) => {
    switch (tier) {
      case "tavily":
        return {
          label: "Standard Research",
          icon: Search,
          color: "text-blue-500 dark:text-blue-200",
          bg: "bg-blue-50 dark:bg-blue-500/20",
          description: "Fast business context (2-3s)",
        };
      case "exa":
        return {
          label: "Enhanced Research",
          icon: Brain,
          color: "text-purple-500 dark:text-purple-200",
          bg: "bg-purple-50 dark:bg-purple-500/20",
          description: "Deep competitor analysis (3-4s)",
        };
      case "perplexity":
        return {
          label: "Premium Research",
          icon: Zap,
          color: "text-amber-600 dark:text-amber-200",
          bg: "bg-amber-50 dark:bg-amber-500/20",
          description: "Comprehensive report (10-15s)",
        };
      default:
        return null;
    }
  };

  const researchTierInfo = getResearchTierInfo(search?.researchTier);

  useEffect(() => {
    if (!activeSearchId) {
      lastCompletedSearchIdRef.current = null;
      return;
    }

    if (isSearchCompleted) {
      if (lastCompletedSearchIdRef.current === activeSearchId) {
        return;
      }

      lastCompletedSearchIdRef.current = activeSearchId;
      // Show completion dialog instead of toast - no auto-forwarding
      setShowCompletionDialog(true);
      return;
    }

    if (
      searchStatus !== undefined &&
      searchStatus !== "completed" &&
      lastCompletedSearchIdRef.current === activeSearchId
    ) {
      lastCompletedSearchIdRef.current = null;
    }
  }, [activeSearchId, enrichedCount, isSearchCompleted, searchStatus, totalFound]);

  const unifiedPanelActions = isSearchCompleted
    ? (
        <Button size="sm" variant="outline" onClick={openLeadHistory} className="gap-2">
          <FileText className="h-4 w-4" />
          View results
        </Button>
      )
    : undefined;

  const optimisticMetrics = {
    discovered: state.leads.length,
    enriched: state.enrichedLeads.length,
    analyzed: state.generatedEmails.length,
    total: Math.max(
      state.leads.length,
      state.enrichedLeads.length,
      state.generatedEmails.length,
    ),
  };

  const shouldHideInteractiveSections =
    isSearchCompleted && isPipelineCollapsed;

  const renderStageContent = () => {
    switch (state.currentStage) {
      case "source_selection":
        return <SourceSelector />;
      case "lead_discovery":
        return (
          <LeadDiscoveryStage userCredits={userCredits} userPlan={userPlan} />
        );
      case "enrichment":
        return <EnrichmentStage />;
      case "ai_personalization":
        return <AIPersonalizationStage />;
      case "review_export":
        return <ReviewExportStage />;
      default:
        return <SourceSelector />;
    }
  };

  return (
    <>
      {/* Search Completion Dialog */}
      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-white" />
              </div>
              <DialogTitle className="text-2xl">Search Complete!</DialogTitle>
            </div>
            <DialogDescription className="text-base pt-2">
              {totalFound > 0 ? (
                <div className="space-y-2">
                  <p className="font-medium text-foreground">
                    Great news! We found and processed your leads.
                  </p>
                  <div className="grid grid-cols-3 gap-3 pt-3">
                    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/50 p-3">
                      <div className="text-2xl font-bold text-foreground">{totalFound}</div>
                      <div className="text-xs text-muted-foreground">Found</div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/50 p-3">
                      <div className="text-2xl font-bold text-foreground">{enrichedCount}</div>
                      <div className="text-xs text-muted-foreground">Enriched</div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/50 p-3">
                      <div className="text-2xl font-bold text-foreground">
                        {search?.results?.analyzedCount || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Analyzed</div>
                    </div>
                  </div>
                </div>
              ) : (
                <p>Your search has finished. Review the results in search history.</p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowCompletionDialog(false);
                setStage("source_selection");
                setIsPipelineCollapsed(false);
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Start New Search
            </Button>
            <Button onClick={openLeadHistory} className="gap-2">
              <FileText className="h-4 w-4" />
              View Results
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          "space-y-6 transition-colors",
          isSearchCompleted &&
            "rounded-2xl border border-green-200/70 bg-green-50/80 p-3 shadow-inner dark:border-green-700/60 dark:bg-green-950/40",
        )}
      >
      {/* Pipeline Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Lead Generation Pipeline</h2>
            <p className="text-muted-foreground">
              Follow the guided workflow to discover, enrich, and generate
              personalized emails
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
            >
              <Sparkles className="h-3 w-3 mr-1" />
              AI-Powered Pipeline
            </Badge>

            <div className="text-right text-sm">
              <div className="font-medium">{userCredits} Credits</div>
              <div className="text-xs text-muted-foreground capitalize">
                {userPlan} Plan
              </div>
            </div>
          </div>
        </div>

        {/* Completion UI removed - using modal dialog only to prevent duplicate UI and flickering */}
      </div>

      {/* System Status Warning */}
      {systemStatus?.leadGenerationPaused && (
        <Alert
          variant="destructive"
          className="border-red-500 bg-red-50 dark:border-red-500/70 dark:bg-red-950/40"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-semibold">
                Lead generation is currently paused by administrator
              </div>
              <div className="text-sm">
                Reason:{" "}
                {systemStatus.orchestrationSettings?.pauseReason ||
                  "System maintenance"}
              </div>
              <div className="text-sm">
                All pipeline operations are temporarily disabled. Please contact
                support for updates.
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* LangGraph Worker Health Warning */}
      {systemConfiguration?.orchestrationSettings?.langGraphHealth?.status === "unavailable" && (
        <Alert
          variant="destructive"
          className="border-red-500 bg-red-50 dark:border-red-500/70 dark:bg-red-950/40"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-semibold">
                AI Analysis Service Unavailable
              </div>
              <div className="text-sm">
                The LangGraph worker service is currently unavailable. AI analysis and email generation will be blocked until the service is restored.
              </div>
              {systemConfiguration.orchestrationSettings.langGraphHealth.lastError && (
                <div className="text-xs text-muted-foreground mt-2">
                  Error: {systemConfiguration.orchestrationSettings.langGraphHealth.lastError}
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {systemConfiguration?.orchestrationSettings?.langGraphHealth?.status === "degraded" && (
        <Alert className="border-yellow-500 bg-yellow-50 dark:border-yellow-500/70 dark:bg-yellow-950/40">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-300" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-semibold text-yellow-900 dark:text-yellow-200">
                AI Analysis Service Degraded
              </div>
              <div className="text-sm text-yellow-800 dark:text-yellow-200/80">
                The LangGraph worker is experiencing issues. AI analysis may be slower than usual or encounter errors.
              </div>
              <div className="text-xs text-yellow-700 mt-1 dark:text-yellow-300/80">
                {systemConfiguration.orchestrationSettings.langGraphHealth.consecutiveFailures} consecutive failures detected
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Pipeline Content - Hide when collapsed */}
      {isUnifiedProgressEnabled ? (
        <PipelineProgressProvider
          searchId={state.searchId || undefined}
          currentStage={state.currentStage}
          completedStages={state.completedStages}
          availableStages={availableStages}
          optimisticMetrics={optimisticMetrics}
          onStageAdvance={setStage}
          onStageSelect={handleStageSelect}
          collapsed={isPipelineCollapsed}
          onCollapseChange={setIsPipelineCollapsed}
        >
          <PipelineProgressPanel
            inlinePanel={trackerInlineContent}
            actions={unifiedPanelActions}
          />
        </PipelineProgressProvider>
      ) : (
        <StageTracker
          current={state.currentStage}
          completed={state.completedStages}
          available={availableStages}
          index={currentStageIndex + 1}
          total={STAGE_ORDER.length}
          inlinePanel={trackerInlineContent}
          onStageClick={handleStageSelect}
        />
      )}

      {!shouldHideInteractiveSections && (
        <div
          className={cn(
            "transition-all duration-500 ease-in-out",
            (isBusy || systemStatus?.leadGenerationPaused) &&
              "opacity-75 pointer-events-none",
          )}
        >
          {renderStageContent()}
        </div>
      )}

      {!isUnifiedProgressEnabled &&
        state.searchId &&
        search &&
        !shouldHideInteractiveSections && (
          <SearchProgressTracker
            searchId={state.searchId}
            compact={false}
            showHistory={true}
            className="mb-6"
          />
        )}

      {!isUnifiedProgressEnabled && !shouldHideInteractiveSections && (
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full transition-colors",
                      isBusy ? "bg-yellow-500 animate-pulse" : "bg-green-500",
                    )}
                  />
                  <span className="text-sm font-medium">
                    {isBusy ? "Processing..." : "Ready"}
                  </span>
                  {researchTierInfo && (
                    <Badge
                      variant="outline"
                      className={cn("ml-2", researchTierInfo.bg, researchTierInfo.color)}
                    >
                      {React.createElement(researchTierInfo.icon, {
                        className: cn("w-3 h-3 mr-1", researchTierInfo.color),
                      })}
                      {researchTierInfo.label}
                    </Badge>
                  )}
                </div>

                {latestStatus && (
                  <Badge variant="secondary" className="text-xs">
                    {latestStatus.title}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center dark:bg-blue-500/20">
                    <Search className="h-4 w-4 text-blue-500 dark:text-blue-200" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {search?.progress?.discovered || state.leads.length || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Discovered</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center dark:bg-green-500/20">
                    <Users className="h-4 w-4 text-green-500 dark:text-green-200" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {search?.progress?.enriched || state.enrichedLeads.length || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Enriched</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center dark:bg-purple-500/20">
                    <Brain className="h-4 w-4 text-purple-500 dark:text-purple-200" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {search?.progress?.analyzed || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Analyzed</div>
                  </div>
                </div>

                {search?.researchConfidence && (
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center dark:bg-amber-500/20">
                      <Sparkles className="h-4 w-4 text-amber-500 dark:text-amber-200" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold">
                        {Math.round(search.researchConfidence * 100)}%
                      </div>
                      <div className="text-xs text-muted-foreground">Confidence</div>
                    </div>
                  </div>
                )}
              </div>

              {search?.researchStage && (
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Research Progress</span>
                    <span className="font-medium">
                      {search.researchStage
                        .replace("_", " ")
                        .replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
                  </div>
                  {researchTierInfo && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {researchTierInfo.description}
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </>
  );
}
