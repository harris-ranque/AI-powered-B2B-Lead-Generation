import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import type { Id } from "../_generated/dataModel";
import { resolveDisplayableContactTitle, resolveProspectStoredTitle } from "./contactAcceptance";
import {
  hasCompleteExportResearch,
  resolveExportResearchFields,
} from "./exportResearchFields";
import { isValidCompanyResearchCache } from "./companyResearchCache";

export type WrittenEmailContent = {
  subject?: string;
  body?: string;
};

export type ExportableLead = {
  email?: string;
  analysisStatus?: string;
  emailContent?: WrittenEmailContent;
  contactInfo?: {
    contacts?: Array<{
      name?: string;
      email?: string;
    }>;
    emails?: Array<{
      email?: string;
    }>;
  };
};

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function deriveFirstNameFromEmail(email: string): string {
  const [localPart] = email.split("@");
  if (!localPart) {
    return "";
  }
  const segment = localPart
    .split(/[._-]+/)
    .map((part) => part.replace(/[0-9]/g, ""))
    .find((part) => part.length > 0);
  if (!segment) {
    return "";
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function extractContactDetails(lead: ExportableLead): {
  firstName: string;
  fullName: string;
  email: string;
} {
  const contacts = lead.contactInfo?.contacts ?? [];
  const emails = lead.contactInfo?.emails ?? [];

  const contactWithEmail = contacts.find(
    (contact) => typeof contact?.email === "string" && contact.email.trim(),
  );
  const primaryContact = contactWithEmail ?? contacts[0];

  const emailCandidates: Array<string | undefined> = [
    lead.email,
    contactWithEmail?.email,
    primaryContact?.email,
    emails.find((entry) => typeof entry?.email === "string")?.email,
  ];

  const email = firstNonEmptyString(...emailCandidates);
  const fullName = firstNonEmptyString(primaryContact?.name);
  const firstName = fullName
    ? fullName.split(/\s+/)[0] ?? ""
    : email
      ? deriveFirstNameFromEmail(email)
      : "";

  return {
    firstName,
    fullName,
    email,
  };
}

export function hasWrittenEmail(
  emailContent?: WrittenEmailContent,
): boolean {
  const subject = emailContent?.subject?.trim();
  const body = emailContent?.body?.trim();
  return Boolean(subject || body);
}

export function isLeadExportable(lead: ExportableLead): boolean {
  const { email } = extractContactDetails(lead);
  if (email.length === 0) {
    return false;
  }
  if (lead.analysisStatus === "failed" || lead.analysisStatus === "skipped") {
    return false;
  }
  if (lead.analysisStatus === "completed") {
    return hasWrittenEmail(lead.emailContent);
  }
  // Legacy leads without explicit analysis status
  return true;
}

export type ExportableContact = {
  email: string;
  analysisStatus?: string;
  status?: string;
  emailContent?: WrittenEmailContent;
  title?: string;
  matchedRole?: string;
  companyResearchId?: Id<"companyResearch">;
  aiAnalysis?: {
    leadAnalysis?: Record<string, unknown>;
  };
};

export type ContactExportContext = {
  companyResearchPayload?: unknown;
};

export const PHONE_UNAVAILABLE_LABEL = "phone number not available.";

export function formatExportPhone(phone?: string): string {
  const trimmed = phone?.trim();
  return trimmed ? trimmed : PHONE_UNAVAILABLE_LABEL;
}

export function resolveContactExportTitle(contact: {
  title?: string;
  matchedRole?: string;
  leadProspectId?: string;
}): string {
  if (contact.leadProspectId) {
    return resolveProspectStoredTitle(contact.title) ?? "";
  }
  return (
    resolveDisplayableContactTitle({
      providerTitle: contact.title,
      matchedRole: contact.matchedRole,
    }) ?? ""
  );
}

/** Email + written content complete (pipeline milestone, not full CSV row). */
export function isContactEmailExportable(contact: ExportableContact): boolean {
  if (contact.status && contact.status !== "accepted") {
    return false;
  }
  if (contact.email.trim().length === 0) {
    return false;
  }
  if (
    contact.analysisStatus === "failed" ||
    contact.analysisStatus === "skipped"
  ) {
    return false;
  }
  return (
    contact.analysisStatus === "completed" &&
    hasWrittenEmail(contact.emailContent)
  );
}

/** Strict check: written email plus complete research fields (report, citations, confidence). */
export function isContactFullyExportable(
  contact: ExportableContact,
  context?: ContactExportContext,
): boolean {
  if (!isContactEmailExportable(contact)) {
    return false;
  }
  const leadAnalysis = contact.aiAnalysis?.leadAnalysis;
  const exportResearch = resolveExportResearchFields(
    leadAnalysis,
    context?.companyResearchPayload,
  );
  return hasCompleteExportResearch(exportResearch);
}

/** CSV export gate: accepted contact with completed Write Emails. Research columns may be empty. */
export function isContactExportable(
  contact: ExportableContact,
  _context?: ContactExportContext,
): boolean {
  return isContactEmailExportable(contact);
}

export type ExportReadinessCategory =
  | "exportable"
  | "awaiting_email_writing"
  | "analysis_failed"
  | "missing_title"
  | "incomplete_research";

export type ExportReadinessSummary = {
  totalAccepted: number;
  exportable: number;
  awaitingEmailWriting: number;
  analysisFailed: number;
  missingTitle: number;
  incompleteResearch: number;
};

/** Primary blocker for UI breakdown (one category per contact). */
export function classifyContactExportReadiness(
  contact: ExportableContact,
  _context?: ContactExportContext,
): ExportReadinessCategory {
  if (contact.status && contact.status !== "accepted") {
    return "analysis_failed";
  }
  if (!contact.email.trim()) {
    return "analysis_failed";
  }
  if (
    contact.analysisStatus === "failed" ||
    contact.analysisStatus === "skipped" ||
    contact.analysisStatus === "timeout"
  ) {
    return "analysis_failed";
  }
  if (
    contact.analysisStatus !== "completed" ||
    !hasWrittenEmail(contact.emailContent)
  ) {
    return "awaiting_email_writing";
  }
  return "exportable";
}

export function summarizeExportReadiness(
  contacts: ExportableContact[],
  researchById: Map<string, unknown>,
  contactResearchId?: (contact: ExportableContact) => string | undefined,
): ExportReadinessSummary {
  const summary: ExportReadinessSummary = {
    totalAccepted: contacts.length,
    exportable: 0,
    awaitingEmailWriting: 0,
    analysisFailed: 0,
    missingTitle: 0,
    incompleteResearch: 0,
  };

  for (const contact of contacts) {
    const researchId = contactResearchId?.(contact);
    const companyResearchPayload = researchId
      ? researchById.get(researchId)
      : undefined;
    const category = classifyContactExportReadiness(contact, {
      companyResearchPayload,
    });
    switch (category) {
      case "exportable":
        summary.exportable++;
        break;
      case "awaiting_email_writing":
        summary.awaitingEmailWriting++;
        break;
      case "analysis_failed":
        summary.analysisFailed++;
        break;
      case "missing_title":
        summary.missingTitle++;
        break;
      case "incomplete_research":
        summary.incompleteResearch++;
        break;
    }
  }

  return summary;
}

export async function computeExportReadinessForContacts(
  ctx: { db: GenericDatabaseReader<DataModel> },
  contacts: LeadContactDoc[],
): Promise<ExportReadinessSummary> {
  const researchById = await loadExportContextForContacts(ctx, contacts);
  return summarizeExportReadiness(
    contacts,
    researchById,
    (contact) =>
      contact.companyResearchId ? String(contact.companyResearchId) : undefined,
  );
}

type LeadContactDoc = DataModel["leadContacts"]["document"];

export type { LeadContactDoc };

async function loadExportContextForContacts(
  ctx: { db: GenericDatabaseReader<DataModel> },
  contacts: LeadContactDoc[],
): Promise<Map<string, unknown>> {
  const researchById = new Map<string, unknown>();

  const researchIds = new Set<string>();
  for (const contact of contacts) {
    if (contact.companyResearchId) {
      researchIds.add(String(contact.companyResearchId));
    }
  }

  for (const researchId of researchIds) {
    const doc = await ctx.db.get(researchId as Id<"companyResearch">);
    if (
      doc?.status === "completed" &&
      isValidCompanyResearchCache(doc.researchPayload)
    ) {
      researchById.set(researchId, doc.researchPayload);
    }
  }

  return researchById;
}

function isContactDocFullyExportable(
  contact: LeadContactDoc,
  _researchById: Map<string, unknown>,
): boolean {
  return isContactExportable(contact);
}

export async function filterFullyExportableContacts(
  ctx: { db: GenericDatabaseReader<DataModel> },
  contacts: LeadContactDoc[],
): Promise<LeadContactDoc[]> {
  const researchById = await loadExportContextForContacts(ctx, contacts);
  return contacts.filter((contact) =>
    isContactDocFullyExportable(contact, researchById),
  );
}

// ---------------------------------------------------------------------------
// DB-level helper — call from within a query or mutation context.
// Mirrors isLeadExportable: enrichmentStatus "completed" + analysisStatus not "failed".
// enrichmentStatus "completed" is only ever set when emails were actually stored,
// so we do not need a separate email-presence check at the DB level.
// ---------------------------------------------------------------------------
export async function countExportableContacts(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
): Promise<number> {
  const contacts = await ctx.db
    .query("leadContacts")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "accepted"),
    )
    .collect();
  const exportable = await filterFullyExportableContacts(ctx, contacts);
  return exportable.length;
}

