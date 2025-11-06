import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { useLeads } from "@/hooks/useLeads";
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
  onNavigateToSettings?: () => void;
}

export function PipelineOrchestrator({
  userCredits,
  userPlan,
  onGenerateEmail,
  onOpenLeadHistory,
  onNavigateToSettings,
}: PipelineOrchestratorProps) {
  const { state, setStage, canProgressToStage, setLeads, setEnrichedLeads } =
    usePipeline();
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

  const { leads: searchLeads } = useLeads(state.searchId || undefined);

  const leadsFromPipeline = useMemo(() => {
    if (state.searchId && searchLeads) {
      return searchLeads;
    }
    return state.leads;
  }, [searchLeads, state.leads, state.searchId]);

  useEffect(() => {
    if (!state.searchId || !searchLeads || searchLeads.length === 0) {
      return;
    }

    const leadsLengthChanged = state.leads.length !== searchLeads.length;
    const hasDifferentLead =
      leadsLengthChanged ||
      state.leads.some(
        (lead, index) => lead._id !== searchLeads[index]?._id,
      );

    if (hasDifferentLead) {
      setLeads(searchLeads);
    }

    const enriched = searchLeads.filter(
      (lead) => lead.contactInfo?.emails?.length,
    );

    if (state.enrichedLeads.length !== enriched.length) {
      setEnrichedLeads(enriched);
    }
  }, [
    searchLeads,
    setEnrichedLeads,
    setLeads,
    state.enrichedLeads.length,
    state.leads,
    state.searchId,
  ]);

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
        badgeClass:
          "border border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
        description: "Fast business context (2-3s)",
      };
    case "perplexity":
      return {
        label: "Deep Research",
        icon: Zap,
        badgeClass:
          "border border-amber-500/40 bg-amber-500/10 text-amber-200",
        description: "Comprehensive report (8-12s)",
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

  const discoveredFromSearch =
    search?.progress?.discovered ??
    search?.results?.totalFound ??
    state.leads.length;

  const enrichedFromSearch =
    search?.progress?.enriched ??
    search?.results?.enrichedCount ??
    state.enrichedLeads.length;

  const analyzedFromSearch =
    search?.progress?.analyzed ?? state.generatedEmails.length;

  const enrichedFromLeads = useMemo(() => {
    if (!leadsFromPipeline?.length) {
      return 0;
    }
    return leadsFromPipeline.filter((lead) => lead.contactInfo?.emails?.length)
      .length;
  }, [leadsFromPipeline]);

  const optimisticMetrics = useMemo(() => {
    const discoveredMetric = Math.max(
      discoveredFromSearch,
      leadsFromPipeline?.length ?? 0,
    );
    const enrichedMetric = Math.max(
      enrichedFromSearch,
      enrichedFromLeads,
      state.enrichedLeads.length,
    );
    const analyzedMetric = Math.max(
      analyzedFromSearch,
      state.generatedEmails.length,
    );
    const totalMetric = Math.max(
      search?.progress?.total ?? 0,
      search?.results?.totalFound ?? 0,
      discoveredMetric,
      enrichedMetric,
      analyzedMetric,
    );

    return {
      discovered: discoveredMetric,
      enriched: enrichedMetric,
      analyzed: analyzedMetric,
      total: totalMetric,
    };
  }, [
    analyzedFromSearch,
    discoveredFromSearch,
    enrichedFromLeads,
    enrichedFromSearch,
    leadsFromPipeline?.length,
    search?.progress?.total,
    search?.results?.totalFound,
    state.enrichedLeads.length,
    state.generatedEmails.length,
  ]);

  const shouldHideInteractiveSections =
    isSearchCompleted && isPipelineCollapsed;

  const renderStageContent = () => {
    switch (state.currentStage) {
      case "source_selection":
        return <SourceSelector />;
      case "lead_discovery":
        return (
          <LeadDiscoveryStage
            userCredits={userCredits}
            userPlan={userPlan}
            onNavigateToSettings={onNavigateToSettings}
          />
        );
      case "enrichment":
        return <EnrichmentStage />;
      case "ai_personalization":
        // AI personalization is tracked via SearchProgressTracker below
        return null;
      case "review_export":
        return <ReviewExportStage onViewResults={openLeadHistory} />;
      default:
        return <SourceSelector />;
    }
  };

  return (
    <>
      {/* Search Completion Dialog */}
      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="sm:max-w-md border border-slate-800/60 bg-slate-950/90 shadow-[0_24px_72px_-32px_rgba(0,255,204,0.35)]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/15 text-emerald-200 shadow-[0_0_22px_rgba(0,255,132,0.25)]">
                <CheckCircle className="h-6 w-6" />
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
                    <div className="flex flex-col items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-100">
                      <div className="text-2xl font-bold">{totalFound}</div>
                      <div className="text-xs text-muted-foreground">Found</div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3 text-cyan-100">
                      <div className="text-2xl font-bold">{enrichedCount}</div>
                      <div className="text-xs text-muted-foreground">Enriched</div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-lg border border-purple-500/40 bg-purple-500/10 p-3 text-purple-100">
                      <div className="text-2xl font-bold">
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
              className="border border-slate-700/60 bg-slate-900 text-slate-200 hover:border-cyan-500/50 hover:text-cyan-100"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Start New Search
            </Button>
            <Button
              onClick={openLeadHistory}
              className="gap-2 border border-cyan-500/40 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
            >
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
            "rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 shadow-[inset_0_0_32px_rgba(0,255,132,0.12)]",
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
          className="border border-red-500/50 bg-red-500/10 text-red-200"
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
          className="border border-red-500/50 bg-red-500/10 text-red-200"
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
        <Alert className="border border-amber-500/50 bg-amber-500/10 text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-200" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-semibold text-amber-100">
                AI Analysis Service Degraded
              </div>
              <div className="text-sm text-amber-100/80">
                The LangGraph worker is experiencing issues. AI analysis may be slower than usual or encounter errors.
              </div>
              <div className="mt-1 text-xs text-amber-100/70">
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
                      isBusy
                        ? "bg-amber-400 animate-pulse"
                        : "bg-emerald-400",
                    )}
                  />
                  <span className="text-sm font-medium">
                    {isBusy ? "Processing..." : "Ready"}
                  </span>
                  {researchTierInfo && (
                    <Badge
                      variant="outline"
                      className={cn("ml-2", researchTierInfo.badgeClass)}
                    >
                      {React.createElement(researchTierInfo.icon, {
                        className: "w-3 h-3 mr-1",
                      })}
                      {researchTierInfo.label}
                    </Badge>
                  )}
                </div>

                {latestStatus && (
                  <Badge
                    variant="outline"
                    className="text-xs border border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  >
                    {latestStatus.title}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="flex items-center gap-3 rounded-xl border border-cyan-500/40 bg-slate-900/60 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
                    <Search className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-100">
                      {optimisticMetrics.discovered}
                    </div>
                    <div className="text-xs text-muted-foreground">Found</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-slate-900/60 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-100">
                      {optimisticMetrics.enriched}
                    </div>
                    <div className="text-xs text-muted-foreground">Contacts</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-purple-500/40 bg-slate-900/60 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-500/40 bg-purple-500/10 text-purple-200">
                    <Brain className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-slate-100">
                      {optimisticMetrics.analyzed}
                    </div>
                    <div className="text-xs text-muted-foreground">Created</div>
                  </div>
                </div>

                {search?.researchConfidence && (
                  <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-slate-900/60 p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-slate-100">
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
