import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import type { Id } from "../_generated/dataModel";

export type ExportableLead = {
  email?: string;
  analysisStatus?: string;
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

export function isLeadExportable(lead: ExportableLead): boolean {
  const { email } = extractContactDetails(lead);
  const analysisFailed = lead.analysisStatus === "failed";
  return email.length > 0 && !analysisFailed;
}

export type ExportableContact = {
  email: string;
  analysisStatus?: string;
  status?: string;
};

export function isContactExportable(contact: ExportableContact): boolean {
  if (contact.status && contact.status !== "accepted") {
    return false;
  }
  return (
    contact.email.trim().length > 0 && contact.analysisStatus !== "failed"
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
  return contacts.filter(isContactExportable).length;
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

type LeadContactDoc = DataModel["leadContacts"]["document"];

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
    contacts.push(...leadContacts.filter(isContactExportable));
  }
  return contacts;
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