export type ExportableCountSummary = {
  exportableContacts: number;
  exportableBusinesses: number;
  fromThisSearch: number;
  priorSearchExportable: number;
  duplicateSkips: number;
  linkedForReenrichment: number;
  acceptedContacts: number;
};

export async function countExportableSummaryForSearch(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
  userId: Id<"users">,
): Promise<ExportableCountSummary> {
  const resolution = await resolveSearchExportData(ctx, searchId, userId);
  const exportable = dedupeExportContactsByEmail(
    await filterFullyExportableContacts(ctx, resolution.contacts),
    searchId,
  );

  const businessIds = new Set<string>();
  for (const contact of exportable) {
    businessIds.add(String(contact.leadId));
  }

  return {
    exportableContacts: exportable.length,
    exportableBusinesses: businessIds.size,
    fromThisSearch: exportable.length,
    priorSearchExportable: 0,
    duplicateSkips: resolution.duplicateSkips,
    linkedForReenrichment: (
      await ctx.db
        .query("searchLinkedLeads")
        .withIndex("by_search", (q) => q.eq("searchId", searchId))
        .collect()
    ).length,
    acceptedContacts: resolution.contacts.length,
  };
}

export async function countExportableSummary(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
): Promise<ExportableCountSummary> {
  const contacts = await ctx.db
    .query("leadContacts")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "accepted"),
    )
    .collect();

  const exportable = await filterFullyExportableContacts(ctx, contacts);

  const businessIds = new Set<string>();
  for (const contact of exportable) {
    businessIds.add(String(contact.leadId));
  }

  return {
    exportableContacts: exportable.length,
    exportableBusinesses: businessIds.size,
    fromThisSearch: exportable.length,
    priorSearchExportable: 0,
    duplicateSkips: 0,
    linkedForReenrichment: 0,
    acceptedContacts: contacts.length,
  };
}

