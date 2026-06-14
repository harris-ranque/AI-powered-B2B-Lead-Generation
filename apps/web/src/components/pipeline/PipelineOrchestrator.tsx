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
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/pipeline/types";
import type { Id } from "@genni/convex-types/dataModel";
import { SearchSwitcher } from "./SearchSwitcher";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import { useSearch, useSearches } from "@/hooks/useSearches";
import { useLeads } from "@/hooks/useLeads";
import { useSearchBroadcasts } from "@/hooks/useStatusBroadcasts";
import { useAdminSystemControl } from "@/hooks/useAdmin";
import { SourceRegistry } from "@/pipeline/sources/SourceRegistry";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { PipelineProgressProvider } from "@/contexts/PipelineProgressContext";
import { PipelineProgressPanel } from "@/components/PipelineProgressPanel";
import { featureFlags } from "@/lib/featureFlags";
import { useAnalytics } from "@/hooks/useAnalytics";

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
  const { state, setStage, canProgressToStage, setLeads, setEnrichedLeads, resetPipeline, setSearchId, markStageComplete } =
    usePipeline();
  const [isPipelineCollapsed, setIsPipelineCollapsed] = useState(false);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const lastCompletedSearchIdRef = useRef<string | null>(null);
  const { toast } = useToast();
  const analytics = useAnalytics();

  // Get search data and real-time updates
  const { search } = useSearch(state.searchId || undefined);
  const { searches, cancelSearch } = useSearches();
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
  const contactCounts = useQuery(
    api.leads.queries.getAcceptedContactCountsBySearch,
    featureFlags.multiContactPipeline && activeSearchId
      ? { searchId: activeSearchId as Id<"searches"> }
      : "skip",
  );
  const acceptedContactCount = featureFlags.multiContactPipeline
    ? (contactCounts?.totalAccepted ?? enrichedCount)
    : enrichedCount;

  // Live exportable count — used in completion dialog so old searches without
  // results.exportableCount stored still show the accurate verified-email count.
  const completionSearchIds = activeSearchId ? [activeSearchId as Id<"searches">] : [];
  const liveExportableCounts = useQuery(
    api.leads.queries.getExportSummariesBySearchIds,
    completionSearchIds.length > 0 ? { searchIds: completionSearchIds } : "skip",
  );
  const exportSummary = liveExportableCounts?.[String(activeSearchId)];
  const exportableCount =
    exportSummary?.exportableContacts ??
    (featureFlags.multiContactPipeline
      ? (contactCounts?.totalExportableIncludingPrior ??
          contactCounts?.totalExportable ??
          search?.results?.exportableCount)
      : search?.results?.exportableCount) ??
    enrichedCount;
  const exportableBusinessCount = exportSummary?.exportableBusinesses;

  const duplicateSkipCount =
    (search?.duplicatesFilteredPlaceId ?? 0) +
    (search?.duplicatesFilteredAddress ?? 0) +
    (search?.duplicatesFilteredPlaceName ?? 0) +
    (search?.duplicatesFilteredEmail ?? 0);
  const priorSearchExportable = contactCounts?.duplicateFallbackExportable ?? 0;
  const isRepeatSearchNoNewLeads =
    totalFound === 0 && duplicateSkipCount > 0;

  const openLeadHistory = useCallback(() => {
    setShowCompletionDialog(false);
    if (onOpenLeadHistory) {
      onOpenLeadHistory();
    } else {
      window.location.hash = "#lead-history";
    }

    setIsPipelineCollapsed(true);
  }, [onOpenLeadHistory, setIsPipelineCollapsed]);

  const handleNewSearch = useCallback(() => {
    resetPipeline();
    setIsPipelineCollapsed(false);
    setShowCompletionDialog(false);
  }, [resetPipeline]);

  const handleSwitchSearch = useCallback(
    (searchId: Id<"searches">, status: string) => {
      if (searchId === state.searchId) return;

      resetPipeline();
      setSearchId(searchId);

      const stagesToMark: Record<string, { complete: PipelineStage[]; goTo: PipelineStage }> = {
        completed: {
          complete: ["source_selection", "lead_discovery", "enrichment", "ai_personalization"],
          goTo: "review_export",
        },
        in_progress: {
          complete: ["source_selection", "lead_discovery"],
          goTo: "enrichment",
        },
        processing: {
          complete: ["source_selection", "lead_discovery"],
          goTo: "enrichment",
        },
        pending: {
          complete: ["source_selection"],
          goTo: "lead_discovery",
        },
        failed: {
          complete: ["source_selection", "lead_discovery"],
          goTo: "review_export",
        },
        cancelled: {
          complete: ["source_selection", "lead_discovery"],
          goTo: "review_export",
        },
      };

      const mapping = stagesToMark[status] ?? stagesToMark.pending;
      for (const stage of mapping.complete) {
        markStageComplete(stage);
      }
      setStage(mapping.goTo);
      setIsPipelineCollapsed(false);
      setShowCompletionDialog(false);
    },
    [state.searchId, resetPipeline, setSearchId, markStageComplete, setStage],
  );

  const currentStageIndex = STAGE_ORDER.indexOf(state.currentStage);

  const availableStages = STAGE_ORDER.filter((stageId) =>
    canProgressToStage(stageId),
  );

  const selectedSource = state.selectedSource
    ? SourceRegistry.getSource(state.selectedSource)
    : undefined;

  const { leads: searchLeads, isLoading: leadsLoading } = useLeads(state.searchId || undefined);

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
    const enrichmentDataChanged = state.leads.some((lead, index) => {
      const serverLead = searchLeads[index];
      if (!serverLead || lead._id !== serverLead._id) return false;
      const localEmails = lead.contactInfo?.emails?.length ?? 0;
      const serverEmails = serverLead.contactInfo?.emails?.length ?? 0;
      return (
        lead.enrichmentStatus !== serverLead.enrichmentStatus ||
        localEmails !== serverEmails ||
        lead.primaryEmail !== serverLead.primaryEmail
      );
    });

    if (hasDifferentLead || enrichmentDataChanged) {
      setLeads(searchLeads);
    }

    const enriched = searchLeads.filter(
      (lead) =>
        lead.primaryEmail ||
        (lead.contactInfo?.emails && lead.contactInfo.emails.length > 0),
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

  const handleStageAdvance = useCallback(
    (stage: PipelineStage) => {
      const targetIndex = STAGE_ORDER.indexOf(stage);
      if (targetIndex > 0) {
        for (let i = 0; i < targetIndex; i++) {
          markStageComplete(STAGE_ORDER[i]);
        }
      }
      setStage(stage);
    },
    [markStageComplete, setStage],
  );

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
          "border border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-200",
        description: "Fast business context (2-3s)",
      };
    case "perplexity":
      return {
        label: "Deep Research",
        icon: Zap,
        badgeClass:
          "border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
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

      // Track search completion in analytics
      analytics.trackSearchCompleted({
        search_id: activeSearchId,
        total_leads: totalFound,
        enriched_count: enrichedCount,
        research_tier: search?.researchTier,
      });

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

  const handleCancelSearch = useCallback(async () => {
    if (!activeSearchId) return;

    try {
      await cancelSearch({ searchId: activeSearchId });

      // Track search cancellation in analytics
      analytics.trackSearchCancelled({
        search_id: activeSearchId,
        total_leads: totalFound,
        enriched_count: enrichedCount,
      });

      toast({
        title: "Search cancelled",
        description: "The search has been stopped successfully.",
      });
    } catch (error) {
      console.error("Failed to cancel search:", error);
      toast({
        title: "Failed to cancel",
        description: "Could not cancel the search. Please try again.",
        variant: "destructive",
      });
    }
  }, [activeSearchId, cancelSearch, toast, analytics, totalFound, enrichedCount]);

  const unifiedPanelActions = useMemo(() => {
    if (isSearchCompleted) {
      return (
        <Button size="sm" variant="outline" onClick={openLeadHistory} className="gap-2">
          <FileText className="h-4 w-4" />
          View results
        </Button>
      );
    }

    if (isBusy && activeSearchId) {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={handleCancelSearch}
          className="gap-2 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-600"
        >
          <X className="h-4 w-4" />
          Cancel
        </Button>
      );
    }

    return undefined;
  }, [isSearchCompleted, isBusy, activeSearchId, openLeadHistory, handleCancelSearch]);

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

  // "Personalized" = leads that actually have AI-written email content.
  // More accurate than progress?.analyzed (counts all analysis attempts including failures)
  // and more accurate than exportableCount (doesn't require emailContent to exist).
  const personalizedFromLeads = useMemo(() => {
    if (!leadsFromPipeline?.length) return 0;
    return leadsFromPipeline.filter(
      (lead) => lead.contactInfo?.emails?.length && lead.emailContent,
    ).length;
  }, [leadsFromPipeline]);

  const optimisticMetrics = useMemo(() => {
    const discoveredMetric = Math.max(
      discoveredFromSearch,
      leadsFromPipeline?.length ?? 0,
    );
    const enrichedMetric = Math.max(
      featureFlags.multiContactPipeline ? acceptedContactCount : 0,
      enrichedFromSearch,
      enrichedFromLeads,
      state.enrichedLeads.length,
    );
    // When leads are loaded from DB: use the accurate count directly (leads with email + emailContent).
    // Don't Math.max against state/progress counters — they can include failed attempts.
    // leadsLoading === true means the query is still in-flight; 0 could mean "not loaded yet" rather
    // than "none personalized." Use the progress counter only while loading.
    const analyzedMetric = leadsLoading
      ? Math.max(analyzedFromSearch, state.generatedEmails.length)
      : personalizedFromLeads;
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
    leadsLoading,
    leadsFromPipeline?.length,
    personalizedFromLeads,
    search?.progress?.total,
    search?.results?.totalFound,
    state.enrichedLeads.length,
    state.generatedEmails.length,
    acceptedContactCount,
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
        return <AIPersonalizationStage />;
      case "review_export":
        return <ReviewExportStage onViewResults={openLeadHistory} />;
      default:
        return <SourceSelector />;
    }
  };

  const interactiveStageContent = shouldHideInteractiveSections
    ? null
    : (
        <div
          className={cn(
            "transition-all duration-500 ease-in-out",
            (isBusy || systemStatus?.leadGenerationPaused) &&
              "opacity-75 pointer-events-none",
          )}
        >
          {renderStageContent()}
        </div>
      );

  return (
    <>
      {/* Search Completion Dialog */}
      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="sm:max-w-md border border-border bg-card shadow-[0_24px_48px_-24px_hsl(var(--shadow-glow))]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary shadow-[0_8px_16px_-8px_hsl(var(--primary-glow))]">
                <CheckCircle className="h-6 w-6" />
              </div>
              <DialogTitle className="text-2xl">Search Complete!</DialogTitle>
            </div>
            <DialogDescription asChild>
              <div className="text-base pt-2 text-muted-foreground">
                {totalFound > 0 ? (
                  <div className="space-y-2">
                    <p className="font-medium text-foreground">
                      Great news! We found and processed your leads.
                    </p>
                    <div className="grid grid-cols-3 gap-3 pt-3">
                      <div className="flex flex-col items-center justify-center rounded-lg border border-primary/40 bg-primary/5 p-3 transition-all hover:border-primary/60 hover:bg-primary/10">
                        <div className="text-2xl font-bold text-foreground">{totalFound}</div>
                        <div className="text-xs font-medium text-muted-foreground">Found</div>
                      </div>
                      <div className="flex flex-col items-center justify-center rounded-lg border border-accent/40 bg-accent/5 p-3 transition-all hover:border-accent/60 hover:bg-accent/10">
                        <div className="text-2xl font-bold text-foreground">
                          {featureFlags.multiContactPipeline
                            ? acceptedContactCount
                            : enrichedCount}
                        </div>
                        <div className="text-xs font-medium text-muted-foreground">
                          {featureFlags.multiContactPipeline
                            ? "Accepted Contacts"
                            : "Contacts Found"}
                        </div>
                      </div>
                      <div className="flex flex-col items-center justify-center rounded-lg border border-ring/40 bg-ring/5 p-3 transition-all hover:border-ring/60 hover:bg-ring/10">
                        <div className="text-2xl font-bold text-foreground">
                          {exportableCount}
                        </div>
                        <div className="text-xs font-medium text-muted-foreground">
                          {featureFlags.multiContactPipeline
                            ? "Exportable Contacts"
                            : "Analyzed"}
                        </div>
                        {featureFlags.multiContactPipeline &&
                          exportableBusinessCount != null &&
                          exportableBusinessCount > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              {exportableBusinessCount} businesses
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                ) : isRepeatSearchNoNewLeads ? (
                  <div className="space-y-3">
                    <p className="font-medium text-foreground">
                      No new businesses were added for this search.
                    </p>
                    <p>
                      {duplicateSkipCount.toLocaleString()} businesses were already in
                      your account from prior searches in this area (deduplication).
                    </p>
                    {priorSearchExportable > 0 ? (
                      <p>
                        {priorSearchExportable.toLocaleString()} exportable contact
                        {priorSearchExportable === 1 ? "" : "s"} from those prior
                        results can still be downloaded — use{" "}
                        <span className="font-medium text-foreground">Export CSV</span>{" "}
                        in review or search history.
                      </p>
                    ) : (
                      <p>
                        Export CSV will include contacts from prior searches when they
                        become available. Open an earlier search that discovered these
                        businesses for full results.
                      </p>
                    )}
                  </div>
                ) : (
                  <p>Your search has finished. Review the results in search history.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={handleNewSearch}
              className="border border-border hover:bg-secondary"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Start New Search
            </Button>
            <Button
              onClick={openLeadHistory}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_8px_16px_-8px_hsl(var(--primary-glow))]"
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

      {/* Search Switcher */}
      <SearchSwitcher
        searches={searches}
        activeSearchId={state.searchId}
        onSelectSearch={handleSwitchSearch}
        onNewSearch={handleNewSearch}
      />

      {/* System Status Warning */}
      {systemStatus?.leadGenerationPaused && (
        <Alert
          variant="destructive"
          className="border border-red-300 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200"
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
          className="border border-red-300 bg-red-50 text-red-900 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200"
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
        <Alert className="border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-200" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-semibold text-amber-900 dark:text-amber-100">
                AI Analysis Service Degraded
              </div>
              <div className="text-sm text-amber-800 dark:text-amber-100/80">
                The LangGraph worker is experiencing issues. AI analysis may be slower than usual or encounter errors.
              </div>
              <div className="mt-1 text-xs text-amber-700 dark:text-amber-100/70">
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
          onStageAdvance={handleStageAdvance}
          onStageSelect={handleStageSelect}
          collapsed={isPipelineCollapsed}
          onCollapseChange={setIsPipelineCollapsed}
        >
          <PipelineProgressPanel
            inlinePanel={trackerInlineContent}
            actions={unifiedPanelActions}
            stageContent={interactiveStageContent}
          />
        </PipelineProgressProvider>
      ) : (
        <>
          <StageTracker
            current={state.currentStage}
            completed={state.completedStages}
            available={availableStages}
            index={currentStageIndex + 1}
            total={STAGE_ORDER.length}
            inlinePanel={trackerInlineContent}
            onStageClick={handleStageSelect}
          />
          {interactiveStageContent}
        </>
      )}

      </div>
    </>
  );
}
