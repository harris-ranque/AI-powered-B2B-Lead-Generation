import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { usePipeline } from "@/pipeline/context";
import { useLeads } from "@/hooks/useLeads";
import { useSearch } from "@/hooks/useSearches";
import { useSearchBroadcasts } from "@/hooks/useStatusBroadcasts";
import type { AnalysisBreakdown, AnalysisBroadcastData } from "@/types/analysis";
import {
  ExportReadinessBreakdown,
} from "./ExportReadinessBreakdown";
import {
  PenTool,
  CheckCircle,
  Clock,
  Sparkles,
  AlertTriangle,
  Brain,
  Bot,
  Mail,
} from "lucide-react";

function extractAnalysisBreakdown(
  broadcasts: Array<{ data?: unknown }>,
): AnalysisBreakdown | null {
  for (const broadcast of broadcasts) {
    if (!broadcast.data || typeof broadcast.data !== "object") continue;
    const breakdown = (broadcast.data as AnalysisBroadcastData).analysisBreakdown;
    if (breakdown) return breakdown;
  }
  return null;
}

function extractBroadcastActivity(
  broadcasts: Array<{ data?: unknown }>,
): { phase?: AnalysisBroadcastData["activityPhase"]; label?: string } {
  for (const broadcast of broadcasts) {
    if (!broadcast.data || typeof broadcast.data !== "object") continue;
    const data = broadcast.data as AnalysisBroadcastData;
    if (data.activityPhase || data.activityLabel) {
      return { phase: data.activityPhase, label: data.activityLabel };
    }
  }
  return {};
}

function extractBroadcastAnalyzedCount(
  broadcasts: Array<{ data?: unknown }>,
): number {
  for (const broadcast of broadcasts) {
    if (!broadcast.data || typeof broadcast.data !== "object") continue;
    const analyzed = (broadcast.data as AnalysisBroadcastData).progress?.analyzed;
    if (typeof analyzed === "number") return analyzed;
  }
  return 0;
}

function leadHasWrittenEmail(lead: {
  emailContent?: { subject?: string; body?: string };
  generatedEmails?: unknown[];
}): boolean {
  return Boolean(
    lead.emailContent?.subject?.trim() || lead.emailContent?.body?.trim(),
  );
}