export async function countExportableLeads(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
): Promise<number> {
  return countExportableContacts(ctx, searchId);
}

export type ContactExportBlockerStats = {
  total: number;
  withoutEmail: number;
  awaitingEmailWriting: number;
  analysisFailed: number;
};

/** Split accepted contacts into export blocker buckets for user-facing messages. */
export function buildContactExportBlockerStats(
  contacts: ExportableContact[],
): ContactExportBlockerStats {
  let withoutEmail = 0;
  let awaitingEmailWriting = 0;
  let analysisFailed = 0;

  for (const contact of contacts) {
    if (!contact.email.trim()) {
      withoutEmail++;
      continue;
    }
    const category = classifyContactExportReadiness(contact);
    if (category === "awaiting_email_writing") {
      awaitingEmailWriting++;
    } else if (category === "analysis_failed") {
      analysisFailed++;
    } else if (category !== "exportable") {
      awaitingEmailWriting++;
    }
  }

  return {
    total: contacts.length,
    withoutEmail,
    awaitingEmailWriting,
    analysisFailed,
  };
}

export function isQuotaRelatedAnalysisError(error?: string): boolean {
  if (!error) {
    return false;
  }
  const normalized = error.toLowerCase();
  return (
    normalized.includes("insufficient_quota") ||
    normalized.includes("exceeded your current quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("429")
  );
}

export function noExportableLeadsMessage(
  stats: {
    total: number;
    withoutEmail: number;
    analysisFailed: number;
    awaitingEmailWriting?: number;
  },
  options?: {
    duplicateSkips?: number;
    priorSearchExportable?: number;
    linkedForReenrichment?: number;
    acceptedContacts?: number;
    exportReadiness?: ExportReadinessSummary;
    quotaBlocked?: boolean;
  },
): string {
  const { total, withoutEmail, analysisFailed } = stats;
  const awaitingEmailWriting = stats.awaitingEmailWriting ?? 0;
  const duplicateSkips = options?.duplicateSkips ?? 0;
  const priorSearchExportable = options?.priorSearchExportable ?? 0;
  const linkedForReenrichment = options?.linkedForReenrichment ?? 0;
  const acceptedContacts = options?.acceptedContacts ?? 0;
  const readiness = options?.exportReadiness;

  if (total === 0 && duplicateSkips > 0) {
    const reenrichNote =
      linkedForReenrichment > 0
        ? ` ${linkedForReenrichment} were queued for re-enrichment under this search (people discovery + email lookup with your new roles).`
        : "";
    const pipelineNote =
      acceptedContacts > 0
        ? ` This search has ${acceptedContacts} accepted contact(s) — complete Write Emails to unlock CSV export.`
        : " No verified emails were accepted yet — common for restaurants without team pages or without CEO/Founder listed on the website.";
    const readinessNote = readiness
      ? ` Breakdown: ${readiness.awaitingEmailWriting} awaiting email writing, ${readiness.analysisFailed} failed analysis.`
      : "";

    if (priorSearchExportable > 0) {
      return `No new leads were added for this search (${duplicateSkips} businesses were already in your account).${reenrichNote}${pipelineNote}${readinessNote}`;
    }
    return `No new leads were added for this search (${duplicateSkips} businesses were already in your account from prior searches, but none have exportable contacts yet).${reenrichNote}${pipelineNote}${readinessNote}`;
  }

  if (total === 0) return "No leads found for export";

  const reasons: string[] = [];
  if (withoutEmail > 0) reasons.push(`${withoutEmail} had no usable email address`);
  if (awaitingEmailWriting > 0) {
    reasons.push(`${awaitingEmailWriting} still awaiting email writing`);
  }
  if (analysisFailed > 0) reasons.push(`${analysisFailed} had failed analysis`);

  const quotaNote = options?.quotaBlocked
    ? " AI provider quota or rate limit was exceeded — check billing/API keys, then retry Write Emails from search history."
    : "";

  if (reasons.length === 0) {
    return `No exportable leads found out of ${total} total leads.${quotaNote}`;
  }
  return `No exportable leads found (${total} contacts discovered: ${reasons.join(", ")}).${quotaNote}`;
}

type EmailDedupableContact = {
  normalizedEmail: string;
  searchId: Id<"searches">;
  createdAt: number;
};

/** One row per email in exports; prefer current search, then newest contact. */
export function dedupeExportContactsByEmail<T extends EmailDedupableContact>(
  contacts: T[],
  preferSearchId?: Id<"searches">,
): T[] {
  const byEmail = new Map<string, T>();
  for (const contact of contacts) {
    const key = contact.normalizedEmail.toLowerCase().trim();
    if (!key) continue;
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, contact);
      continue;
    }
    byEmail.set(
      key,
      pickPreferredExportContact(existing, contact, preferSearchId),
    );
  }
  return [...byEmail.values()];
}

