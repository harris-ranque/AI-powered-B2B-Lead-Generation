import React, { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePipeline } from "@/pipeline/context";
import { useLeads } from "@/hooks/useLeads";
import { useSearch } from "@/hooks/useSearches";
import { useSearchBroadcasts } from "@/hooks/useStatusBroadcasts";
import type { EnrichmentBreakdown } from "@/types/enrichment";
import {
  Mail,
  CheckCircle,
  Clock,
  Building,
  Phone,
  Globe,
  AlertTriangle,
} from "lucide-react";

function getLeadDisplayName(lead: {
  businessName?: string;
  company_name?: string;
}): string {
  return lead.businessName || lead.company_name || "Unknown business";
}

function leadHasEmail(lead: {
  contactInfo?: { emails?: Array<{ email?: string }> };
  email?: string;
  primaryEmail?: string;
}): boolean {
  if (lead.primaryEmail?.trim()) return true;
  if (lead.email?.trim()) return true;
  return Boolean(
    lead.contactInfo?.emails?.some(
      (entry) => typeof entry?.email === "string" && entry.email.trim().length > 0,
    ),
  );
}

function extractEnrichmentBreakdown(
  broadcasts: Array<{ data?: unknown }>,
): EnrichmentBreakdown | null {
  for (const broadcast of broadcasts) {
    if (!broadcast.data || typeof broadcast.data !== "object") continue;
    const breakdown = (broadcast.data as { enrichmentBreakdown?: EnrichmentBreakdown })
      .enrichmentBreakdown;
    if (breakdown) return breakdown;
  }
  return null;
}

function extractBroadcastEnrichedCount(
  broadcasts: Array<{ data?: unknown }>,
): number {
  for (const broadcast of broadcasts) {
    if (!broadcast.data || typeof broadcast.data !== "object") continue;
    const enriched = (broadcast.data as { progress?: { enriched?: number } })
      .progress?.enriched;
    if (typeof enriched === "number") return enriched;
  }
  return 0;
}

