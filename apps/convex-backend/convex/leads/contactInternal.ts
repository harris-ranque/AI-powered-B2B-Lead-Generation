import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { extractPrimaryEmail } from "../lib/deduplication";
import {
  acceptFindyMailNameSearchEmail,
  evaluateContactCandidate,
  extractProviderTitle,
  resolveDisplayableContactTitle,
  resolveProspectStoredTitle,
} from "../lib/contactAcceptance";
import { slimContactAiAnalysisForStorage } from "../lib/contactAnalysisStorage";
import { extractDomainFromWebsite } from "../lib/contactVerification";
import { resolveEnrichmentRoles } from "../lib/enrichmentRoles";
import {
  isValidCompanyResearchCache,
  normalizeCompanyResearchPayload,
} from "../lib/companyResearchCache";
import { enrichResearchPayloadForExport } from "../lib/exportResearchFields";
import { deriveLeadAnalysisStatusFromContacts } from "../lib/contactAnalysisSync";

const contactStatusValidator = v.union(
  v.literal("candidate"),
  v.literal("accepted"),
  v.literal("rejected"),
);

const aiAnalysisValidator = v.object({
  relevanceScore: v.number(),
  painPoints: v.array(v.string()),
  valueMatches: v.array(v.string()),
  recommendations: v.optional(v.array(v.string())),
  leadAnalysis: v.optional(v.any()),
  processingTime: v.optional(v.number()),
  confidence: v.optional(v.number()),
  researchTier: v.optional(v.string()),
  companyData: v.optional(v.any()),
  fitAssessment: v.optional(v.string()),
  recommendedApproach: v.optional(v.string()),
});

const emailContentValidator = v.object({
  subject: v.string(),
  body: v.string(),
  personalizationNotes: v.array(v.string()),
  estimatedEffectiveness: v.number(),
});

export const getAcceptedContactsForSearch = internalQuery({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();
  },
});

export const getContactsForAnalysis = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    return contacts.filter((contact) => {
      const pendingAnalysis =
        !contact.analysisStatus ||
        contact.analysisStatus === "pending" ||
        contact.analysisStatus === "failed" ||
        contact.analysisStatus === "timeout";
      return pendingAnalysis && contact.email.trim().length > 0;
    });
  },
});

export const getContactInternal = internalQuery({
  args: { contactId: v.id("leadContacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.contactId);
  },
});

export const getAcceptedEmailsForSearch = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const accepted = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();
    return accepted.map((c) => c.normalizedEmail);
  },
});

