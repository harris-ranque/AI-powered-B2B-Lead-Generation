import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import type { Id } from "../_generated/dataModel";
import { resolveDisplayableContactTitle } from "./contactAcceptance";
import {
  hasCompleteExportResearch,
  resolveExportResearchFields,
} from "./exportResearchFields";

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
}): string {
  return resolveDisplayableContactTitle({
    providerTitle: contact.title,
    matchedRole: contact.matchedRole,
  }) ?? "";
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

/** Full CSV row: email content, title, and complete research fields. Phone is optional. */
export function isContactFullyExportable(
  contact: ExportableContact,
  context?: ContactExportContext,
): boolean {
  if (!isContactEmailExportable(contact)) {
    return false;
  }
  if (!resolveContactExportTitle(contact).trim()) {
    return false;
  }
  const leadAnalysis = contact.aiAnalysis?.leadAnalysis;
  const exportResearch = resolveExportResearchFields(
    leadAnalysis,
    context?.companyResearchPayload,
  );
  return hasCompleteExportResearch(exportResearch);
}

/** Alias used by export paths — every exported row must be fully populated. */
export function isContactExportable(
  contact: ExportableContact,
  context?: ContactExportContext,
): boolean {
  return isContactFullyExportable(contact, context);
}

type LeadContactDoc = DataModel["leadContacts"]["document"];

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
    if (doc?.status === "completed") {
      researchById.set(researchId, doc.researchPayload);
    }
  }

  return researchById;
}

function isContactDocFullyExportable(
  contact: LeadContactDoc,
  researchById: Map<string, unknown>,
): boolean {
  const companyResearchPayload = contact.companyResearchId
    ? researchById.get(String(contact.companyResearchId))
    : undefined;
  return isContactFullyExportable(contact, { companyResearchPayload });
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
};

export async function countExportableSummaryForSearch(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
  userId: Id<"users">,
): Promise<ExportableCountSummary> {
  const resolution = await resolveSearchExportData(ctx, searchId, userId);
  const exportable = await filterFullyExportableContacts(
    ctx,
    resolution.contacts,
  );

  const businessIds = new Set<string>();
  let fromThisSearch = 0;
  let priorSearchExportable = 0;
  for (const contact of exportable) {
    businessIds.add(String(contact.leadId));
    if (String(contact.searchId) === String(searchId)) {
      fromThisSearch++;
    } else {
      priorSearchExportable++;
    }
  }

  return {
    exportableContacts: exportable.length,
    exportableBusinesses: businessIds.size,
    fromThisSearch,
    priorSearchExportable,
    duplicateSkips: resolution.duplicateSkips,
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
  };
}

export async function countExportableLeads(
  ctx: { db: GenericDatabaseReader<DataModel> },
  searchId: Id<"searches">,
): Promise<number> {
  return countExportableContacts(ctx, searchId);
}

export function noExportableLeadsMessage(
  stats: {
    total: number;
    withoutEmail: number;
    analysisFailed: number;
  },
  options?: {
    duplicateSkips?: number;
    priorSearchExportable?: number;
  },
): string {
  const { total, withoutEmail, analysisFailed } = stats;
  const duplicateSkips = options?.duplicateSkips ?? 0;
  const priorSearchExportable = options?.priorSearchExportable ?? 0;

  if (total === 0 && duplicateSkips > 0) {
    if (priorSearchExportable > 0) {
      return `No new leads were added for this search (${duplicateSkips} businesses were already in your account). ${priorSearchExportable} exportable contacts from prior searches can still be downloaded via CSV export.`;
    }
    return `No new leads were added for this search (${duplicateSkips} businesses were already in your account from prior searches, but none have exportable contacts yet).`;
  }

  if (total === 0) return "No leads found for export";

  const reasons: string[] = [];
  if (withoutEmail > 0) reasons.push(`${withoutEmail} had no usable email address`);
  if (analysisFailed > 0) reasons.push(`${analysisFailed} had failed analysis`);

  if (reasons.length === 0) return `No exportable leads found out of ${total} total leads`;
  return `No exportable leads found (${total} leads discovered: ${reasons.join(", ")})`;
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

  const leadMap = new Map<string, DataModel["leads"]["document"]>();
  for (const lead of searchLeads) {
    leadMap.set(String(lead._id), lead);
  }

  const contactById = new Map<string, LeadContactDoc>();
  for (const contact of searchContacts) {
    contactById.set(String(contact._id), contact);
  }

  const originalLeadIds = await getDuplicateOriginalLeadIds(ctx, searchId);
  const fallbackContacts = await getExportableContactsForLeadIds(
    ctx,
    originalLeadIds,
  );

  let priorSearchExportable = 0;
  for (const contact of fallbackContacts) {
    if (!contactById.has(String(contact._id))) {
      contactById.set(String(contact._id), contact);
      priorSearchExportable++;
    }
  }

  for (const contact of contactById.values()) {
    const leadKey = String(contact.leadId);
    if (!leadMap.has(leadKey)) {
      const lead = await ctx.db.get(contact.leadId);
      if (lead && lead.userId === userId) {
        leadMap.set(leadKey, lead);
      }
    }
  }

  const includesPriorSearchLeads =
    priorSearchExportable > 0 ||
    searchLeads.length < leadMap.size;

  return {
    leads: [...leadMap.values()],
    contacts: [...contactById.values()],
    includesPriorSearchLeads,
    duplicateSkips,
    priorSearchExportable,
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
