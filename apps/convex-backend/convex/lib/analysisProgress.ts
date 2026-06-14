import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type AnalysisProgressCtx = QueryCtx | MutationCtx;

const STUCK_ANALYSIS_MS = 10 * 60 * 1000;

function isStuckInAnalysis(contact: {
  analysisStatus?: string;
  analysisScheduledAt?: number;
  analysisStartedAt?: number;
  updatedAt: number;
}): boolean {
  if (
    contact.analysisStatus !== "scheduled" &&
    contact.analysisStatus !== "processing"
  ) {
    return false;
  }
  const startedAt =
    contact.analysisStartedAt ??
    contact.analysisScheduledAt ??
    contact.updatedAt;
  return Date.now() - startedAt > STUCK_ANALYSIS_MS;
}

function isEligibleLegacyLead(lead: Doc<"leads">): boolean {
  const enrichmentComplete =
    lead.enrichmentStatus === "completed" ||
    lead.enrichmentStatus === "completed_fallback";
  const hasEmail =
    Boolean(lead.primaryEmail) ||
    Boolean(lead.contactInfo?.emails?.length);
  const hasContactName = Boolean(lead.contactInfo?.contacts?.[0]?.name);
  return enrichmentComplete && hasEmail && hasContactName;
}

export type AnalysisProgressSnapshot = {
  mode: "contact" | "lead";
  searchId: Id<"searches">;
  total: number;
  pending: number;
  scheduled: number;
  processing: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
  personalized: number;
  processed: number;
  percentComplete: number;
  personalizedPercent: number;
  isComplete: boolean;
  stuckInProgress: number;
  recentPersonalized: Array<{
    contactName: string;
    email: string;
    businessName: string;
    subject: string;
    relevanceScore: number | null;
  }>;
};

export async function computeAnalysisProgress(
  ctx: AnalysisProgressCtx,
  searchId: Id<"searches">,
): Promise<AnalysisProgressSnapshot> {
  const acceptedContacts = await ctx.db
    .query("leadContacts")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "accepted"),
    )
    .collect();

  if (acceptedContacts.length > 0) {
    const pending = acceptedContacts.filter(
      (contact) => !contact.analysisStatus || contact.analysisStatus === "pending",
    ).length;
    const scheduled = acceptedContacts.filter(
      (contact) => contact.analysisStatus === "scheduled",
    ).length;
    const processing = acceptedContacts.filter(
      (contact) => contact.analysisStatus === "processing",
    ).length;
    const completed = acceptedContacts.filter(
      (contact) => contact.analysisStatus === "completed",
    ).length;
    const failed = acceptedContacts.filter(
      (contact) =>
        contact.analysisStatus === "failed" || contact.analysisStatus === "timeout",
    ).length;
    const skipped = acceptedContacts.filter(
      (contact) => contact.analysisStatus === "skipped",
    ).length;
    const personalized = acceptedContacts.filter(
      (contact) =>
        contact.analysisStatus === "completed" && Boolean(contact.emailContent),
    ).length;

    const total = acceptedContacts.length;
    const inProgress = scheduled + processing;
    const stuckInProgress = acceptedContacts.filter(isStuckInAnalysis).length;
    const processed = completed + failed + skipped;
    const percentComplete =
      total > 0 ? Math.round((processed / total) * 100) : 0;
    const personalizedPercent =
      total > 0 ? Math.round((personalized / total) * 100) : 0;

    const leadIds = [...new Set(acceptedContacts.map((c) => c.leadId))];
    const leadsById = new Map<Id<"leads">, Doc<"leads">>();
    for (const leadId of leadIds) {
      const lead = await ctx.db.get(leadId);
      if (lead) leadsById.set(leadId, lead);
    }

    const recentPersonalized = acceptedContacts
      .filter(
        (contact) =>
          contact.analysisStatus === "completed" && Boolean(contact.emailContent),
      )
      .sort(
        (a, b) =>
          (b.analysisCompletedAt ?? b.updatedAt) -
          (a.analysisCompletedAt ?? a.updatedAt),
      )
      .slice(0, 5)
      .map((contact) => {
        const lead = leadsById.get(contact.leadId);
        return {
          contactName: contact.name,
          email: contact.email,
          businessName: lead?.businessName ?? "Unknown business",
          subject: contact.emailContent?.subject ?? "Email ready",
          relevanceScore: contact.aiAnalysis?.relevanceScore ?? null,
        };
      });

    return {
      mode: "contact",
      searchId,
      total,
      pending,
      scheduled,
      processing,
      inProgress,
      completed,
      failed,
      skipped,
      personalized,
      processed,
      percentComplete,
      personalizedPercent,
      isComplete: total > 0 && pending + inProgress === 0,
      stuckInProgress,
      recentPersonalized,
    };
  }

  const allLeads = await ctx.db
    .query("leads")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .collect();

  const eligibleLeads = allLeads.filter(isEligibleLegacyLead);

  const pending = eligibleLeads.filter(
    (lead) => !lead.analysisStatus || lead.analysisStatus === "pending",
  ).length;
  const scheduled = eligibleLeads.filter(
    (lead) => lead.analysisStatus === "scheduled",
  ).length;
  const processing = eligibleLeads.filter(
    (lead) => lead.analysisStatus === "processing",
  ).length;
  const completed = eligibleLeads.filter(
    (lead) => lead.analysisStatus === "completed",
  ).length;
  const failed = eligibleLeads.filter(
    (lead) => lead.analysisStatus === "failed",
  ).length;
  const skipped = eligibleLeads.filter(
    (lead) => lead.analysisStatus === "skipped",
  ).length;
  const personalized = eligibleLeads.filter(
    (lead) => lead.analysisStatus === "completed" && Boolean(lead.emailContent),
  ).length;

  const total = eligibleLeads.length;
  const inProgress = scheduled + processing;
  const stuckInProgress = eligibleLeads.filter(isStuckInAnalysis).length;
  const processed = completed + failed + skipped;
  const percentComplete =
    total > 0 ? Math.round((processed / total) * 100) : 0;
  const personalizedPercent =
    total > 0 ? Math.round((personalized / total) * 100) : 0;

  const recentPersonalized = eligibleLeads
    .filter(
      (lead) => lead.analysisStatus === "completed" && Boolean(lead.emailContent),
    )
    .sort(
      (a, b) =>
        (b.analysisCompletedAt ?? b.updatedAt ?? 0) -
        (a.analysisCompletedAt ?? a.updatedAt ?? 0),
    )
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

  return {
    mode: "lead",
    searchId,
    total,
    pending,
    scheduled,
    processing,
    inProgress,
    completed,
    failed,
    skipped,
    personalized,
    processed,
    percentComplete,
    personalizedPercent,
    isComplete: total > 0 && pending + inProgress === 0,
    stuckInProgress,
    recentPersonalized,
  };
}
