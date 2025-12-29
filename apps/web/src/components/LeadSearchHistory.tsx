import { useMemo, useState } from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import type { Doc } from "@genni/convex-types/dataModel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSearches } from "@/hooks/useSearches";
import { useAuth } from "@/hooks/useAuth";
import {
  Calendar,
  MapPin,
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  Target,
  Users,
  TrendingUp,
  Clock,
  Filter,
  AlertCircle,
  DollarSign,
  Zap,
  BarChart3,
  Crown,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PushToInstantlyButton } from "./instantly/PushToInstantlyButton";

export function LeadSearchHistory() {
  const { searches, isLoading } = useSearches();
  const { user } = useAuth();
  const { getToken: getClerkToken } = useClerkAuth();
  const { toast } = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expandedSearchId, setExpandedSearchId] = useState<string | null>(null);

  // Check if Instantly is configured
  const userApiKeys = useQuery(api.userApiKeys.queries.getUserApiKeys);
  const instantlyKey = userApiKeys?.find((key) => key.provider === "instantly");
  const isInstantlyConfigured = instantlyKey?.validated ?? false;

  const items = useMemo<Doc<"searches">[]>(() => searches ?? [], [searches]);

  const formatStatus = (status: string) => {
    return status
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const formatDuration = (startedAt?: number, completedAt?: number) => {
    if (!startedAt || !completedAt) return null;
    const durationMs = completedAt - startedAt;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  };

  const formatRadius = (radiusMeters: number) => {
    const km = radiusMeters / 1000;
    if (km < 1) {
      return `${radiusMeters}m`;
    }
    return `${km.toFixed(1)}km`;
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "default";
      case "failed":
      case "cancelled":
        return "destructive";
      case "in_progress":
      case "processing":
        return "secondary";
      default:
        return "outline";
    }
  };

  const isEnterpriseUser = user?.plan === "enterprise";

  const startCsvDownload = async (searchId: string) => {
    try {
      if (!user?._id) throw new Error("Not authenticated");

      const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
      if (!convexUrl) throw new Error("Convex URL not configured");

      let baseUrl: string = convexUrl;
      try {
        const url = new URL(convexUrl);
        if (url.hostname.endsWith(".convex.cloud")) {
          baseUrl = convexUrl.replace(".convex.cloud", ".convex.site");
        }
      } catch {
        // use as-is
      }

      if (!getClerkToken) {
        throw new Error("Unable to access session token");
      }

      const authToken =
        (await getClerkToken({ template: "convex" })) ||
        (await getClerkToken());
      if (!authToken) {
        throw new Error("Unable to obtain session token");
      }

      const tokenResponse = await fetch(`${baseUrl}/api/exports/issue-token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to request export token");
      }

      const tokenBody = (await tokenResponse.json()) as { token?: string };
      if (!tokenBody?.token) {
        throw new Error("Invalid export token response");
      }

      const params = new URLSearchParams();
      params.set("userId", user._id);
      params.set("token", tokenBody.token);
      params.set("searchId", searchId);

      const exportUrl = `${baseUrl}/api/exports/leads.csv?${params.toString()}`;

      setDownloadingId(searchId);
      const res = await fetch(exportUrl, { method: "GET" });
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `leads-export-${searchId}-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({ title: "Export Complete", description: "CSV download started." });
    } catch (err) {
      console.error("CSV export error", err);
      toast({
        title: "Export Failed",
        description: "Could not download CSV. Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading search history...
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="search-history">
      {items.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="no-results-message">
          No searches yet. Run a new lead search to see history here.
        </Card>
      ) : (
        items.map((s: Doc<"searches">) => {
          const isExpanded = expandedSearchId === String(s._id);
          const duration = formatDuration(s.startedAt, s.completedAt);
          const enrichmentRate =
            s.results?.totalFound && s.results.totalFound > 0
              ? Math.round(
                  ((s.results.enrichedCount || 0) / s.results.totalFound) * 100
                )
              : 0;
          const analysisRate =
            s.results?.totalFound && s.results.totalFound > 0
              ? Math.round(
                  ((s.results.analyzedCount || 0) / s.results.totalFound) * 100
                )
              : 0;

          const hasRadiusExpansion =
            s.initialSearchRadius && s.finalSearchRadius &&
            s.finalSearchRadius > s.initialSearchRadius;

          const totalDuplicates =
            (s.duplicatesFilteredPlaceName || 0) +
            (s.duplicatesFilteredEmail || 0) +
            (s.duplicatesFilteredAddress || 0) +
            (s.duplicatesFilteredPlaceId || 0);

          return (
            <Card key={String(s._id)} className="overflow-hidden" data-testid="search-history-item">
              {/* Tier 1: Always Visible */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-base font-medium">
                        {s.name || "Lead Search"}
                      </div>
                      <Badge
                        variant={getStatusBadgeVariant(s.status)}
                        className="text-xs"
                      >
                        {formatStatus(s.status)}
                      </Badge>
                      {isEnterpriseUser && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Crown className="h-3 w-3" />
                          Enterprise
                        </Badge>
                      )}
                    </div>

                    {/* Primary Details Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                      {/* Location & Radius */}
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">
                            {s.parameters?.location || "—"}
                          </span>
                          <span>
                            {s.parameters?.radius || 0} mi radius •{" "}
                            {s.parameters?.maxResults || 0} target
                          </span>
                        </div>
                      </div>

                      {/* Keywords & Roles */}
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <Target className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <div className="flex flex-col gap-0.5">
                          {s.parameters?.roles &&
                          s.parameters.roles.length > 0 ? (
                            <span className="font-medium text-foreground">
                              {s.parameters.roles.join(", ")}
                            </span>
                          ) : null}
                          {s.parameters?.keywords &&
                          s.parameters.keywords.length > 0 ? (
                            <span>
                              Keywords: {s.parameters.keywords.join(", ")}
                            </span>
                          ) : (
                            <span>No keywords</span>
                          )}
                        </div>
                      </div>

                      {/* Results & Quality */}
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <BarChart3 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground" data-testid="results-count">
                            {s.results?.totalFound ?? 0} leads found
                          </span>
                          <span>
                            {enrichmentRate}% with contacts • {analysisRate}%
                            analyzed
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Credits & Duration Row */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      {!isEnterpriseUser ? (
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span>
                            <span className="font-medium text-foreground">
                              {s.creditsUsed}
                            </span>{" "}
                            credits
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Crown className="h-3.5 w-3.5 text-yellow-600" />
                          <span className="font-medium text-foreground">
                            Enterprise Plan
                          </span>
                        </div>
                      )}

                      {duration && (
                        <div className="flex items-center gap-1.5" data-testid="total-duration">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{duration}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          {s.createdAt
                            ? new Date(s.createdAt).toLocaleString()
                            : ""}
                        </span>
                      </div>
                    </div>

                    {/* Warnings/Alerts */}
                    {s.partialResults && (
                      <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/20 p-2 rounded-md">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="font-medium">Partial Results:</span>{" "}
                          {s.discoveryMetadata?.expansionMessage ||
                            "Search area exhausted before reaching target"}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Export CSV Button */}
                    <Button
                      data-testid="export-csv-button"
                      size="sm"
                      variant="outline"
                      onClick={() => startCsvDownload(String(s._id))}
                      disabled={
                        downloadingId === String(s._id) ||
                        s.status !== "completed" ||
                        (s.results?.totalFound ?? 0) === 0
                      }
                    >
                      {downloadingId === String(s._id) ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Preparing...
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export
                        </>
                      )}
                    </Button>

                    {/* Push to Instantly - Show disabled button if not configured */}
                    {isInstantlyConfigured ? (
                      <PushToInstantlyButton
                        searchId={s._id}
                        searchName={s.name}
                        status={s.status}
                        totalLeads={s.results?.totalFound ?? 0}
                        analyzedCount={s.results?.analyzedCount ?? 0}
                        enrichedCount={s.results?.enrichedCount ?? 0}
                      />
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled
                        className="gap-2 opacity-50"
                        title="Configure Instantly API key in Settings"
                      >
                        <Send className="h-4 w-4" />
                        Push to Instantly
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setExpandedSearchId(isExpanded ? null : String(s._id))
                      }
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Tier 2 & 3: Expandable Details */}
              {isExpanded && (
                <div className="border-t bg-muted/30 p-4 space-y-4">
                  {/* Tier 2: Detailed Parameters */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      Search Parameters
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Industries */}
                      {s.parameters?.industries &&
                        s.parameters.industries.length > 0 && (
                          <div className="space-y-1">
                            <div className="font-medium text-muted-foreground">
                              Industries
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {s.parameters.industries.map((ind, idx) => (
                                <Badge key={idx} variant="secondary">
                                  {ind}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Exclude Terms */}
                      {s.parameters?.excludeTerms &&
                        s.parameters.excludeTerms.length > 0 && (
                          <div className="space-y-1">
                            <div className="font-medium text-muted-foreground">
                              Excluded Terms
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {s.parameters.excludeTerms.map((term, idx) => (
                                <Badge key={idx} variant="outline">
                                  {term}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                      {/* Rating Filter */}
                      {s.parameters?.minRating && (
                        <div className="space-y-1">
                          <div className="font-medium text-muted-foreground">
                            Minimum Rating
                          </div>
                          <div className="text-foreground">
                            ⭐ {s.parameters.minRating.toFixed(1)}+
                          </div>
                        </div>
                      )}

                      {/* Deduplication Settings */}
                      {s.parameters?.deduplication && (
                        <div className="space-y-1 col-span-full">
                          <div className="font-medium text-muted-foreground">
                            Deduplication Settings
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {s.parameters.deduplication
                              .enablePlaceNameDedup && (
                              <Badge variant="secondary">Place Names</Badge>
                            )}
                            {s.parameters.deduplication.enableEmailDedup && (
                              <Badge variant="secondary">Emails</Badge>
                            )}
                            {s.parameters.deduplication.enableAddressDedup && (
                              <Badge variant="secondary">Addresses</Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tier 2: Performance Metrics */}
                  {!isEnterpriseUser && s.actualCosts && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Credit Breakdown
                      </h4>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="text-muted-foreground">Discovery</div>
                          <div className="text-lg font-medium">
                            {s.actualCosts.discovery}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-muted-foreground">
                            Contact Finding
                          </div>
                          <div className="text-lg font-medium">
                            {s.actualCosts.enrichment}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-muted-foreground">Analysis</div>
                          <div className="text-lg font-medium">
                            {s.actualCosts.analysis}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-muted-foreground">Total</div>
                          <div className="text-lg font-medium text-primary">
                            {s.creditsUsed}
                          </div>
                        </div>
                      </div>

                      {s.creditsRefunded && s.creditsRefunded > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <Zap className="h-3.5 w-3.5 inline mr-1" />
                          {s.creditsRefunded} credits refunded (unused capacity)
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tier 2: Quality Metrics */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Quality Metrics
                    </h4>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                      <div className="space-y-1">
                        <div className="text-muted-foreground">
                          Contact Rate
                        </div>
                        <div className="flex items-baseline gap-2">
                          <div className="text-lg font-medium">
                            {enrichmentRate}%
                          </div>
                          <div className="text-muted-foreground">
                            ({s.results?.enrichedCount || 0}/
                            {s.results?.totalFound || 0})
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className={cn(
                              "h-1.5 rounded-full transition-all",
                              enrichmentRate >= 80
                                ? "bg-green-500"
                                : enrichmentRate >= 50
                                ? "bg-yellow-500"
                                : "bg-red-500"
                            )}
                            style={{ width: `${enrichmentRate}%` }}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-muted-foreground">
                          Analysis Coverage
                        </div>
                        <div className="flex items-baseline gap-2">
                          <div className="text-lg font-medium">
                            {analysisRate}%
                          </div>
                          <div className="text-muted-foreground">
                            ({s.results?.analyzedCount || 0}/
                            {s.results?.totalFound || 0})
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className={cn(
                              "h-1.5 rounded-full transition-all",
                              analysisRate >= 80
                                ? "bg-green-500"
                                : analysisRate >= 50
                                ? "bg-yellow-500"
                                : "bg-red-500"
                            )}
                            style={{ width: `${analysisRate}%` }}
                          />
                        </div>
                      </div>

                      {s.results?.avgRelevanceScore !== undefined && (
                        <div className="space-y-1">
                          <div className="text-muted-foreground">
                            Avg Relevance
                          </div>
                          <div className="text-lg font-medium">
                            {(s.results.avgRelevanceScore * 100).toFixed(0)}%
                          </div>
                          <div className="text-muted-foreground">
                            {s.results.avgRelevanceScore >= 0.8
                              ? "High Quality"
                              : s.results.avgRelevanceScore >= 0.6
                              ? "Good Quality"
                              : "Moderate"}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tier 3: Advanced Diagnostics */}
                  {(hasRadiusExpansion ||
                    totalDuplicates > 0 ||
                    s.researchTier) && (
                    <div className="space-y-3 pt-3 border-t">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        Advanced Diagnostics
                      </h4>

                      <div className="space-y-2 text-xs">
                        {/* Radius Expansion */}
                        {hasRadiusExpansion && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="font-medium text-foreground">
                                Radius Expanded:
                              </span>{" "}
                              {formatRadius(s.initialSearchRadius!)} →{" "}
                              {formatRadius(s.finalSearchRadius!)}{" "}
                              {s.expansionIterations
                                ? `(${s.expansionIterations} ${
                                    s.expansionIterations === 1
                                      ? "iteration"
                                      : "iterations"
                                  })`
                                : ""}
                            </div>
                          </div>
                        )}

                        {/* Deduplication Stats */}
                        {totalDuplicates > 0 && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <Filter className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="font-medium text-foreground">
                                Duplicates Filtered:
                              </span>{" "}
                              {totalDuplicates} total
                              {s.duplicatesFilteredPlaceName
                                ? ` (${s.duplicatesFilteredPlaceName} place names`
                                : ""}
                              {s.duplicatesFilteredEmail
                                ? `, ${s.duplicatesFilteredEmail} emails`
                                : ""}
                              {s.duplicatesFilteredAddress
                                ? `, ${s.duplicatesFilteredAddress} addresses`
                                : ""}
                              {s.duplicatesFilteredPlaceId
                                ? `, ${s.duplicatesFilteredPlaceId} place IDs`
                                : ""}
                              )
                            </div>
                          </div>
                        )}

                        {/* Research Tier */}
                        {s.researchTier && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <TrendingUp className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="font-medium text-foreground">
                                Research Tier:
                              </span>{" "}
                              {s.researchTier === "tavily"
                                ? "Basic (Tavily)"
                                : "Pro (Perplexity)"}
                              {s.researchConfidence && (
                                <span>
                                  {" "}
                                  • Confidence:{" "}
                                  {(s.researchConfidence * 100).toFixed(0)}%
                                </span>
                              )}
                              {s.researchDataPoints && (
                                <span>
                                  {" "}
                                  • {s.researchDataPoints} data points
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Discovery Metadata */}
                        {s.discoveryMetadata && (
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <BarChart3 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="font-medium text-foreground">
                                Discovery:
                              </span>{" "}
                              Requested {s.discoveryMetadata.requested},
                              delivered {s.discoveryMetadata.delivered}
                              {s.discoveryMetadata.shortfall > 0 &&
                                ` (${s.discoveryMetadata.shortfall} shortfall)`}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
