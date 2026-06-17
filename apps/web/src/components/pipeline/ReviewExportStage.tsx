import React, { useCallback, useMemo, useState } from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePipeline } from "@/pipeline/context";
import {
  Download,
  FileText,
  Mail,
  CheckCircle,
  BarChart3,
  Calendar,
  RefreshCw,
  Sparkles,
  Loader2,
  Send,
  MailCheck,
  MailX,
  Activity,
  Target,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/useUser";
import { useSearch } from "@/hooks/useSearches";
import { useLeads } from "@/hooks/useLeads";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { createLogger } from "@/utils/logger";
import { normalizeError } from "@/utils/errorUtils";
import { useAnalytics } from "@/hooks/useAnalytics";
import { PushToInstantlyButton } from "@/components/instantly/PushToInstantlyButton";
import { useQuery } from "convex/react";
import { api } from "@genni/convex-types";
import type { Id } from "@genni/convex-types/dataModel";
import { featureFlags } from "@/lib/featureFlags";
import { ExportReadinessBreakdown } from "./ExportReadinessBreakdown";

const EXPORT_FORMATS = [
  {
    type: "csv",
    name: "CSV Export",
    description: "Spreadsheet-friendly format for CRM import",
    icon: FileText,
    includeEmails: true,
    size: "Small",
  },
];

const numberFormatter = new Intl.NumberFormat();
const percentFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

const reviewLogger = createLogger("ReviewExportStage");

const getString = (
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined =>
  source && typeof source[key] === "string"
    ? (source[key] as string)
    : undefined;

const getNumber = (
  source: Record<string, unknown> | undefined,
  key: string,
): number | undefined =>
  source && typeof source[key] === "number"
    ? (source[key] as number)
    : undefined;

type EmailSummary = {
  subject: string;
  body: string;
  responseRate: number | null;
};

type RejectedFindyMailContactRow = {
  contactId: string;
  leadId: string;
  searchId: string;
  businessName: string;
  website: string;
  email: string;
  normalizedEmail: string;
  name: string;
  title: string;
  linkedin: string;
  confidence: number;
  rejectionReason: string;
  requestedRoles: string[];
  matchedRole: string;
  titleMatchScore: number;
  titleMatchReason: string;
  emailVerified: boolean;
  domainMatchVerified: boolean;
  leadProspectId?: string;
  createdAt: number;
  updatedAt: number;
};

function normalizeRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value === 0) {
    return 0;
  }
  return value <= 1 ? value * 100 : value;
}

function extractEmailDetails(entry: unknown): EmailSummary | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const data = entry as Record<string, unknown>;
  const primaryCandidate =
    (typeof data.primary_email === "object" && data.primary_email !== null
      ? (data.primary_email as Record<string, unknown>)
      : undefined) ??
    (typeof data.primaryEmail === "object" && data.primaryEmail !== null
      ? (data.primaryEmail as Record<string, unknown>)
      : undefined);

  const emailContent =
    typeof data.emailContent === "object" && data.emailContent !== null
      ? (data.emailContent as Record<string, unknown>)
      : undefined;

  const subject =
    (typeof data.subject === "string" ? data.subject : undefined) ??
    getString(primaryCandidate, "subject") ??
    getString(emailContent, "subject") ??
    "Personalized Email";

  const body =
    (typeof data.body === "string" ? data.body : undefined) ??
    getString(primaryCandidate, "body") ??
    getString(emailContent, "body") ??
    "";

  const responseCandidate =
    (typeof data.estimated_response_rate === "number"
      ? data.estimated_response_rate
      : undefined) ??
    (typeof data.estimatedEffectiveness === "number"
      ? data.estimatedEffectiveness
      : undefined) ??
    getNumber(primaryCandidate, "estimated_effectiveness") ??
    getNumber(primaryCandidate, "estimatedEffectiveness") ??
    getNumber(emailContent, "estimatedEffectiveness") ??
    null;

  return {
    subject,
    body,
    responseRate: normalizeRate(responseCandidate),
  };
}

