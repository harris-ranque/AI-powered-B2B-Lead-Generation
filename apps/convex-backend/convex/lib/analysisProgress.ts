import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type AnalysisProgressCtx = QueryCtx | MutationCtx;

const STUCK_ANALYSIS_MS = 10 * 60 * 1000;
const RECENT_COMPLETED_SCAN_LIMIT = 30;

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

async function collectContactsByAnalysisStatus(
  ctx: AnalysisProgressCtx,
  searchId: Id<"searches">,
  analysisStatus: Doc<"leadContacts">["analysisStatus"],
): Promise<Doc<"leadContacts">[]> {
  if (!analysisStatus) {
    return [];
  }
  return await ctx.db
    .query("leadContacts")
    .withIndex("by_search_analysis", (q) =>
      q.eq("searchId", searchId).eq("analysisStatus", analysisStatus),
    )
    .collect();
}

export type AnalysisCompletionState = {
  mode: "contact" | "lead" | "none";
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
  isComplete: boolean;
};

/**
 * Lightweight completion check for webhook handlers — avoids loading all search leads/contacts.
 */
export async function getAnalysisCompletionState(
  ctx: AnalysisProgressCtx,
  searchId: Id<"searches">,
): Promise<AnalysisCompletionState> {
  const search = await ctx.db.get(searchId);
  const progressTotal = search?.progress?.total ?? 0;
  const progressAnalyzed = search?.progress?.analyzed ?? 0;

  const acceptedSample = await ctx.db
    .query("leadContacts")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "accepted"),
    )
    .take(1);

  if (acceptedSample.length > 0) {
    const pendingContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "pending",
    );
    const scheduledContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "scheduled",
    );
    const processingContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "processing",
    );
    const failedContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "failed",
    );
    const timeoutContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "timeout",
    );
    const skippedContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "skipped",
    );

    const pending = pendingContacts.length;
    const scheduled = scheduledContacts.length;
    const processing = processingContacts.length;
    const failed = failedContacts.length + timeoutContacts.length;
    const skipped = skippedContacts.length;
    const inProgress = pending + scheduled + processing;
    const personalized = progressAnalyzed;
    const total =
      progressTotal > 0
        ? progressTotal
        : personalized + inProgress + failed + skipped;
    const completed = Math.max(0, total - inProgress - failed - skipped);
    const processed = completed + failed + skipped;

    return {
      mode: "contact",
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
      isComplete: total > 0 && inProgress === 0,
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
  const inProgress = pending + scheduled + processing;
  const processed = completed + failed + skipped;

  return {
    mode: "lead",
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
    isComplete: total > 0 && inProgress === 0,
  };
}

async function buildRecentPersonalizedContacts(
  ctx: AnalysisProgressCtx,
  searchId: Id<"searches">,
): Promise<AnalysisProgressSnapshot["recentPersonalized"]> {
  const recentCompleted = await ctx.db
    .query("leadContacts")
    .withIndex("by_search_analysis", (q) =>
      q.eq("searchId", searchId).eq("analysisStatus", "completed"),
    )
    .take(RECENT_COMPLETED_SCAN_LIMIT);

  const personalizedContacts = recentCompleted
    .filter((contact) => Boolean(contact.emailContent))
    .sort(
      (a, b) =>
        (b.analysisCompletedAt ?? b.updatedAt) -
        (a.analysisCompletedAt ?? a.updatedAt),
    )
    .slice(0, 5);

  const leadsById = new Map<Id<"leads">, Doc<"leads">>();
  for (const contact of personalizedContacts) {
    if (!leadsById.has(contact.leadId)) {
      const lead = await ctx.db.get(contact.leadId);
      if (lead) {
        leadsById.set(contact.leadId, lead);
      }
    }
  }

  return personalizedContacts.map((contact) => {
    const lead = leadsById.get(contact.leadId);
    return {
      contactName: contact.name,
      email: contact.email,
      businessName: lead?.businessName ?? "Unknown business",
      subject: contact.emailContent?.subject ?? "Email ready",
      relevanceScore: contact.aiAnalysis?.relevanceScore ?? null,
    };
  });
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
  const completion = await getAnalysisCompletionState(ctx, searchId);

  if (completion.mode === "contact") {
    const scheduledContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "scheduled",
    );
    const processingContacts = await collectContactsByAnalysisStatus(
      ctx,
      searchId,
      "processing",
    );
    const stuckInProgress = [
      ...scheduledContacts,
      ...processingContacts,
    ].filter(isStuckInAnalysis).length;

    const percentComplete =
      completion.total > 0
        ? Math.round((completion.processed / completion.total) * 100)
        : 0;
    const personalizedPercent =
      completion.total > 0
        ? Math.round((completion.personalized / completion.total) * 100)
        : 0;

    return {
      mode: "contact",
      searchId,
      total: completion.total,
      pending: completion.pending,
      scheduled: completion.scheduled,
      processing: completion.processing,
      inProgress: completion.inProgress,
      completed: completion.completed,
      failed: completion.failed,
      skipped: completion.skipped,
      personalized: completion.personalized,
      processed: completion.processed,
      percentComplete,
      personalizedPercent,
      isComplete: completion.isComplete,
      stuckInProgress,
      recentPersonalized: await buildRecentPersonalizedContacts(ctx, searchId),
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