function pickPreferredExportContact<T extends EmailDedupableContact>(
  current: T,
  candidate: T,
  preferSearchId?: Id<"searches">,
): T {
  if (preferSearchId) {
    const currentPreferred =
      String(current.searchId) === String(preferSearchId);
    const candidatePreferred =
      String(candidate.searchId) === String(preferSearchId);
    if (currentPreferred && !candidatePreferred) return current;
    if (candidatePreferred && !currentPreferred) return candidate;
  }
  return candidate.createdAt >= current.createdAt ? candidate : current;
}

/** Group CSV rows by company; stable tie-break on contact name. */
export function sortExportContactsForCsv<T extends { leadId: Id<"leads">; name: string }>(
  contacts: T[],
  companyNameByLeadId: Map<string, string>,
): T[] {
  return [...contacts].sort((a, b) => {
    const companyA = (companyNameByLeadId.get(String(a.leadId)) ?? "")
      .trim()
      .toLowerCase();
    const companyB = (companyNameByLeadId.get(String(b.leadId)) ?? "")
      .trim()
      .toLowerCase();
    const byCompany = companyA.localeCompare(companyB);
    if (byCompany !== 0) {
      return byCompany;
    }
    return a.name.trim().toLowerCase().localeCompare(b.name.trim().toLowerCase());
  });
}