export const upsertLeadContact = internalMutation({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    name: v.string(),
    title: v.optional(v.string()),
    email: v.string(),
    normalizedEmail: v.string(),
    linkedin: v.optional(v.string()),
    confidence: v.number(),
    source: v.union(
      v.literal("findymail"),
      v.literal("csv_import"),
      v.literal("manual"),
    ),
    providerContactId: v.optional(v.string()),
    rawProviderData: v.optional(v.any()),
    requestedRoles: v.array(v.string()),
    matchedRole: v.optional(v.string()),
    titleMatchScore: v.optional(v.number()),
    titleMatchReason: v.optional(v.string()),
    emailVerified: v.boolean(),
    domainMatchVerified: v.boolean(),
    status: contactStatusValidator,
    rejectionReason: v.optional(
      v.union(
        v.literal("title_mismatch"),
        v.literal("missing_title"),
        v.literal("domain_mismatch"),
        v.literal("email_unverified"),
        v.literal("duplicate_email"),
        v.literal("missing_email"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_email", (q) =>
        q.eq("searchId", args.searchId).eq("normalizedEmail", args.normalizedEmail),
      )
      .first();

    const now = Date.now();
    const data = {
      leadId: args.leadId,
      searchId: args.searchId,
      userId: args.userId,
      name: args.name,
      title: args.title,
      email: args.email,
      normalizedEmail: args.normalizedEmail,
      linkedin: args.linkedin,
      confidence: args.confidence,
      source: args.source,
      providerContactId: args.providerContactId,
      rawProviderData: args.rawProviderData,
      requestedRoles: args.requestedRoles,
      matchedRole: args.matchedRole,
      titleMatchScore: args.titleMatchScore,
      titleMatchReason: args.titleMatchReason,
      emailVerified: args.emailVerified,
      domainMatchVerified: args.domainMatchVerified,
      status: args.status,
      rejectionReason: args.rejectionReason,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("leadContacts", {
      ...data,
      analysisStatus: args.status === "accepted" ? "pending" : "skipped",
      createdAt: now,
    });
  },
});

export const dualWriteLeadContactInfo = internalMutation({
  args: {
    leadId: v.id("leads"),
    acceptedContacts: v.array(
      v.object({
        name: v.string(),
        title: v.optional(v.string()),
        email: v.string(),
        linkedin: v.optional(v.string()),
        confidence: v.number(),
      }),
    ),
    enrichmentData: v.optional(v.any()),
    enrichmentProvider: v.optional(v.literal("findymail")),
    enrichmentStatus: v.union(
      v.literal("completed"),
      v.literal("completed_fallback"),
      v.literal("no_contacts_found"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const emails = args.acceptedContacts.map((contact) => ({
      email: contact.email,
      type: "work",
      confidence: contact.confidence,
    }));

    const contactInfo = {
      emails,
      contacts: args.acceptedContacts.map((c) => ({
        name: c.name,
        title: c.title,
        email: c.email,
        linkedin: c.linkedin,
        confidence: c.confidence,
      })),
      socialProfiles: {},
    };

    const updateData: Record<string, unknown> = {
      enrichmentStatus: args.enrichmentStatus,
      contactInfo,
      updatedAt: Date.now(),
    };

    if (args.enrichmentData) {
      updateData.enrichmentData = args.enrichmentData;
    }
    if (args.enrichmentProvider) {
      updateData.enrichmentProvider = args.enrichmentProvider;
    }

    const primaryEmail = extractPrimaryEmail(contactInfo);
    if (primaryEmail) {
      updateData.primaryEmail = primaryEmail.toLowerCase().trim();
    }

    await ctx.db.patch(args.leadId, updateData);
  },
});

export const getCompanyResearchByDomain = internalQuery({
  args: {
    searchId: v.id("searches"),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("companyResearch")
      .withIndex("by_search_domain", (q) =>
        q.eq("searchId", args.searchId).eq("domain", args.domain),
      )
      .first();
  },
});

export const upsertCompanyResearch = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    leadId: v.optional(v.id("leads")),
    domain: v.string(),
    researchPayload: v.any(),
    confidence: v.optional(v.number()),
    citations: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("companyResearch")
      .withIndex("by_search_domain", (q) =>
        q.eq("searchId", args.searchId).eq("domain", args.domain),
      )
      .first();

    const now = Date.now();
    const enrichedPayload = enrichResearchPayloadForExport(args.researchPayload);
    const data = {
      searchId: args.searchId,
      userId: args.userId,
      leadId: args.leadId,
      domain: args.domain,
      researchPayload: enrichedPayload,
      confidence: args.confidence,
      citations: args.citations,
      provider: args.provider,
      status: args.status,
      updatedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("companyResearch", {
      ...data,
      createdAt: now,
    });
  },
});

export const linkContactsToCompanyResearch = internalMutation({
  args: {
    leadId: v.id("leads"),
    companyResearchId: v.id("companyResearch"),
  },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_lead_status", (q) =>
        q.eq("leadId", args.leadId).eq("status", "accepted"),
      )
      .collect();

    for (const contact of contacts) {
      await ctx.db.patch(contact._id, {
        companyResearchId: args.companyResearchId,
        updatedAt: Date.now(),
      });
    }
  },
});

export const getFailedContactsForRetry = internalQuery({
  args: {
    searchId: v.id("searches"),
    maxRetries: v.number(),
  },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    return contacts.filter((contact) => {
      const attempts = contact.analysisAttempts ?? 0;
      return (
        contact.analysisStatus === "failed" &&
        attempts < args.maxRetries &&
        contact.email.trim().length > 0
      );
    });
  },
});

