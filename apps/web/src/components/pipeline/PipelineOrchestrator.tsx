import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePipeline } from "@/pipeline/context";
import type { Lead } from "@/lib/api-client";
import { STAGE_CONFIGS, STAGE_ORDER } from "@/pipeline/config";
import { PipelineStepper } from "./PipelineStepper";
import { SourceSelector } from "./SourceSelector";
import { LeadDiscoveryStage } from "./LeadDiscoveryStage";
import { EnrichmentStage } from "./EnrichmentStage";
import { AIAnalysisStage } from "./AIAnalysisStage";
import { EmailGenerationStage } from "./EmailGenerationStage";
import { ReviewExportStage } from "./ReviewExportStage";
import { SearchProgressTracker } from "../SearchProgressTracker";
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

interface PipelineOrchestratorProps {
  userCredits: number;
  userPlan: "free" | "pro" | "enterprise";
  onGenerateEmail?: (lead: Lead) => void;
}

export function PipelineOrchestrator({
  userCredits,
  userPlan,
  onGenerateEmail,
}: PipelineOrchestratorProps) {
  const { state, setStage } = usePipeline();
  const [isPipelineCollapsed, setIsPipelineCollapsed] = useState(false);

  // Get search data and real-time updates
  const { search } = useSearch(state.searchId || undefined);
  const { broadcasts, latestStatus } = useSearchBroadcasts(
    state.searchId || undefined,
  );

  // Get system status and configuration for health checks
  const { systemStatus, systemConfiguration } = useAdminSystemControl();

  // Check if search is completed
  const isSearchCompleted = search?.status === "completed";

  const currentStageIndex = STAGE_ORDER.indexOf(state.currentStage);
  const progressPercentage =
    (currentStageIndex / (STAGE_ORDER.length - 1)) * 100;

  // Compute processing state from backend + local state
  const isBusy =
    state.isProcessing ||
    search?.status === "in_progress" ||
    search?.status === "processing";

  // Get research tier display info
  const getResearchTierInfo = (tier?: string) => {
    switch (tier) {
      case "tavily":
        return {
          label: "Standard Research",
          icon: Search,
          color: "text-blue-500",
          bg: "bg-blue-50",
          description: "Fast business context (2-3s)",
        };
      case "exa":
        return {
          label: "Enhanced Research",
          icon: Brain,
          color: "text-purple-500",
          bg: "bg-purple-50",
          description: "Deep competitor analysis (3-4s)",
        };
      case "perplexity":
        return {
          label: "Premium Research",
          icon: Zap,
          color: "text-amber-600",
          bg: "bg-amber-50",
          description: "Comprehensive report (10-15s)",
        };
      default:
        return null;
    }
  };

  const researchTierInfo = getResearchTierInfo(search?.researchTier);

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
      case "ai_analysis":
        return <AIAnalysisStage />;
      case "email_generation":
        return <EmailGenerationStage onGenerateEmail={onGenerateEmail} />;
      case "review_export":
        return <ReviewExportStage />;
      default:
        return <SourceSelector />;
    }
  };

  return (
    <div className="space-y-6">
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
            <Badge variant="secondary" className="bg-green-100 text-green-800">
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

        {/* Overall Progress */}
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Pipeline Progress</span>
                  <span className="text-sm text-muted-foreground">
                    {state.completedStages.length} of {STAGE_ORDER.length}{" "}
                    stages
                  </span>
                </div>
                <Progress value={progressPercentage} className="h-2" />
              </div>

              {isBusy && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <Clock className="h-4 w-4 animate-spin" />
                  Processing...
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Completion UI */}
        {isSearchCompleted && (
          <Card className="glass-card border-green-200 bg-green-50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                    <CheckCircle className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-green-900">
                      Search Completed!
                    </h3>
                    <p className="text-sm text-green-700">
                      Found {search.results?.totalFound || 0} leads, enriched{" "}
                      {search.results?.enrichedCount || 0}, analyzed{" "}
                      {search.results?.analyzedCount || 0}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setStage("source_selection");
                      setIsPipelineCollapsed(false);
                    }}
                    className="gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Start Over
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => {
                      window.location.hash = "#lead-history";
                      setIsPipelineCollapsed(true);
                    }}
                    className="gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    View Results
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* System Status Warning */}
      {systemStatus?.leadGenerationPaused && (
        <Alert variant="destructive" className="border-red-500 bg-red-50">
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
        <Alert variant="destructive" className="border-red-500 bg-red-50">
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
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription>
            <div className="space-y-1">
              <div className="font-semibold text-yellow-900">
                AI Analysis Service Degraded
              </div>
              <div className="text-sm text-yellow-800">
                The LangGraph worker is experiencing issues. AI analysis may be slower than usual or encounter errors.
              </div>
              <div className="text-xs text-yellow-700 mt-1">
                {systemConfiguration.orchestrationSettings.langGraphHealth.consecutiveFailures} consecutive failures detected
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Pipeline Content - Hide when collapsed */}
      {!(isSearchCompleted && isPipelineCollapsed) && (
        <>
          {/* Pipeline Stepper */}
          <PipelineStepper />

          {/* Current Stage Content */}
          <div
            className={cn(
              "transition-all duration-500 ease-in-out",
              (isBusy || systemStatus?.leadGenerationPaused) &&
                "opacity-75 pointer-events-none",
            )}
          >
            {renderStageContent()}
          </div>
        </>
      )}

      {/* Real-Time Research Progress - Hide when collapsed */}
      {state.searchId && search && !(isSearchCompleted && isPipelineCollapsed) && (
        <SearchProgressTracker
          searchId={state.searchId}
          compact={false}
          showHistory={true}
          className="mb-6"
        />
      )}

      {/* Enhanced Pipeline Status - Hide when collapsed */}
      {!(isSearchCompleted && isPipelineCollapsed) && (
        <Card className="glass-card">
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Status Header */}
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
                    className={cn("ml-2", researchTierInfo.bg)}
                  >
                    {React.createElement(researchTierInfo.icon, {
                      className: "w-3 h-3 mr-1",
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

            {/* Real-Time Progress Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Discovered Leads */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Search className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <div className="text-lg font-semibold">
                    {search?.progress?.discovered || state.leads.length || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Discovered
                  </div>
                </div>
              </div>

              {/* Enriched Leads */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <Users className="h-4 w-4 text-green-500" />
                </div>
                <div>
                  <div className="text-lg font-semibold">
                    {search?.progress?.enriched ||
                      state.enrichedLeads.length ||
                      0}
                  </div>
                  <div className="text-xs text-muted-foreground">Enriched</div>
                </div>
              </div>

              {/* AI Analyzed */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Brain className="h-4 w-4 text-purple-500" />
                </div>
                <div>
                  <div className="text-lg font-semibold">
                    {search?.progress?.analyzed || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Analyzed</div>
                </div>
              </div>

              {/* Research Quality */}
              {search?.researchConfidence && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {Math.round(search.researchConfidence * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Confidence
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Research Progress Indicator */}
            {search?.researchStage && (
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Research Progress
                  </span>
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
  );
}