export function countDuplicateSkipsFromSearch(search: {
  duplicatesFilteredPlaceId?: number;
  duplicatesFilteredPlaceName?: number;
  duplicatesFilteredAddress?: number;
  duplicatesFilteredEmail?: number;
}): number {
  return (
    (search.duplicatesFilteredPlaceId ?? 0) +
    (search.duplicatesFilteredPlaceName ?? 0) +
    (search.duplicatesFilteredAddress ?? 0) +
    (search.duplicatesFilteredEmail ?? 0)
  );
}

export async function getDuplicateOriginalLeadIds(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
): Promise<Id<"leads">[]> {
  const metrics = await ctx.db
    .query("duplicateMetrics")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .collect();

  const leadIds = new Set<Id<"leads">>();
  for (const metric of metrics) {
    if (metric.originalLeadId) {
      leadIds.add(metric.originalLeadId);
    }
  }
  return [...leadIds];
}

export async function getExportableContactsForLeadIds(
  ctx: { db: GenericDatabaseReader<DataModel> },
  leadIds: Id<"leads">[],
): Promise<LeadContactDoc[]> {
  const contacts: LeadContactDoc[] = [];
  for (const leadId of leadIds) {
    const leadContacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_lead_status", (q) =>
        q.eq("leadId", leadId).eq("status", "accepted"),
      )
      .collect();
    contacts.push(...leadContacts);
  }
  return filterFullyExportableContacts(ctx, contacts);
}

export type SearchExportResolution = {
  leads: DataModel["leads"]["document"][];
  contacts: LeadContactDoc[];
  includesPriorSearchLeads: boolean;
  duplicateSkips: number;
  priorSearchExportable: number;
};

export async function resolveSearchExportData(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
  userId: Id<"users">,
): Promise<SearchExportResolution> {
  const search = await ctx.db.get(searchId);
  if (!search || search.userId !== userId) {
    return {
      leads: [],
      contacts: [],
      includesPriorSearchLeads: false,
      duplicateSkips: 0,
      priorSearchExportable: 0,
    };
  }

  const duplicateSkips = countDuplicateSkipsFromSearch(search);

  const searchLeads = await ctx.db
    .query("leads")
    .withIndex("by_search", (q) => q.eq("searchId", searchId))
    .collect();

  const searchContacts = await ctx.db
    .query("leadContacts")
    .withIndex("by_search_status", (q) =>
      q.eq("searchId", searchId).eq("status", "accepted"),
    )
    .collect();

  const contactById = new Map<string, LeadContactDoc>();
  for (const contact of searchContacts) {
    contactById.set(String(contact._id), contact);
  }

  const contacts = dedupeExportContactsByEmail(
    [...contactById.values()],
    searchId,
  );

  return {
    leads: searchLeads,
    contacts,
    includesPriorSearchLeads: false,
    duplicateSkips,
    priorSearchExportable: 0,
  };
}

export async function countDuplicateFallbackExportableContacts(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
  userId: Id<"users">,
): Promise<number> {
  const resolution = await resolveSearchExportData(ctx, searchId, userId);
  return resolution.priorSearchExportable;
}
