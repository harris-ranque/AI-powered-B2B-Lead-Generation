import React, { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Users,
} from "lucide-react";

type PeopleDiscoveryBroadcast = {
  totalLeads?: number;
  completedLeads?: number;
  businessesWithPeople?: number;
  totalProspects?: number;
  percentComplete?: number;
};

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
    const data = broadcast.data as {
      stage?: string;
      peopleDiscovery?: unknown;
      progress?: { enriched?: number };
    };
    if (data.stage === "people_discovery" || data.peopleDiscovery) continue;
    const enriched = data.progress?.enriched;
    if (typeof enriched === "number") return enriched;
  }
  return 0;
}

function extractPeopleDiscoveryBroadcast(
  broadcasts: Array<{ data?: unknown }>,
): PeopleDiscoveryBroadcast | null {
  for (const broadcast of broadcasts) {
    if (!broadcast.data || typeof broadcast.data !== "object") continue;
    const data = broadcast.data as {
      peopleDiscovery?: PeopleDiscoveryBroadcast;
    };
    if (data.peopleDiscovery) return data.peopleDiscovery;
  }
  return null;
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

  const peopleDiscoveryProgress = useQuery(
    api.leads.queries.getPeopleDiscoveryProgress,
    searchId ? { searchId } : "skip",
  );

  const peopleDiscoveryLogs = useQuery(
    api.leads.queries.getPeopleDiscoveryLogs,
    searchId ? { searchId, limit: 300 } : "skip",
  );

  const acceptedContactCounts = useQuery(
    api.leads.queries.getAcceptedContactCountsBySearch,
    searchId ? { searchId } : "skip",
  );

  // Prefer live Convex leads during enrichment — pipeline context leads are discovery-time snapshots.
  // Only fall back to state.leads when they belong to the current search (avoid stale data from
  // a prior search bleeding into the new search's progress display).
  const leads = useMemo(() => {
    if (searchId && searchLeads && searchLeads.length > 0) {
      return searchLeads;
    }
    if (
      state.leads.length > 0 &&
      state.leads.every(
        (l) => (l as { searchId?: string }).searchId === searchId,
      )
    ) {
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

  const broadcastPeopleDiscovery = useMemo(
    () => extractPeopleDiscoveryBroadcast(broadcasts),
    [broadcasts],
  );

  const leadsWithAcceptedContacts = Object.keys(
    acceptedContactCounts?.byLead ?? {},
  ).length;

  const peopleDiscoveryEnabled = peopleDiscoveryProgress?.enabled ?? true;

  const totalBusinesses = Math.max(
    search?.progress?.total ?? 0,
    search?.progress?.discovered ?? 0,
    search?.results?.totalFound ?? 0,
    !peopleDiscoveryEnabled ? enrichmentProgress?.total ?? 0 : 0,
    leads.every((l) => (l as { searchId?: string }).searchId === searchId)
      ? leads.length
      : 0,
  );

  const peopleDiscoveryComplete =
    peopleDiscoveryProgress?.isComplete ?? !peopleDiscoveryEnabled;

  const businessesScanned = Math.max(
    peopleDiscoveryProgress?.businessesProcessed ?? 0,
    broadcastPeopleDiscovery?.completedLeads ?? 0,
  );
  const peopleScanTotal = Math.max(
    peopleDiscoveryProgress?.totalBusinesses ?? 0,
    broadcastPeopleDiscovery?.totalLeads ?? 0,
    totalBusinesses,
  );
  const totalProspects = Math.max(
    peopleDiscoveryProgress?.totalProspects ?? 0,
    broadcastPeopleDiscovery?.totalProspects ?? 0,
  );
  const businessesWithPeople = Math.max(
    peopleDiscoveryProgress?.businessesWithPeople ?? 0,
    broadcastPeopleDiscovery?.businessesWithPeople ?? 0,
    enrichmentProgress?.businessesWithPeople ?? 0,
  );

  // Step 2 only runs email lookup for businesses that passed step 1 (had role-matched people).
  const emailLookupTotal = peopleDiscoveryEnabled
    ? Math.max(
        businessesWithPeople,
        enrichmentProgress?.businessesWithPeople ?? 0,
        enrichmentProgress?.peopleDiscoveryScoped
          ? enrichmentProgress.total
          : 0,
      )
    : totalBusinesses;
  const peopleScanPercent =
    peopleScanTotal > 0
      ? Math.min(
          100,
          Math.round((businessesScanned / peopleScanTotal) * 100),
        )
      : 0;

  // emailsFromLeads counts leads on THIS search that have emails on their row.
  // For repeat/linked searches (totalFound=0), skip this fallback entirely — all emails
  // come through leadContacts (leadsWithAcceptedContacts) instead of the lead row.
  const hasNativeLeads = (search?.results?.totalFound ?? 0) > 0;
  const emailsFromLeads = hasNativeLeads
    ? leads
        .filter(
          (l) =>
            (l as { searchId?: string }).searchId === searchId &&
            leadHasEmail(l),
        )
        .length
    : 0;

  // Use the backend-authoritative withEmail from enrichmentProgress as the primary
  // source when available — it already accounts for both native and linked leads.
  const emailsFound = enrichmentProgress !== undefined
    ? Math.max(
        enrichmentProgress.withEmail,
        leadsWithAcceptedContacts,
        broadcastBreakdown?.completed ?? 0,
      )
    : Math.max(
        emailsFromLeads,
        broadcastEnriched,
        broadcastBreakdown?.completed ?? 0,
        leadsWithAcceptedContacts,
      );

  const enrichmentComplete =
    peopleDiscoveryComplete &&
    (emailLookupTotal === 0 ||
      (enrichmentProgress?.isComplete ??
        (emailLookupTotal > 0 &&
          enrichmentProgress !== undefined &&
          enrichmentProgress.pending === 0 &&
          enrichmentProgress.inProgress === 0)));

  const emailProcessingPercent =
    enrichmentProgress?.percentComplete ??
    broadcastBreakdown?.percentComplete ??
    (emailLookupTotal > 0 && peopleDiscoveryComplete
      ? Math.round(
          ((enrichmentProgress?.processed ??
            broadcastBreakdown
              ? broadcastBreakdown.completed + broadcastBreakdown.failed
              : emailsFound) /
            emailLookupTotal) *
            100,
        )
      : 0);

  const emailDiscoveryPercent =
    emailLookupTotal > 0
      ? Math.min(100, (emailsFound / emailLookupTotal) * 100)
      : 0;

  const processingPercent = peopleDiscoveryComplete
    ? emailProcessingPercent
    : peopleScanPercent;

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
          Finding decision-makers on each website, then looking up their emails
        </p>
      </div>

      {peopleDiscoveryEnabled && (
        <Card className="glass-card">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    Step 1 — Find people on websites
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {businessesScanned} of {peopleScanTotal || displayTotal}{" "}
                    businesses scanned
                    {totalProspects > 0 &&
                      ` · ${totalProspects} people found (${businessesWithPeople} businesses)`}
                    {!peopleDiscoveryComplete &&
                      peopleScanTotal > businessesScanned &&
                      ` · ${peopleScanTotal - businessesScanned} remaining`}
                  </p>
                </div>
                <Badge
                  variant={peopleDiscoveryComplete ? "default" : "secondary"}
                >
                  {peopleDiscoveryComplete
                    ? "Complete"
                    : `${peopleScanPercent}%`}
                </Badge>
              </div>
              <Progress value={peopleScanPercent} className="h-2" />
              {!peopleDiscoveryComplete && (
                <p className="text-xs text-muted-foreground">
                  Scraping team pages and matching titles to your roles…
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {peopleDiscoveryEnabled && (
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">People Discovery Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64 pr-3">
              {peopleDiscoveryLogs && peopleDiscoveryLogs.length > 0 ? (
                <ol className="space-y-3 text-sm">
                  {peopleDiscoveryLogs.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-lg border border-border/60 bg-muted/10 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {entry.event.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleTimeString()}
                        </span>
                        {entry.businessName && (
                          <span className="font-medium truncate">
                            {entry.businessName}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground">{entry.message}</p>
                      {entry.people && entry.people.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {entry.people.map((person) => (
                            <li key={`${person.name}-${person.title}`}>
                              <span className="font-medium text-foreground">
                                {person.name}
                              </span>
                              <span className="text-muted-foreground">
                                {" "}
                                — {person.title}
                                {person.matchedRole
                                  ? ` (${person.matchedRole})`
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Clock className="h-4 w-4 animate-pulse" />
                  Waiting for people discovery events…
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Email discovery (step 2) */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="font-semibold flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  Step 2 — Find email addresses
                </h4>
                <p className="text-sm text-muted-foreground">
                  {!peopleDiscoveryComplete
                    ? "Waiting for people discovery to finish…"
                    : emailLookupTotal === 0
                      ? "No businesses had role-matched people from step 1"
                      : `${emailsFound} of ${emailLookupTotal} businesses with verified emails`}
                  {peopleDiscoveryComplete &&
                    emailLookupTotal > 0 &&
                    enrichmentProgress &&
                    enrichmentProgress.pending + enrichmentProgress.inProgress > 0 &&
                    ` · ${enrichmentProgress.pending + enrichmentProgress.inProgress} processing`}
                </p>
              </div>

              <Badge
                variant={
                  peopleDiscoveryComplete && enrichmentComplete
                    ? "default"
                    : "secondary"
                }
              >
                {peopleDiscoveryComplete
                  ? `${emailDiscoveryPercent.toFixed(0)}%`
                  : "Waiting"}
              </Badge>
            </div>

            <Progress
              value={peopleDiscoveryComplete ? emailDiscoveryPercent : 0}
              className="h-3 progress-pulse"
            />
            <p className="text-xs text-muted-foreground">
              {peopleDiscoveryComplete
                ? emailLookupTotal === 0
                  ? "Skipped — no businesses passed people discovery"
                  : `${processingPercent}% of passed businesses processed for email lookup`
                : "Email lookup starts after people are found on each website"}
              {peopleDiscoveryComplete &&
                emailLookupTotal > 0 &&
                enrichmentProgress &&
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