export function AIPersonalizationStage() {
  const { state, markStageComplete, progressToNextStage } = usePipeline();
  const { toast } = useToast();
  const [isSkipping, setIsSkipping] = useState(false);
  const skipStuckContacts = useMutation(api.leads.mutations.skipStuckAnalysisContacts);
  const searchId = state.searchId as Id<"searches"> | undefined;
  const { leads: searchLeads, isLoading } = useLeads(searchId);
  const { search } = useSearch(searchId);
  const { broadcasts } = useSearchBroadcasts(searchId);

  const analysisProgress = useQuery(
    api.leads.queries.getAnalysisProgress,
    searchId ? { searchId } : "skip",
  );

  const acceptedContactCounts = useQuery(
    api.leads.queries.getAcceptedContactCountsBySearch,
    searchId ? { searchId } : "skip",
  );

  const leads = useMemo(() => {
    if (searchId && searchLeads && searchLeads.length > 0) {
      return searchLeads;
    }
    if (state.enrichedLeads.length > 0) {
      return state.enrichedLeads;
    }
    return searchLeads || [];
  }, [searchId, searchLeads, state.enrichedLeads]);

  const broadcastBreakdown = useMemo(
    () => extractAnalysisBreakdown(broadcasts),
    [broadcasts],
  );

  const broadcastAnalyzed = useMemo(
    () => extractBroadcastAnalyzedCount(broadcasts),
    [broadcasts],
  );

  const broadcastActivity = useMemo(
    () => extractBroadcastActivity(broadcasts),
    [broadcasts],
  );

  const totalToWrite = Math.max(
    analysisProgress?.total ?? 0,
    acceptedContactCounts?.totalAccepted ?? 0,
    leads.filter((lead) => lead.contactInfo?.emails?.length).length,
  );

  const emailsFromLeads = leads.filter((lead) => leadHasWrittenEmail(lead)).length;

  const emailsWritten = Math.max(
    emailsFromLeads,
    analysisProgress?.personalized ?? 0,
    search?.progress?.analyzed ?? 0,
    broadcastAnalyzed,
    broadcastBreakdown?.personalized ?? 0,
  );

  const analysisComplete =
    Boolean(analysisProgress?.isComplete) ||
    search?.status === "completed" ||
    (totalToWrite > 0 &&
      analysisProgress !== undefined &&
      analysisProgress.inProgress === 0 &&
      analysisProgress.pending === 0);

  const processingPercent =
    analysisProgress?.percentComplete ??
    broadcastBreakdown?.percentComplete ??
    (totalToWrite > 0
      ? Math.round(
          ((analysisProgress?.processed ??
            broadcastBreakdown?.completed ??
            emailsWritten) /
            totalToWrite) *
            100,
        )
      : 0);

  const writeEmailsPercent =
    totalToWrite > 0
      ? Math.min(100, (emailsWritten / totalToWrite) * 100)
      : 0;

  const recentPersonalized =
    analysisProgress?.recentPersonalized?.length > 0
      ? analysisProgress.recentPersonalized
      : leads
          .filter((lead) => leadHasWrittenEmail(lead))
          .slice(0, 5)
          .map((lead) => ({
            contactName:
              lead.contactInfo?.contacts?.[0]?.name ?? lead.businessName ?? "Contact",
            email:
              lead.primaryEmail ??
              lead.contactInfo?.emails?.[0]?.email ??
              "Email ready",
            businessName: lead.businessName,
            subject: lead.emailContent?.subject ?? "Email ready",
            relevanceScore: lead.aiAnalysis?.relevanceScore ?? null,
          }));

  useEffect(() => {
    if (
      analysisComplete &&
      totalToWrite > 0 &&
      !state.completedStages.includes("ai_personalization")
    ) {
      markStageComplete("ai_personalization");
    }
  }, [
    analysisComplete,
    totalToWrite,
    state.completedStages,
    markStageComplete,
  ]);

  useEffect(() => {
    if (
      state.currentStage === "ai_personalization" &&
      state.completedStages.includes("ai_personalization")
    ) {
      progressToNextStage();
    }
  }, [state.currentStage, state.completedStages, progressToNextStage]);

  if (isLoading && !analysisProgress) {
    return (
      <div className="text-center py-12">
        <Clock className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
        <p className="text-muted-foreground">Loading analysis status...</p>
      </div>
    );
  }

  if (totalToWrite === 0 && leads.length === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No contacts ready for email writing. Complete email discovery first.
        </AlertDescription>
      </Alert>
    );
  }

  const displayTotal = totalToWrite > 0 ? totalToWrite : leads.length;
  const scheduledCount = analysisProgress?.scheduled ?? 0;
  const processingCount = analysisProgress?.processing ?? 0;
  const workerCount = scheduledCount + processingCount;
  const inProgressCount =
    analysisProgress?.inProgress ??
    broadcastBreakdown?.inProgress ??
    0;
  const pendingCount =
    analysisProgress?.pending ?? broadcastBreakdown?.pending ?? 0;
  const stuckCount = analysisProgress?.stuckInProgress ?? 0;
  const awaitingWorkerStart =
    pendingCount > 0 && workerCount === 0 && !analysisComplete;

  const activityPhase = broadcastActivity.phase;
  const activityLabel = broadcastActivity.label;

  const biStatus =
    activityPhase === "researching"
      ? "active"
      : processingPercent > 0 || emailsWritten > 0
        ? "complete"
        : "pending";
  const emailGenStatus =
    activityPhase === "researching"
      ? "pending"
      : inProgressCount > 0 || activityPhase === "writing_email"
        ? "active"
        : emailsWritten > 0
          ? "complete"
          : "pending";
  const qaStatus = analysisComplete
    ? "complete"
    : inProgressCount > 0 && emailsWritten > 0
      ? "active"
      : "pending";

  const handleSkipStuck = async (olderThanMinutes: number) => {
    if (!searchId) return;
    setIsSkipping(true);
    try {
      const result = await skipStuckContacts({
        searchId,
        olderThanMinutes,
      });
      toast({
        title: "Contacts skipped",
        description:
          result.skippedCount > 0
            ? `Skipped ${result.skippedCount} contact(s). Export will use completed emails only.`
            : "No contacts matched the skip criteria.",
      });
    } catch (error) {
      toast({
        title: "Could not skip contacts",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSkipping(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="analysis-progress">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <PenTool className="h-5 w-5" />
          Write Emails
        </h3>
        <p className="text-muted-foreground">
          AI researches each business and writes personalized outreach emails
        </p>
      </div>

      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-semibold">Write Emails Progress</h4>
                <p className="text-sm text-muted-foreground">
                  {emailsWritten} of {displayTotal} contact emails written
                  {pendingCount > 0 && ` · ${pendingCount} queued`}
                  {scheduledCount > 0 && ` · ${scheduledCount} scheduled`}
                  {processingCount > 0 && ` · ${processingCount} in worker`}
                </p>
              </div>

              <Badge variant={analysisComplete ? "default" : "secondary"}>
                {writeEmailsPercent.toFixed(0)}% Complete
              </Badge>
            </div>

            {activityLabel && !analysisComplete && (
              <div className="flex items-center gap-2 text-sm text-primary">
                <Clock className="h-4 w-4 animate-spin" />
                <span>{activityLabel}</span>
              </div>
            )}

            <Progress value={writeEmailsPercent} className="h-3 progress-pulse" />
            <p className="text-xs text-muted-foreground">
              {processingPercent}% contacts finished (research + email + QA)
              {analysisProgress?.failed > 0 &&
                ` · ${analysisProgress.failed} failed`}
            </p>

            {acceptedContactCounts?.exportReadiness && (
              <ExportReadinessBreakdown
                readiness={acceptedContactCounts.exportReadiness}
                variant="compact"
              />
            )}

            {analysisComplete && (
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Email Writing Complete!</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!analysisComplete &&
        (stuckCount > 0 || workerCount > 0 || awaitingWorkerStart) && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-3">
            <p>
              Email writing runs on the LangGraph worker (~2–5 minutes per contact).
              {stuckCount > 0
                ? ` ${stuckCount} contact(s) look stuck (no update for 10+ minutes), often because the worker or ngrok tunnel went offline.`
                : workerCount > 0
                  ? ` ${workerCount} in the worker now${processingCount > 0 ? ` (${processingCount} actively writing)` : ""}.`
                  : awaitingWorkerStart
                    ? ` ${pendingCount} queued but not started yet — the system should schedule them automatically within a few minutes after email discovery finishes.`
                    : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {stuckCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSkipping}
                  onClick={() => handleSkipStuck(10)}
                >
                  Skip {stuckCount} stuck contact(s)
                </Button>
              )}
              {(workerCount > 0 || awaitingWorkerStart) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isSkipping}
                  onClick={() => handleSkipStuck(0)}
                >
                  Skip all {workerCount > 0 ? workerCount : pendingCount}{" "}
                  {workerCount > 0 ? "in progress" : "queued"}
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {[
          {
            name: "Business Research",
            icon: Brain,
            status: biStatus,
            description: "Perplexity company research",
          },
          {
            name: "Email Writing",
            icon: Sparkles,
            status: emailGenStatus,
            description: "OpenAI personalized draft",
          },
          {
            name: "Quality Check",
            icon: CheckCircle,
            status: qaStatus,
            description: "Validation & approval",
          },
        ].map((agent) => (
          <Card key={agent.name} className="glass-card">
            <CardContent className="p-4 text-center">
              <div
                className={`w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center ${
                  agent.status === "complete"
                    ? "bg-green-500/20 text-green-500"
                    : agent.status === "active"
                      ? "bg-primary/20 text-primary animate-pulse"
                      : "bg-muted/20 text-muted-foreground"
                }`}
              >
                {agent.status === "complete" ? (
                  <CheckCircle className="h-6 w-6" />
                ) : agent.status === "active" ? (
                  <Clock className="h-6 w-6 animate-spin" />
                ) : (
                  React.createElement(agent.icon, { className: "h-6 w-6" })
                )}
              </div>
              <div className="text-sm font-medium">{agent.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {agent.description}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Bot className="h-6 w-6 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold">{displayTotal}</div>
            <div className="text-sm text-muted-foreground">Contacts Queued</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Mail className="h-6 w-6 mx-auto mb-2 text-green-500" />
            <div className="text-2xl font-bold">{emailsWritten}</div>
            <div className="text-sm text-muted-foreground">Emails Written</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Clock className="h-6 w-6 mx-auto mb-2 text-blue-500" />
            <div className="text-2xl font-bold">{inProgressCount}</div>
            <div className="text-sm text-muted-foreground">Active / Queued</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <CheckCircle className="h-6 w-6 mx-auto mb-2 text-purple-500" />
            <div className="text-2xl font-bold">
              {analysisProgress?.failed ?? broadcastBreakdown?.failed ?? 0}
            </div>
            <div className="text-sm text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Recently Written Emails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentPersonalized.map((entry, index) => (
              <div
                key={`${entry.email}-${index}`}
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/10 transition-all duration-300 hover:bg-muted/20"
              >
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{entry.businessName}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {entry.subject}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {entry.contactName} · {entry.email}
                  </div>
                </div>

                {entry.relevanceScore != null && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    {(entry.relevanceScore * 100).toFixed(0)}% match
                  </Badge>
                )}
              </div>
            ))}

            {emailsWritten === 0 && !analysisComplete && (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="h-8 w-8 mx-auto mb-3 animate-pulse text-primary" />
                <p>Writing personalized emails...</p>
                <p className="text-sm">This usually takes a few minutes per contact</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