export const markContactAnalysisScheduled = internalMutation({
  args: {
    contactId: v.id("leadContacts"),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return;

    await ctx.db.patch(args.contactId, {
      analysisStatus: "scheduled",
      analysisRequestId: args.requestId,
      analysisScheduledAt: Date.now(),
      analysisAttempts: (contact.analysisAttempts ?? 0) + 1,
      updatedAt: Date.now(),
    });
  },
});

export const markContactAnalysisCompleted = internalMutation({
  args: { contactId: v.id("leadContacts") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.contactId, {
      analysisStatus: "completed",
      analysisCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateLeadContactAnalysis = internalMutation({
  args: {
    contactId: v.id("leadContacts"),
    aiAnalysis: aiAnalysisValidator,
    emailContent: v.optional(emailContentValidator),
    followUpEmails: v.optional(
      v.array(
        v.object({
          subject: v.string(),
          body: v.string(),
          delay_days: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const updateData: Record<string, unknown> = {
      aiAnalysis: slimContactAiAnalysisForStorage(args.aiAnalysis),
      analysisStatus: "completed",
      analysisCompletedAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (args.emailContent) {
      updateData.emailContent = args.emailContent;
    }
    if (args.followUpEmails) {
      updateData.followUpEmails = args.followUpEmails;
    }

    await ctx.db.patch(args.contactId, updateData);

    const contact = await ctx.db.get(args.contactId);
    if (!contact) return;

    await syncLeadAnalysisStatusFromContacts(ctx, contact.leadId);
  },
});

export const processMultiContactEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    requestedRoles: v.array(v.string()),
    companyWebsite: v.optional(v.string()),
    enrichmentResult: v.any(),
    enableRoleExpansion: v.boolean(),
    roleMatchPatterns: v.optional(v.array(v.string())),
    semanticTitleAccepted: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const acceptedEmails = new Set(
      (
        await ctx.db
          .query("leadContacts")
          .withIndex("by_search_status", (q) =>
            q.eq("searchId", args.searchId).eq("status", "accepted"),
          )
          .collect()
      ).map((c) => c.normalizedEmail),
    );

    let requestedRoles = args.requestedRoles;
    if (requestedRoles.length === 0) {
      const search = await ctx.db.get(args.searchId);
      requestedRoles = resolveEnrichmentRoles(undefined, search?.parameters);
    }

    const result = args.enrichmentResult as {
      contacts?: Array<{
        name: string;
        title?: string;
        sourceRole?: string;
        email?: string;
        linkedin?: string;
        confidence?: number;
        verified?: boolean;
      }>;
      emails?: Array<{
        email: string;
        confidence?: number;
        verified?: boolean;
      }>;
    };

    const candidates: Array<{
      name: string;
      title?: string;
      sourceRole?: string;
      email: string;
      linkedin?: string;
      confidence: number;
      verified?: boolean;
      raw?: Record<string, unknown>;
      fromRoleContact: boolean;
    }> = [];

    for (const contact of result.contacts ?? []) {
      if (contact.email) {
        candidates.push({
          name: contact.name || "Unknown",
          title: contact.title,
          sourceRole: contact.sourceRole,
          email: contact.email,
          linkedin: contact.linkedin,
          confidence: contact.confidence ?? 0.5,
          verified: contact.verified,
          raw: contact as Record<string, unknown>,
          fromRoleContact: true,
        });
      }
    }

    for (const emailEntry of result.emails ?? []) {
      if (!emailEntry.email) continue;
      const exists = candidates.some(
        (c) => c.email.toLowerCase() === emailEntry.email.toLowerCase(),
      );
      if (!exists) {
        candidates.push({
          name: emailEntry.email.split("@")[0] ?? "Unknown",
          email: emailEntry.email,
          confidence: emailEntry.confidence ?? 0.5,
          verified: emailEntry.verified,
          raw: emailEntry as Record<string, unknown>,
          fromRoleContact: false,
        });
      }
    }

    let acceptedCount = 0;
    const acceptedForDualWrite: Array<{
      name: string;
      title?: string;
      email: string;
      linkedin?: string;
      confidence: number;
    }> = [];

    const semanticTitleAccepted = args.semanticTitleAccepted
      ? new Set(args.semanticTitleAccepted)
      : undefined;

    for (const candidate of candidates) {
      const evaluation = evaluateContactCandidate(
        {
          name: candidate.name,
          title: candidate.title,
          email: candidate.email,
          linkedin: candidate.linkedin,
          confidence: candidate.confidence,
          verified: candidate.verified,
          raw: candidate.raw,
        },
        {
          requestedRoles,
          companyWebsite: args.companyWebsite,
          acceptedEmailsInSearch: acceptedEmails,
          enableRoleExpansion: args.enableRoleExpansion,
          requireVerifiedEmail: true,
          fromRoleContact: candidate.fromRoleContact,
          sourceRole: candidate.sourceRole,
          roleMatchPatterns: args.roleMatchPatterns,
          semanticTitleAccepted,
        },
      );

      const providerTitle = extractProviderTitle({
        title: candidate.title,
        raw: candidate.raw,
      });
      const storedTitle = resolveDisplayableContactTitle({
        providerTitle,
        matchedRole: evaluation.matchedRole,
        sourceRole: candidate.sourceRole,
      });

      const acceptedForStorage =
        evaluation.accepted && Boolean(storedTitle);
      const status: "accepted" | "rejected" = acceptedForStorage
        ? "accepted"
        : "rejected";
      const rejectionReason = acceptedForStorage
        ? undefined
        : evaluation.rejectionReason ??
          (evaluation.accepted ? "missing_title" : undefined);

      const normalizedEmail =
        evaluation.normalizedEmail ?? candidate.email.toLowerCase().trim();

      const existingContact = await ctx.db
        .query("leadContacts")
        .withIndex("by_search_email", (q) =>
          q.eq("searchId", args.searchId).eq("normalizedEmail", normalizedEmail),
        )
        .first();

      const contactData = {
        leadId: args.leadId,
        searchId: args.searchId,
        userId: args.userId,
        name: candidate.name,
        title: storedTitle,
        email: candidate.email,
        normalizedEmail,
        linkedin: candidate.linkedin,
        confidence: candidate.confidence,
        source: "findymail" as const,
        requestedRoles,
        matchedRole: evaluation.matchedRole,
        titleMatchScore: evaluation.titleMatchScore,
        titleMatchReason: evaluation.titleMatchReason,
        emailVerified: evaluation.emailVerified,
        domainMatchVerified: evaluation.domainMatchVerified,
        status,
        rejectionReason,
        updatedAt: Date.now(),
      };

      if (existingContact) {
        await ctx.db.patch(existingContact._id, {
          ...contactData,
          analysisStatus:
            acceptedForStorage
              ? existingContact.analysisStatus === "completed"
                ? "completed"
                : "pending"
              : "skipped",
        });
      } else {
        await ctx.db.insert("leadContacts", {
          ...contactData,
          analysisStatus: acceptedForStorage ? "pending" : "skipped",
          createdAt: Date.now(),
        });
      }

      if (acceptedForStorage && evaluation.normalizedEmail) {
        acceptedEmails.add(evaluation.normalizedEmail);
        acceptedCount += 1;
        acceptedForDualWrite.push({
          name: candidate.name,
          title: storedTitle,
          email: candidate.email,
          linkedin: candidate.linkedin,
          confidence: candidate.confidence,
        });
      }
    }

    const enrichmentStatus =
      acceptedCount > 0 ? "completed" : "no_contacts_found";

    await ctx.db.patch(args.leadId, {
      enrichmentStatus,
      enrichmentProvider: acceptedCount > 0 ? "findymail" : undefined,
      enrichmentData: args.enrichmentResult,
      enrichmentCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    if (acceptedForDualWrite.length > 0) {
      const emails = acceptedForDualWrite.map((contact) => ({
        email: contact.email,
        type: "work",
        confidence: contact.confidence,
      }));
      const contactInfo = {
        emails,
        contacts: acceptedForDualWrite,
        socialProfiles: {},
      };
      const primaryEmail = extractPrimaryEmail(contactInfo);
      await ctx.db.patch(args.leadId, {
        contactInfo,
        primaryEmail: primaryEmail?.toLowerCase().trim(),
      });
    }

    return { acceptedCount, candidateCount: candidates.length };
  },
});

export const processProspectEmailEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    requestedRoles: v.array(v.string()),
    companyWebsite: v.optional(v.string()),
    prospects: v.array(
      v.object({
        prospectId: v.id("leadProspects"),
        name: v.string(),
        title: v.string(),
        matchedRole: v.optional(v.string()),
        enrichmentResult: v.any(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const acceptedEmails = new Set(
      (
        await ctx.db
          .query("leadContacts")
          .withIndex("by_search_status", (q) =>
            q.eq("searchId", args.searchId).eq("status", "accepted"),
          )
          .collect()
      ).map((c) => c.normalizedEmail),
    );

    let acceptedCount = 0;
    const acceptedForDualWrite: Array<{
      name: string;
      title?: string;
      email: string;
      linkedin?: string;
      confidence: number;
    }> = [];

    for (const prospectInput of args.prospects) {
      const result = prospectInput.enrichmentResult as {
        contacts?: Array<{
          name?: string;
          email?: string;
          confidence?: number;
          verified?: boolean;
          linkedin?: string;
        }>;
        emails?: Array<{
          email: string;
          confidence?: number;
          verified?: boolean;
        }>;
      };

      // FindyMail /search/name: only the email matters; title/name from provider are ignored.
      const emailCandidates: Array<{
        email: string;
        confidence: number;
        linkedin?: string;
      }> = [];
      const seenCandidateEmails = new Set<string>();

      const pushEmail = (raw: string, confidence = 0.7, linkedin?: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (seenCandidateEmails.has(key)) return;
        seenCandidateEmails.add(key);
        emailCandidates.push({ email: trimmed, confidence, linkedin });
      };

      for (const emailEntry of result.emails ?? []) {
        pushEmail(emailEntry.email, emailEntry.confidence ?? 0.7);
      }
      for (const contact of result.contacts ?? []) {
        if (contact.email?.trim()) {
          pushEmail(
            contact.email,
            contact.confidence ?? 0.7,
            contact.linkedin,
          );
        }
      }

      let prospectAccepted = false;

      for (const emailCandidate of emailCandidates) {
        const evaluation = acceptFindyMailNameSearchEmail(emailCandidate.email, {
          acceptedEmailsInSearch: acceptedEmails,
          prospectMatchedRole: prospectInput.matchedRole,
        });

        const storedTitle =
          resolveProspectStoredTitle(prospectInput.title) ?? prospectInput.title.trim();

        const acceptedForStorage = evaluation.accepted;
        const status: "accepted" | "rejected" = acceptedForStorage
          ? "accepted"
          : "rejected";

        const normalizedEmail =
          evaluation.normalizedEmail ??
          emailCandidate.email.toLowerCase().trim();

        const existingContact = await ctx.db
          .query("leadContacts")
          .withIndex("by_search_email", (q) =>
            q.eq("searchId", args.searchId).eq("normalizedEmail", normalizedEmail),
          )
          .first();

        const contactData = {
          leadId: args.leadId,
          searchId: args.searchId,
          userId: args.userId,
          leadProspectId: prospectInput.prospectId,
          name: prospectInput.name,
          title: storedTitle,
          email: emailCandidate.email,
          normalizedEmail,
          linkedin: emailCandidate.linkedin,
          confidence: emailCandidate.confidence,
          source: "findymail" as const,
          requestedRoles: args.requestedRoles,
          matchedRole: evaluation.matchedRole ?? prospectInput.matchedRole,
          titleMatchScore: evaluation.titleMatchScore,
          titleMatchReason: evaluation.titleMatchReason,
          emailVerified: evaluation.emailVerified,
          domainMatchVerified: evaluation.domainMatchVerified,
          status,
          rejectionReason: acceptedForStorage
            ? undefined
            : evaluation.rejectionReason,
          updatedAt: Date.now(),
        };

        if (existingContact) {
          await ctx.db.patch(existingContact._id, {
            ...contactData,
            analysisStatus: acceptedForStorage
              ? existingContact.analysisStatus === "completed"
                ? "completed"
                : "pending"
              : "skipped",
          });
        } else {
          await ctx.db.insert("leadContacts", {
            ...contactData,
            analysisStatus: acceptedForStorage ? "pending" : "skipped",
            createdAt: Date.now(),
          });
        }

        if (acceptedForStorage) {
          acceptedEmails.add(normalizedEmail);
          acceptedCount += 1;
          prospectAccepted = true;
          acceptedForDualWrite.push({
            name: prospectInput.name,
            title: storedTitle,
            email: emailCandidate.email,
            linkedin: emailCandidate.linkedin,
            confidence: emailCandidate.confidence,
          });
          break;
        }
      }

      await ctx.db.patch(prospectInput.prospectId, {
        emailDiscoveryStatus: "completed",
        status: prospectAccepted ? "email_found" : "email_not_found",
        updatedAt: Date.now(),
      });
    }

    const enrichmentStatus =
      acceptedCount > 0 ? "completed" : "no_contacts_found";

    await ctx.db.patch(args.leadId, {
      enrichmentStatus,
      enrichmentProvider: acceptedCount > 0 ? "findymail" : undefined,
      enrichmentCompletedAt: Date.now(),
      updatedAt: Date.now(),
      enrichmentError:
        acceptedCount === 0
          ? "No emails found for discovered prospects"
          : undefined,
    });

    if (acceptedForDualWrite.length > 0) {
      const emails = acceptedForDualWrite.map((contact) => ({
        email: contact.email,
        type: "work",
        confidence: contact.confidence,
      }));
      const contactInfo = {
        emails,
        contacts: acceptedForDualWrite,
        socialProfiles: {},
      };
      const primaryEmail = extractPrimaryEmail(contactInfo);
      await ctx.db.patch(args.leadId, {
        contactInfo,
        primaryEmail: primaryEmail?.toLowerCase().trim(),
      });
    }

    return { acceptedCount, candidateCount: args.prospects.length };
  },
});

export const getContactByAnalysisRequestId = internalQuery({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("leadContacts")
      .filter((q) => q.eq(q.field("analysisRequestId"), args.requestId))
      .first();
  },
});

async function syncLeadAnalysisStatusFromContacts(
  ctx: MutationCtx,
  leadId: Id<"leads">,
) {
  const leadContacts = await ctx.db
    .query("leadContacts")
    .withIndex("by_lead", (q) => q.eq("leadId", leadId))
    .collect();

  const accepted = leadContacts.filter((contact) => contact.status === "accepted");
  if (accepted.length === 0) {
    return;
  }

  const analysisStatus = deriveLeadAnalysisStatusFromContacts(accepted);
  if (!analysisStatus) {
    return;
  }

  await ctx.db.patch(leadId, {
    analysisStatus,
    analysisCompletedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export const markContactAnalysisFailed = internalMutation({
  args: {
    contactId: v.id("leadContacts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) {
      return;
    }

    await ctx.db.patch(args.contactId, {
      analysisStatus: "failed",
      analysisError: args.error,
      updatedAt: Date.now(),
    });

    await syncLeadAnalysisStatusFromContacts(ctx, contact.leadId);
  },
});

export const skipContactAnalysisInternal = internalMutation({
  args: {
    contactId: v.id("leadContacts"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) {
      return { skipped: false, reason: "not_found" };
    }

    await ctx.db.patch(args.contactId, {
      analysisStatus: "skipped",
      analysisError: args.reason,
      updatedAt: Date.now(),
    });

    return { skipped: true, searchId: contact.searchId, userId: contact.userId };
  },
});

export const saveCompanyResearchFromWebhook = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    leadId: v.id("leads"),
    domain: v.string(),
    researchPayload: v.any(),
  },
  handler: async (ctx, args) => {
    const enriched = enrichResearchPayloadForExport(args.researchPayload);
    const normalized = normalizeCompanyResearchPayload(enriched);
    const payloadToStore = normalized ?? enriched;

    const researchId = await ctx.db
      .query("companyResearch")
      .withIndex("by_search_domain", (q) =>
        q.eq("searchId", args.searchId).eq("domain", args.domain),
      )
      .first();

    const now = Date.now();
    let companyResearchId;

    if (researchId) {
      await ctx.db.patch(researchId._id, {
        researchPayload: payloadToStore,
        status: "completed",
        updatedAt: now,
      });
      companyResearchId = researchId._id;
    } else {
      companyResearchId = await ctx.db.insert("companyResearch", {
        searchId: args.searchId,
        userId: args.userId,
        leadId: args.leadId,
        domain: args.domain,
        researchPayload: payloadToStore,
        status: "completed",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
    }

    const contacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    for (const contact of contacts) {
      const lead = await ctx.db.get(contact.leadId);
      if (!lead?.website) continue;
      const contactDomain = extractDomainFromWebsite(lead.website);
      if (contactDomain !== args.domain) continue;

      await ctx.db.patch(contact._id, {
        companyResearchId,
        updatedAt: now,
      });
    }

    return companyResearchId;
  },
});

/** Batch-load company research payloads for CSV export. */
export const getCompanyResearchPayloadsForExport = internalQuery({
  args: { ids: v.array(v.id("companyResearch")) },
  handler: async (ctx, args) => {
    const rows: Array<{
      _id: Id<"companyResearch">;
      researchPayload: unknown;
    }> = [];

    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.status !== "completed") {
        continue;
      }
      rows.push({ _id: doc._id, researchPayload: doc.researchPayload });
    }

    return rows;
  },
});

/** Domains that need company research before per-contact analysis fan-out. */
export const getDomainsNeedingCompanyResearch = internalQuery({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("leadContacts")
      .withIndex("by_search_status", (q) =>
        q.eq("searchId", args.searchId).eq("status", "accepted"),
      )
      .collect();

    const pendingAnalysis = contacts.filter((contact) => {
      const pending =
        !contact.analysisStatus ||
        contact.analysisStatus === "pending" ||
        contact.analysisStatus === "failed" ||
        contact.analysisStatus === "timeout";
      return pending && contact.email.trim().length > 0;
    });

    const domainsSeen = new Set<string>();
    const domainsNeeded: Array<{
      domain: string;
      leadId: Id<"leads">;
      businessName: string;
      location: string;
      industry: string;
    }> = [];

    for (const contact of pendingAnalysis) {
      const lead = await ctx.db.get(contact.leadId);
      if (!lead?.website) continue;

      const domain = extractDomainFromWebsite(lead.website);
      if (!domain || domainsSeen.has(domain)) continue;

      const existing = await ctx.db
        .query("companyResearch")
        .withIndex("by_search_domain", (q) =>
          q.eq("searchId", args.searchId).eq("domain", domain),
        )
        .first();

      if (
        existing?.status === "completed" &&
        isValidCompanyResearchCache(existing.researchPayload)
      ) {
        domainsSeen.add(domain);
        continue;
      }

      domainsSeen.add(domain);
      const location = `${lead.location.city || ""}, ${lead.location.state || ""}`
        .trim()
        .replace(/^,\s*/, "");

      domainsNeeded.push({
        domain,
        leadId: lead._id,
        businessName: lead.businessName,
        location,
        industry: lead.category || "",
      });
    }

    return domainsNeeded;
  },
});

export const getEnrichmentCacheEntry = internalQuery({
  args: {
    searchId: v.id("searches"),
    domain: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("enrichmentCache")
      .withIndex("by_provider_domain_search", (q) =>
        q
          .eq("provider", "findymail")
          .eq("domain", args.domain)
          .eq("searchId", args.searchId),
      )
      .first();
  },
});

export const cacheEnrichmentData = internalMutation({
  args: {
    searchId: v.id("searches"),
    domain: v.string(),
    enrichmentData: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("enrichmentCache")
      .withIndex("by_provider_domain_search", (q) =>
        q
          .eq("provider", "findymail")
          .eq("domain", args.domain)
          .eq("searchId", args.searchId),
      )
      .first();

    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;

    if (existing) {
      await ctx.db.patch(existing._id, {
        enrichmentData: args.enrichmentData,
        expiresAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("enrichmentCache", {
      provider: "findymail",
      domain: args.domain,
      searchId: args.searchId,
      enrichmentData: args.enrichmentData,
      createdAt: now,
      expiresAt,
    });
  },
});