function summarizeBody(body: string, limit = 160): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "Personalized email ready to send.";
  }
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit).trimEnd()}…`;
}

const formatNumber = (value: number) =>
  numberFormatter.format(Math.max(0, Math.round(value)));
const formatPercent = (value: number) =>
  `${percentFormatter.format(Math.max(0, value))}%`;

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob(["\uFEFF" + rows.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function buildRejectedFindyMailCsv(rows: RejectedFindyMailContactRow[]) {
  const headers = [
    "search_id",
    "lead_id",
    "contact_id",
    "business_name",
    "website",
    "email",
    "normalized_email",
    "name",
    "title",
    "linkedin",
    "confidence",
    "rejection_reason",
    "requested_roles",
    "matched_role",
    "title_match_score",
    "title_match_reason",
    "email_verified",
    "domain_match_verified",
    "lead_prospect_id",
    "created_at",
    "updated_at",
  ];

  const dataRows = rows.map((row) =>
    [
      row.searchId,
      row.leadId,
      row.contactId,
      row.businessName,
      row.website,
      row.email,
      row.normalizedEmail,
      row.name,
      row.title,
      row.linkedin,
      row.confidence,
      row.rejectionReason,
      row.requestedRoles,
      row.matchedRole,
      row.titleMatchScore,
      row.titleMatchReason,
      row.emailVerified,
      row.domainMatchVerified,
      row.leadProspectId ?? "",
      new Date(row.createdAt).toISOString(),
      new Date(row.updatedAt).toISOString(),
    ]
      .map(escapeCsvValue)
      .join(","),
  );

  return [headers.join(","), ...dataRows];
}

interface ReviewExportStageProps {
  onViewResults?: () => void;
}

export function ReviewExportStage({ onViewResults }: ReviewExportStageProps) {
  const { state, resetPipeline } = usePipeline();
  const { user } = useUser();
  const { getToken: getClerkToken } = useClerkAuth();
  const { toast } = useToast();
  const analytics = useAnalytics();
  const { search } = useSearch(state.searchId || undefined);
  const contactCounts = useQuery(
    api.leads.queries.getAcceptedContactCountsBySearch,
    featureFlags.multiContactPipeline && state.searchId
      ? { searchId: state.searchId as Id<"searches"> }
      : "skip",
  );
  const rejectedFindyMailContacts = useQuery(
    api.leads.queries.getRejectedFindyMailContactsBySearch,
    state.searchId ? { searchId: state.searchId as Id<"searches"> } : "skip",
  ) as RejectedFindyMailContactRow[] | undefined;
  const { leads: searchLeads, updateLeadStatus } = useLeads(
    state.searchId || undefined,
  );

  const [isExporting, setIsExporting] = useState(false);
  const [isExportingRejected, setIsExportingRejected] = useState(false);
  const [isSendingEmails, setIsSendingEmails] = useState(false);
  const [exportedFormats, setExportedFormats] = useState<string[]>([]);
  const [sentLeadIds, setSentLeadIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const leads = useMemo(
    () => (state.searchId && searchLeads ? searchLeads : state.leads),
    [searchLeads, state.leads, state.searchId],
  );

  const leadsWithEmails = useMemo(
    () => leads.filter((lead) => lead.contactInfo?.emails?.length),
    [leads],
  );

  const generatedEmailMap = useMemo(() => {
    const map = new Map<string, unknown>();
    state.generatedEmails.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const record = entry as Record<string, unknown>;

      let leadIdValue: string | undefined;

      if (typeof record.leadId === "string") {
        leadIdValue = record.leadId;
      } else if (typeof record.lead_id === "string") {
        leadIdValue = record.lead_id;
      } else if (
        typeof record.lead === "object" &&
        record.lead !== null
      ) {
        const leadRecord = record.lead as Record<string, unknown>;
        if (typeof leadRecord.id === "string") {
          leadIdValue = leadRecord.id;
        } else if (typeof leadRecord._id === "string") {
          leadIdValue = leadRecord._id;
        }
      }

      if (leadIdValue) {
        map.set(leadIdValue, entry);
      }
    });
    return map;
  }, [state.generatedEmails]);

  const emailDetailsByLead = useMemo(() => {
    const map = new Map<string, EmailSummary>();
    leads.forEach((lead) => {
      const key = String(lead._id);
      const source = generatedEmailMap.get(key) ?? lead.emailContent;
      if (!source) {
        return;
      }
      const details = extractEmailDetails(source);
      if (!details || !details.body.trim()) {
        return;
      }
      map.set(key, details);
    });
    return map;
  }, [generatedEmailMap, leads]);

  const readyToSendLeads = useMemo(
    () =>
      leads.filter(
        (lead) =>
          lead.contactInfo?.emails?.length &&
          emailDetailsByLead.has(String(lead._id)),
      ),
    [emailDetailsByLead, leads],
  );

  const awaitingPersonalization = useMemo(
    () =>
      leads.filter(
        (lead) =>
          lead.contactInfo?.emails?.length &&
          !emailDetailsByLead.has(String(lead._id)) &&
          lead.analysisStatus !== "failed",
      ),
    [emailDetailsByLead, leads],
  );

  const missingContact = useMemo(
    () =>
      leads.filter(
        (lead) =>
          !lead.contactInfo?.emails?.length ||
          // Failed analysis — exclude if the lead still has usable emailContent from a
          // prior successful run (it will appear in readyToSendLeads instead).
          (lead.analysisStatus === "failed" && !emailDetailsByLead.has(String(lead._id))),
      ),
    [leads, emailDetailsByLead],
  );

  const discoveredCount = Math.max(
    search?.progress?.discovered ?? 0,
    search?.results?.totalFound ?? 0,
    leads.length,
  );

  // enrichedCount: leads with a verified email.
  // Intentionally excludes search?.progress?.enriched — that live counter includes
  // completed_fallback leads (no email found) which inflates the figure.
  const enrichedCount = Math.max(
    featureFlags.multiContactPipeline
      ? (contactCounts?.totalAccepted ?? 0)
      : 0,
    search?.results?.enrichedCount ?? 0,
    leadsWithEmails.length,
    state.enrichedLeads.length,
  );

  const exportableContactCount = featureFlags.multiContactPipeline
    ? (contactCounts?.totalExportableIncludingPrior ??
        contactCounts?.totalExportable ??
        enrichedCount)
    : enrichedCount;

  const duplicateSkipCount =
    (search?.duplicatesFilteredPlaceId ?? 0) +
    (search?.duplicatesFilteredAddress ?? 0) +
    (search?.duplicatesFilteredPlaceName ?? 0) +
    (search?.duplicatesFilteredEmail ?? 0);
  const priorSearchExportable = contactCounts?.duplicateFallbackExportable ?? 0;
  const isRepeatSearchNoNewLeads =
    discoveredCount === 0 && duplicateSkipCount > 0;

  // personalizedCount: leads with actual email content generated (analysis succeeded).
  // emailDetailsByLead already merges DB-loaded leads and session-generated emails accurately.
  // Excluding state.generatedEmails.length — it retains stale counts across search switches
  // until resetPipeline() is called, which can inflate this figure.
  const personalizedCount = emailDetailsByLead.size;

  const enrichmentRate =
    discoveredCount > 0
      ? featureFlags.multiContactPipeline
        ? (exportableContactCount / discoveredCount) * 100
        : (enrichedCount / discoveredCount) * 100
      : 0;

  const readyToSendCount = readyToSendLeads.length;
  const awaitingPersonalizationCount = awaitingPersonalization.length;
  const missingContactCount = missingContact.length;

  const unsentReadyLeads = useMemo(
    () =>
      readyToSendLeads.filter(
        (lead) => !sentLeadIds.includes(String(lead._id)),
      ),
    [readyToSendLeads, sentLeadIds],
  );

  const relevanceScores = useMemo(
    () =>
      leads
        .map((lead) => lead.aiAnalysis?.relevanceScore)
        .filter(
          (score): score is number =>
            typeof score === "number" && Number.isFinite(score),
        ),
    [leads],
  );

  const avgRelevanceScore = relevanceScores.length
    ? relevanceScores.reduce((sum, score) => sum + score, 0) /
      relevanceScores.length
    : 0;

  const responseRates = useMemo(
    () =>
      Array.from(emailDetailsByLead.values())
        .map((details) => details.responseRate)
        .filter(
          (rate): rate is number =>
            typeof rate === "number" && Number.isFinite(rate),
        ),
    [emailDetailsByLead],
  );

  const averageResponseRate = responseRates.length
    ? responseRates.reduce((sum, rate) => sum + rate, 0) / responseRates.length
    : 0;

  const pipelineCompletion =
    discoveredCount > 0 ? (personalizedCount / discoveredCount) * 100 : 0;

  const stageChartData = useMemo(
    () => [
      {
        label: "Discovered",
        metric: discoveredCount,
        fill: "hsl(var(--neon-cyan))",
      },
      {
        label: "Contacts",
        metric: enrichedCount,
        fill: "hsl(var(--neon-lime))",
      },
      {
        label: "Personalized",
        metric: personalizedCount,
        fill: "hsl(var(--primary))",
      },
    ],
    [discoveredCount, enrichedCount, personalizedCount],
  );

  const responseTrendData = useMemo(
    () =>
      state.generatedEmails
        .map((entry, index) => {
          const details = extractEmailDetails(entry);
          if (!details || details.responseRate === null) {
            return null;
          }
          return {
            index: index + 1,
            rate: Number(details.responseRate.toFixed(1)),
          };
        })
        .filter(Boolean) as Array<{ index: number; rate: number }>,
    [state.generatedEmails],
  );

  const topLeads = useMemo(
    () =>
      [...leads]
        .filter(
          (lead) =>
            typeof lead.aiAnalysis?.relevanceScore === "number" &&
            Number.isFinite(lead.aiAnalysis.relevanceScore),
        )
        .sort(
          (a, b) =>
            (b.aiAnalysis?.relevanceScore ?? 0) -
            (a.aiAnalysis?.relevanceScore ?? 0),
        )
        .slice(0, 4),
    [leads],
  );

  const stageChartConfig = useMemo(
    () => ({
      metric: {
        label: "Leads",
        color: "hsl(var(--neon-cyan))",
      },
    }),
    [],
  );

  const responseChartConfig = useMemo(
    () => ({
      rate: {
        label: "Est. Response %",
        color: "hsl(var(--neon-lime))",
      },
    }),
    [],
  );

  const lastUpdatedAt =
    search?.updatedAt ?? search?.completedAt ?? search?.createdAt ?? null;
  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString()
    : null;

  const enrichmentRateLabel =
    discoveredCount > 0 ? formatPercent(enrichmentRate) : "—";
  const avgRelevanceLabel = relevanceScores.length
    ? formatPercent(avgRelevanceScore * 100)
    : "—";
  const avgResponseLabel = responseRates.length
    ? formatPercent(averageResponseRate)
    : "—";
  const pipelineCompletionLabel =
    discoveredCount > 0 ? formatPercent(pipelineCompletion) : "—";

  const handleExport = useCallback(
    async (format: string) => {
      setActionError(null);
      setIsExporting(true);

      // Track export initiation
      const leadsWithEmails = leads.filter(
        (lead) => lead.enrichment?.email || lead.email,
      ).length;

      analytics.trackExportInitiated({
        format: 'csv',
        lead_count: leads.length,
        has_emails: leadsWithEmails,
      });

      try {
        if (format !== "csv") {
          throw new Error("Only CSV export is supported at this time");
        }

        if (!user?._id) throw new Error("Not authenticated");

        const convexUrl = import.meta.env.VITE_CONVEX_URL as
          | string
          | undefined;
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

        const tokenResponse = await fetch(
          `${baseUrl}/api/exports/issue-token`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        );

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
        if (state.searchId) params.set("searchId", state.searchId);

        const exportUrl = `${baseUrl}/api/exports/leads.csv?${params.toString()}`;

        const res = await fetch(exportUrl, { method: "GET" });

        if (!res.ok) {
          let errorMessage = "Export failed";
          try {
            const body = await res.text();
            if (body && body.length > 0 && body.length < 500) {
              errorMessage = body;
            }
          } catch {
            // Response body unreadable — fall through with generic message
          }
          throw new Error(errorMessage);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `leads-export-${Date.now()}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        setExportedFormats((prev) => [...prev, format]);

        // Track export success
        analytics.trackExportCompleted({
          format: 'csv',
          lead_count: leads.length,
          has_emails: leadsWithEmails,
          file_size_kb: Math.round(blob.size / 1024),
        });

        toast({
          title: "Export Complete",
          description: `Successfully exported your leads as ${format.toUpperCase()}.`,
        });
      } catch (error) {
        const normalizedError = normalizeError(
          error,
          "Failed to export data. Please try again.",
        );
        const errorInstance =
          error instanceof Error ? error : new Error(String(error));

        // Track export failure
        analytics.trackExportFailed({
          format: 'csv',
          lead_count: leads.length,
          has_emails: leadsWithEmails,
        });

        reviewLogger.error(
          "Export failed",
          {
            format,
            searchId: state.searchId,
            code: normalizedError.code,
            statusCode: normalizedError.statusCode,
          },
          errorInstance,
        );
        setActionError(normalizedError.message);
        toast({
          title: "Export Failed",
          description: normalizedError.message,
          variant: "destructive",
        });
      } finally {
        setIsExporting(false);
      }
    },
    [getClerkToken, state.searchId, toast, user?._id],
  );

  const handleRejectedFindyMailExport = useCallback(() => {
    setActionError(null);
    setIsExportingRejected(true);

    try {
      const rows = rejectedFindyMailContacts ?? [];
      if (rows.length === 0) {
        throw new Error("No rejected FindyMail contacts found for this search.");
      }

      downloadCsv(
        `findymail-rejections-${state.searchId ?? "search"}-${Date.now()}.csv`,
        buildRejectedFindyMailCsv(rows),
      );

      toast({
        title: "Rejected Contacts Exported",
        description: `Downloaded ${rows.length} rejected FindyMail candidate${rows.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      const normalizedError = normalizeError(
        error,
        "Failed to export rejected FindyMail contacts.",
      );
      setActionError(normalizedError.message);
      toast({
        title: "Export Failed",
        description: normalizedError.message,
        variant: "destructive",
      });
    } finally {
      setIsExportingRejected(false);
    }
  }, [rejectedFindyMailContacts, state.searchId, toast]);

  const handleStartNewPipeline = useCallback(() => {
    resetPipeline();
    toast({
      title: "New Pipeline Started",
      description: "Ready to discover new leads!",
    });
  }, [resetPipeline, toast]);

  const handleSendEmails = useCallback(async () => {
    if (unsentReadyLeads.length === 0) {
      toast({
        title: "Nothing to send yet",
        description:
          "Emails will appear here once contact finding and personalization finish.",
      });
      return;
    }

    setActionError(null);
    setIsSendingEmails(true);

    try {
      if (state.searchId && unsentReadyLeads.length && updateLeadStatus) {
        await Promise.allSettled(
          unsentReadyLeads
            .filter((lead) => lead._id)
            .map((lead) =>
              updateLeadStatus({
                leadId: lead._id,
                status: "contacted",
              }),
            ),
        );
      }

      setSentLeadIds((prev) => {
        const next = new Set(prev);
        unsentReadyLeads.forEach((lead) => next.add(String(lead._id)));
        return Array.from(next);
      });

      toast({
        title: "Emails queued",
        description: `Marked ${unsentReadyLeads.length} ${unsentReadyLeads.length === 1 ? "lead" : "leads"} as contacted.`,
      });
    } catch (error) {
      const normalizedError = normalizeError(
        error,
        "Unable to mark emails as sent right now.",
      );
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      reviewLogger.error(
        "Failed to update lead statuses",
        {
          leadCount: unsentReadyLeads.length,
          searchId: state.searchId,
          code: normalizedError.code,
          statusCode: normalizedError.statusCode,
        },
        errorInstance,
      );
      setActionError(normalizedError.message);
      toast({
        title: "Send failed",
        description: normalizedError.message,
        variant: "destructive",
      });
    } finally {
      setIsSendingEmails(false);
    }
  }, [state.searchId, toast, unsentReadyLeads, updateLeadStatus]);

  const handleViewResults = useCallback(() => {
    if (onViewResults) {
      onViewResults();
      return;
    }
    window.location.hash = "lead-history";
  }, [onViewResults]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2 text-center">
        <h3 className="flex items-center justify-center gap-2 text-2xl font-semibold text-slate-100">
          <CheckCircle className="h-6 w-6 text-emerald-400" />
          Pipeline Complete!
        </h3>
        <p className="text-sm text-muted-foreground">
          Review your results and export your leads and personalized emails.
        </p>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{actionError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="glass-card border border-slate-800/70 bg-slate-900/60 shadow-[0_20px_70px_-40px_rgba(0,255,204,0.35)]">
        <CardHeader>
          <CardTitle className="text-lg text-slate-100">
            Campaign Results Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-4">
            <div className="rounded-xl border border-cyan-500/30 bg-slate-900/60 p-5 text-center shadow-[0_0_24px_rgba(0,255,204,0.12)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10">
                <BarChart3 className="h-6 w-6 text-cyan-300" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-100" data-testid="total-leads">
                {formatNumber(discoveredCount)}
              </div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Leads Discovered
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-slate-900/60 p-5 text-center shadow-[0_0_24px_rgba(0,255,65,0.12)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
                <Mail className="h-6 w-6 text-emerald-300" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-100">
                {formatNumber(enrichedCount)}
              </div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {featureFlags.multiContactPipeline
                  ? "Accepted Contacts"
                  : "Contacts Found"}
              </p>
            </div>

            <div className="rounded-xl border border-purple-500/30 bg-slate-900/60 p-5 text-center shadow-[0_0_24px_rgba(97,76,255,0.12)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-purple-500/40 bg-purple-500/10">
                <Sparkles className="h-6 w-6 text-purple-300" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-100">
                {formatNumber(personalizedCount)}
              </div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Personalized Emails
              </p>
            </div>

            <div className="rounded-xl border border-teal-500/30 bg-slate-900/60 p-5 text-center shadow-[0_0_24px_rgba(0,255,204,0.12)]">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-teal-500/40 bg-teal-500/10">
                <Target className="h-6 w-6 text-teal-300" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-100">
                {featureFlags.multiContactPipeline
                  ? formatNumber(exportableContactCount)
                  : enrichmentRateLabel}
              </div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {featureFlags.multiContactPipeline
                  ? "CSV Exportable"
                  : "Contact Rate"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {featureFlags.multiContactPipeline &&
        contactCounts?.exportReadiness && (
          <ExportReadinessBreakdown
            readiness={contactCounts.exportReadiness}
            acceptedCount={enrichedCount}
            exportableCount={exportableContactCount}
          />
        )}

      <Tabs defaultValue="export" className="w-full">
        <TabsList className="grid w-full grid-cols-3 rounded-xl border border-slate-800/60 bg-slate-900/60 p-1">
          <TabsTrigger value="export">Export Data</TabsTrigger>
          <TabsTrigger value="send">Send Emails</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="space-y-4 pt-4">
          {isRepeatSearchNoNewLeads && (
            <Alert className="border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              <AlertDescription className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  No new businesses were added
                </span>
                — {duplicateSkipCount.toLocaleString()} were already in your account
                from prior searches. CSV export includes exportable contacts from
                those prior results
                {priorSearchExportable > 0
                  ? ` (${priorSearchExportable.toLocaleString()} available now).`
                  : " when available."}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {EXPORT_FORMATS.map((format) => {
              const IconComponent = format.icon;
              const isExported = exportedFormats.includes(format.type);

              return (
                <Card
                  key={format.type}
                  className={cn(
                    "glass-card border border-slate-800/60 bg-slate-900/60 transition-all duration-300",
                    isExported &&
                      "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_32px_rgba(0,255,65,0.18)]",
                  )}
                >
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "rounded-lg border border-slate-700/70 bg-slate-800/70 p-2 transition-colors",
                          isExported && "border-emerald-500/60 bg-emerald-500/10",
                        )}
                      >
                        <IconComponent
                          className={cn(
                            "h-5 w-5 text-slate-200",
                            isExported && "text-emerald-300",
                          )}
                        />
                      </div>
                      <div className="flex-1">
                        <CardTitle className="text-base text-slate-100">
                          {format.name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {format.description}
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">File Size</span>
                        <Badge variant="outline" className="border-cyan-500/40">
                          {format.size}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Includes Emails
                        </span>
                        <Badge
                          variant={
                            format.includeEmails ? "default" : "secondary"
                          }
                          className={
                            format.includeEmails
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                              : undefined
                          }
                        >
                          {format.includeEmails ? "Yes" : "No"}
                        </Badge>
                      </div>

                      <Button
                        onClick={() => handleExport(format.type)}
                        disabled={isExporting || isExported}
                        className={cn(
                          "w-full border border-cyan-500/40 bg-slate-900 text-cyan-200 transition-neo hover:bg-cyan-500/20 hover:text-cyan-50",
                          isExported &&
                            "border-emerald-500/40 bg-emerald-500/20 text-emerald-100",
                        )}
                      >
                        {isExported ? (
                          <>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Downloaded
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" />
                            Export {format.type.toUpperCase()}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <Card className="glass-card border border-amber-500/30 bg-slate-900/60 transition-all duration-300">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
                    <MailX className="h-5 w-5 text-amber-200" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base text-slate-100">
                      FindyMail Rejections
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Debug every candidate FindyMail returned but Genni rejected
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rejected Rows</span>
                    <Badge variant="outline" className="border-amber-500/40">
                      {rejectedFindyMailContacts?.length ?? 0}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Includes Reasons</span>
                    <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-100">
                      Yes
                    </Badge>
                  </div>

                  <Button
                    onClick={handleRejectedFindyMailExport}
                    disabled={
                      isExportingRejected ||
                      !rejectedFindyMailContacts ||
                      rejectedFindyMailContacts.length === 0
                    }
                    className="w-full border border-amber-500/40 bg-slate-900 text-amber-100 transition-neo hover:bg-amber-500/20 hover:text-amber-50"
                  >
                    {isExportingRejected ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Preparing...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Export Rejections
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="send" className="space-y-4 pt-4">
          <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-slate-100">
                Send Personalized Emails
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Review which leads are ready for outreach and queue emails in a
                single click.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-emerald-200">
                    Ready to Send
                    <MailCheck className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-emerald-100">
                    {formatNumber(readyToSendCount)}
                  </div>
                </div>

                <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
                  <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-purple-200">
                    Personalization Running
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-purple-100">
                    {formatNumber(awaitingPersonalizationCount)}
                  </div>
                </div>

                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
                  <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-rose-200">
                    Missing / Failed Contacts
                    <MailX className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-rose-100">
                    {formatNumber(missingContactCount)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleSendEmails}
                  disabled={isSendingEmails || unsentReadyLeads.length === 0}
                  size="lg"
                  className="flex-1 justify-center gap-2 border border-cyan-500/50 bg-slate-900 text-cyan-200 transition-neo hover:bg-cyan-500/20 hover:text-cyan-50 sm:flex-none sm:px-6"
                >
                  {isSendingEmails ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {isSendingEmails
                    ? "Sending..."
                    : `Send ${formatNumber(
                        unsentReadyLeads.length || readyToSendCount,
                      )} Emails`}
                </Button>

                {sentLeadIds.length > 0 && (
                  <Badge className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                    {formatNumber(sentLeadIds.length)} marked contacted
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="text-lg text-slate-100">
                Email Preview Queue
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Highlights from the first six emails ready to leave the inbox.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {readyToSendLeads.length ? (
                readyToSendLeads.slice(0, 6).map((lead) => {
                  const key = String(lead._id);
                  const details = emailDetailsByLead.get(key);
                  const isSent = sentLeadIds.includes(key);
                  const contactEmail =
                    lead.contactInfo?.emails?.[0]?.email ?? "Email available";

                  return (
                    <div
                      key={key}
                      className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-slate-900/50 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-100">
                          {lead.businessName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {contactEmail}
                        </p>
                      </div>

                      <div className="flex-1 text-sm text-slate-200 md:px-6">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {details?.subject || "Personalized email"}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-slate-300">
                          {summarizeBody(details?.body ?? "")}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {details?.responseRate !== null && details?.responseRate !== undefined && (
                          <Badge className="border border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
                            {formatPercent(details.responseRate)}
                          </Badge>
                        )}
                        <Badge
                          variant={isSent ? "default" : "secondary"}
                          className={cn(
                            isSent
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                              : "border-cyan-500/40 bg-transparent text-cyan-200",
                          )}
                        >
                          {isSent ? "Sent" : "Ready"}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-slate-800/60 bg-slate-900/50 p-6 text-center text-sm text-muted-foreground">
                  Personalization is still running. As soon as emails are ready,
                  they will appear here with full previews.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Avg Relevance
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-100" data-testid="avg-relevance-score">
                    {avgRelevanceLabel}
                  </p>
                </div>
                <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-200">
                  <Target className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Estimated Response
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-100">
                    {avgResponseLabel}
                  </p>
                </div>
                <div className="rounded-full border border-cyan-500/40 bg-cyan-500/10 p-3 text-cyan-200">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Pipeline Completion
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-100">
                    {pipelineCompletionLabel}
                  </p>
                </div>
                <div className="rounded-full border border-purple-500/40 bg-purple-500/10 p-3 text-purple-200">
                  <Activity className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Ready Emails
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-100">
                    {formatNumber(readyToSendCount)}
                  </p>
                </div>
                <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-200">
                  <MailCheck className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
              <CardHeader>
                <CardTitle className="text-base text-slate-100">
                  Pipeline Volume
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Stage-by-stage totals across the current campaign.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={stageChartConfig} className="h-[260px]">
                  <BarChart data={stageChartData}>
                    <CartesianGrid
                      stroke="hsl(var(--border) / 0.4)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="label"
                      stroke="hsl(var(--muted-foreground) / 0.7)"
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="hsl(var(--muted-foreground) / 0.7)"
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent hideIndicator />}
                    />
                    <Bar dataKey="metric" radius={6}>
                      {stageChartData.map((item) => (
                        <Cell key={item.label} fill={item.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
              <CardHeader>
                <CardTitle className="text-base text-slate-100">
                  Estimated Response Trend
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Confidence scores generated by the personalization agents.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[260px]">
                {responseTrendData.length ? (
                  <ChartContainer config={responseChartConfig}>
                    <LineChart data={responseTrendData}>
                      <CartesianGrid
                        stroke="hsl(var(--border) / 0.4)"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="index"
                        stroke="hsl(var(--muted-foreground) / 0.7)"
                        tickFormatter={(value) => `#${value}`}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground) / 0.7)"
                        domain={[
                          0,
                          (dataMax: number) =>
                            Math.min(100, Math.max(40, dataMax + 10)),
                        ]}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent hideLabel />}
                      />
                      {averageResponseRate > 0 && (
                        <ReferenceLine
                          y={Number(averageResponseRate.toFixed(1))}
                          stroke="hsl(var(--neon-lime) / 0.6)"
                          strokeDasharray="4 4"
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="rate"
                        stroke="hsl(var(--neon-lime))"
                        strokeWidth={2}
                        dot={{
                          strokeWidth: 1.5,
                          fill: "hsl(var(--background))",
                        }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-800/60 bg-slate-900/50 text-sm text-muted-foreground">
                    Response estimates will appear as soon as personalization
                    completes.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="glass-card border border-slate-800/60 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="text-base text-slate-100">
                Top Matching Leads
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Highest AI relevance scores with available contact information.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {topLeads.length ? (
                topLeads.map((lead) => {
                  const key = String(lead._id);
                  const details = emailDetailsByLead.get(key);
                  const relevance = lead.aiAnalysis?.relevanceScore ?? 0;
                  const contactName =
                    lead.contactInfo?.contacts?.[0]?.name ??
                    lead.contactInfo?.emails?.[0]?.email ??
                    "Primary contact";

                  return (
                    <div
                      key={key}
                      className="flex flex-col gap-2 rounded-lg border border-slate-800/60 bg-slate-900/50 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-100">
                          {lead.businessName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {contactName}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge className="border border-purple-500/40 bg-purple-500/15 text-purple-200">
                          {formatPercent(relevance * 100)}
                        </Badge>
                        {details?.responseRate !== null && details?.responseRate !== undefined && (
                          <Badge className="border border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
                            {formatPercent(details.responseRate)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-lg border border-dashed border-slate-800/60 bg-slate-900/50 p-6 text-center text-sm text-muted-foreground">
                  Complete contact finding and personalization to unlock lead quality
                  insights.
                </div>
              )}
            </CardContent>
          </Card>

          {lastUpdatedLabel && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              Data refreshed {lastUpdatedLabel}
            </p>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button
          onClick={handleStartNewPipeline}
          variant="outline"
          size="lg"
          className="neon-border border-cyan-500/40 bg-transparent text-cyan-200 hover:bg-cyan-500/20 hover:text-cyan-50"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Start New Pipeline
        </Button>

        <Button
          onClick={() => handleExport("csv")}
          disabled={isExporting || exportedFormats.includes("csv")}
          size="lg"
          className={cn(
            "min-w-48 border border-cyan-500/40 bg-slate-900 text-cyan-200 transition-neo hover:bg-cyan-500/20 hover:text-cyan-50",
            !exportedFormats.includes("csv") && "hover-glow",
          )}
        >
          {isExporting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Preparing CSV...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Quick CSV Export
            </>
          )}
        </Button>

        {/* Push to Instantly - Only shown if user has Instantly configured */}
        {state.searchId && (
          <PushToInstantlyButton
            searchId={state.searchId}
            searchName={search?.name}
            status={search?.status || "completed"}
            totalLeads={discoveredCount}
            analyzedCount={personalizedCount}
            enrichedCount={enrichedCount}
          />
        )}

        <Button
          onClick={handleViewResults}
          variant="ghost"
          size="lg"
          className="text-cyan-200 hover:text-cyan-50"
        >
          <FileText className="mr-2 h-4 w-4" />
          View Results
        </Button>
      </div>
    </div>
  );
}