export function EnrichmentStage() {
  const { state, markStageComplete, progressToNextStage, setEnrichedLeads } =
    usePipeline();
  const searchId = state.searchId as Id<"searches"> | undefined;
  const { leads: searchLeads, isLoading } = useLeads(searchId);
  const { search } = useSearch(searchId);
  const { broadcasts } = useSearchBroadcasts(searchId);

  const enrichmentProgress = useQuery(
    api.leads.queries.getEnrichmentProgress,
    searchId ? { searchId } : "skip",
  );

  const acceptedContactCounts = useQuery(
    api.leads.queries.getAcceptedContactCountsBySearch,
    searchId ? { searchId } : "skip",
  );

  // Prefer live Convex leads during enrichment — pipeline context leads are discovery-time snapshots.
  const leads = useMemo(() => {
    if (searchId && searchLeads && searchLeads.length > 0) {
      return searchLeads;
    }
    if (state.leads.length > 0) {
      return state.leads;
    }
    return searchLeads || [];
  }, [searchId, searchLeads, state.leads]);

  const broadcastBreakdown = useMemo(
    () => extractEnrichmentBreakdown(broadcasts),
    [broadcasts],
  );

  const broadcastEnriched = useMemo(
    () => extractBroadcastEnrichedCount(broadcasts),
    [broadcasts],
  );

  const leadsWithAcceptedContacts = Object.keys(
    acceptedContactCounts?.byLead ?? {},
  ).length;

  const totalBusinesses = Math.max(
    leads.length,
    enrichmentProgress?.total ?? 0,
    search?.progress?.total ?? 0,
    search?.progress?.discovered ?? 0,
    search?.results?.totalFound ?? 0,
  );

  const emailsFromLeads = leads.filter((lead) => leadHasEmail(lead)).length;

  const emailsFound = Math.max(
    emailsFromLeads,
    enrichmentProgress?.withEmail ?? 0,
    search?.progress?.enriched ?? 0,
    broadcastEnriched,
    broadcastBreakdown?.completed ?? 0,
    leadsWithAcceptedContacts,
  );

  const enrichmentComplete =
    enrichmentProgress?.isComplete ??
    (totalBusinesses > 0 &&
      enrichmentProgress !== undefined &&
      enrichmentProgress.pending === 0 &&
      enrichmentProgress.inProgress === 0);

  const processingPercent =
    enrichmentProgress?.percentComplete ??
    broadcastBreakdown?.percentComplete ??
    (totalBusinesses > 0
      ? Math.round(
          ((enrichmentProgress?.processed ??
            broadcastBreakdown
              ? broadcastBreakdown.completed + broadcastBreakdown.failed
              : emailsFound) /
            totalBusinesses) *
            100,
        )
      : 0);

  const emailDiscoveryPercent =
    totalBusinesses > 0
      ? Math.min(100, (emailsFound / totalBusinesses) * 100)
      : 0;

  // Mark enrichment complete when processing finishes
  useEffect(() => {
    if (
      enrichmentComplete &&
      leads.length > 0 &&
      !state.completedStages.includes("enrichment")
    ) {
      setEnrichedLeads(leads);
      markStageComplete("enrichment");
    }
  }, [
    enrichmentComplete,
    leads,
    state.completedStages,
    setEnrichedLeads,
    markStageComplete,
  ]);

  // Advance to Write Emails once enrichment is marked complete
  useEffect(() => {
    if (
      state.currentStage === "enrichment" &&
      state.completedStages.includes("enrichment")
    ) {
      progressToNextStage();
    }
  }, [state.currentStage, state.completedStages, progressToNextStage]);

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <Clock className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
        <p className="text-muted-foreground">Loading leads...</p>
      </div>
    );
  }

  if (leads.length === 0 && totalBusinesses === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No leads found. Please go back and adjust your search parameters.
        </AlertDescription>
      </Alert>
    );
  }

  const displayTotal = totalBusinesses > 0 ? totalBusinesses : leads.length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold flex items-center justify-center gap-2">
          <Mail className="h-5 w-5" />
          Getting Email Addresses
        </h3>
        <p className="text-muted-foreground">
          Finding decision-maker emails for each business
        </p>
      </div>

      {/* Progress Overview */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-semibold">Email Discovery Progress</h4>
                <p className="text-sm text-muted-foreground">
                  {emailsFound} of {displayTotal} emails found
                  {enrichmentProgress &&
                    enrichmentProgress.pending + enrichmentProgress.inProgress > 0 &&
                    ` · ${enrichmentProgress.pending + enrichmentProgress.inProgress} processing`}
                </p>
              </div>

              <Badge
                variant={enrichmentComplete ? "default" : "secondary"}
              >
                {emailDiscoveryPercent.toFixed(0)}% Complete
              </Badge>
            </div>

            <Progress
              value={emailDiscoveryPercent}
              className="h-3 progress-pulse"
            />
            <p className="text-xs text-muted-foreground">
              {processingPercent}% of businesses processed
              {enrichmentProgress &&
                enrichmentProgress.pending + enrichmentProgress.inProgress > 0 &&
                ` · ${enrichmentProgress.pending + enrichmentProgress.inProgress} still running`}
            </p>

            {enrichmentComplete && (
              <div className="flex items-center justify-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Email Discovery Complete!</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contact Stats */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Building className="h-6 w-6 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold">{displayTotal}</div>
            <div className="text-sm text-muted-foreground">Total Businesses</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Mail className="h-6 w-6 mx-auto mb-2 text-green-500" />
            <div className="text-2xl font-bold">{emailsFound}</div>
            <div className="text-sm text-muted-foreground">Email Addresses</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Phone className="h-6 w-6 mx-auto mb-2 text-blue-500" />
            <div className="text-2xl font-bold">
              {leads.filter((lead) => lead.phone).length}
            </div>
            <div className="text-sm text-muted-foreground">Phone Numbers</div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4 text-center">
            <Globe className="h-6 w-6 mx-auto mb-2 text-purple-500" />
            <div className="text-2xl font-bold">
              {leads.filter((lead) => lead.website).length}
            </div>
            <div className="text-sm text-muted-foreground">Websites</div>
          </CardContent>
        </Card>
      </div>

      {/* Recently Found Contacts Preview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Recently Found Emails</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {leads
              .filter((lead) => leadHasEmail(lead))
              .slice(0, 5)
              .map((lead) => (
                <div
                  key={lead._id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-muted/10 transition-all duration-300 hover:bg-muted/20"
                >
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {getLeadDisplayName(lead)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {lead.contactInfo?.emails?.[0]?.email ||
                        lead.primaryEmail ||
                        lead.email ||
                        "Email found"}
                    </div>
                  </div>

                  <div className="flex gap-1">
                    {lead.phone && (
                      <Badge variant="outline" className="text-xs">
                        <Phone className="h-3 w-3 mr-1" />
                        Phone
                      </Badge>
                    )}
                    {lead.website && (
                      <Badge variant="outline" className="text-xs">
                        <Globe className="h-3 w-3 mr-1" />
                        Website
                      </Badge>
                    )}
                  </div>
                </div>
              ))}

            {emailsFound === 0 && !enrichmentComplete && (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-3 animate-pulse text-primary" />
                <p>Finding emails...</p>
                <p className="text-sm">This may take a few minutes</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
