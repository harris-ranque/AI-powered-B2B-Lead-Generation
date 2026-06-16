import { describe, expect, it } from "vitest";
import {
  extractContactDetails,
  hasWrittenEmail,
  formatExportPhone,
  classifyContactExportReadiness,
  summarizeExportReadiness,
  isContactEmailExportable,
  isContactExportable,
  isContactFullyExportable,
  isLeadExportable,
  noExportableLeadsMessage,
  resolveContactExportTitle,
  type ExportableLead,
} from "../../convex/lib/exportEligibility";
import { extractProviderTitle } from "../../convex/lib/contactAcceptance";

describe("exportEligibility", () => {
  it("uses legacy lead.email when contactInfo.emails is missing", () => {
    const lead: ExportableLead = {
      email: "legacy@example.com",
    };

    expect(isLeadExportable(lead)).toBe(true);
    expect(extractContactDetails(lead).email).toBe("legacy@example.com");
  });

  it("uses contactInfo.contacts email when top-level email is missing", () => {
    const lead: ExportableLead = {
      contactInfo: {
        contacts: [{ name: "Alex Johnson", email: "alex@company.com" }],
      },
    };

    const contact = extractContactDetails(lead);
    expect(isLeadExportable(lead)).toBe(true);
    expect(contact.email).toBe("alex@company.com");
    expect(contact.firstName).toBe("Alex");
  });

  it("uses contactInfo.emails array as fallback", () => {
    const lead: ExportableLead = {
      contactInfo: {
        emails: [{ email: "team@company.com" }],
      },
    };

    expect(isLeadExportable(lead)).toBe(true);
    expect(extractContactDetails(lead).email).toBe("team@company.com");
  });

  it("rejects leads with failed analysis even if they have email", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
      analysisStatus: "failed",
    };

    expect(isLeadExportable(lead)).toBe(false);
  });

  it("accepts completed leads with written email content", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
      analysisStatus: "completed",
      emailContent: { subject: "Hello", body: "Body" },
    };

    expect(isLeadExportable(lead)).toBe(true);
  });

  it("rejects completed leads without written email content", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
      analysisStatus: "completed",
    };

    expect(isLeadExportable(lead)).toBe(false);
  });

  it("accepts leads with undefined analysisStatus", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
    };

    expect(isLeadExportable(lead)).toBe(true);
  });

  it("hasWrittenEmail requires subject or body", () => {
    expect(hasWrittenEmail({ subject: "Hi" })).toBe(true);
    expect(hasWrittenEmail({ body: "Hello" })).toBe(true);
    expect(hasWrittenEmail({ subject: "", body: "" })).toBe(false);
    expect(hasWrittenEmail(undefined)).toBe(false);
  });

  it("exports only completed contacts with written email content", () => {
    expect(
      isContactEmailExportable({
        email: "alex@company.com",
        analysisStatus: "completed",
        emailContent: { subject: "Hi Alex", body: "..." },
        status: "accepted",
      }),
    ).toBe(true);
  });

  it("rejects contacts with failed analysis", () => {
    expect(
      isContactEmailExportable({
        email: "alex@company.com",
        analysisStatus: "failed",
        status: "accepted",
      }),
    ).toBe(false);
  });

  it("rejects contacts still pending or scheduled without written email", () => {
    expect(
      isContactEmailExportable({
        email: "alex@company.com",
        analysisStatus: "scheduled",
        status: "accepted",
      }),
    ).toBe(false);
    expect(
      isContactEmailExportable({
        email: "alex@company.com",
        analysisStatus: "completed",
        status: "accepted",
      }),
    ).toBe(false);
  });

  it("requires title and research for full CSV export (phone optional)", () => {
    const baseContact = {
      email: "alex@company.com",
      analysisStatus: "completed",
      emailContent: { subject: "Hi", body: "Body" },
      status: "accepted",
      title: "VP Marketing",
      aiAnalysis: {
        leadAnalysis: {
          research_metadata: {
            comprehensive_report: "Full report",
            citations: ["https://example.com"],
            confidence_score: 0.85,
          },
        },
      },
    };
    const researchPayload = {
      raw_data: {
        research_metadata: {
          comprehensive_report: "Full report",
          citations: ["https://example.com"],
          confidence_score: 0.85,
        },
      },
    };

    expect(
      isContactFullyExportable(baseContact, {
        companyResearchPayload: researchPayload,
      }),
    ).toBe(true);
    expect(
      isContactExportable(baseContact, {
        companyResearchPayload: researchPayload,
      }),
    ).toBe(true);
    expect(
      isContactFullyExportable(baseContact, {
        companyResearchPayload: researchPayload,
      }),
    ).toBe(true);
    expect(
      isContactFullyExportable(
        { ...baseContact, title: "" },
        { companyResearchPayload: researchPayload },
      ),
    ).toBe(false);
  });

  it("classifies export readiness blockers", () => {
    const researchPayload = {
      raw_data: {
        research_metadata: {
          comprehensive_report: "Full report",
          citations: ["https://example.com"],
          confidence_score: 0.85,
        },
      },
    };

    expect(
      classifyContactExportReadiness({
        email: "a@co.com",
        analysisStatus: "pending",
        status: "accepted",
      }),
    ).toBe("awaiting_email_writing");

    expect(
      classifyContactExportReadiness(
        {
          email: "b@co.com",
          analysisStatus: "completed",
          emailContent: { subject: "Hi", body: "Body" },
          status: "accepted",
          title: "CEO",
        },
        { companyResearchPayload: researchPayload },
      ),
    ).toBe("exportable");

    expect(
      classifyContactExportReadiness(
        {
          email: "c@co.com",
          analysisStatus: "completed",
          emailContent: { subject: "Hi", body: "Body" },
          status: "accepted",
          title: "",
        },
        { companyResearchPayload: researchPayload },
      ),
    ).toBe("missing_title");

    const summary = summarizeExportReadiness(
      [
        {
          email: "a@co.com",
          analysisStatus: "pending",
          status: "accepted",
        },
        {
          email: "b@co.com",
          analysisStatus: "completed",
          emailContent: { subject: "Hi", body: "Body" },
          status: "accepted",
          title: "VP",
        },
      ],
      new Map(),
      () => undefined,
    );
    expect(summary.awaitingEmailWriting).toBe(1);
    expect(summary.incompleteResearch).toBe(1);
  });

  it("formatExportPhone uses placeholder when phone is missing", () => {
    expect(formatExportPhone(undefined)).toBe("phone number not available.");
    expect(formatExportPhone("  ")).toBe("phone number not available.");
    expect(formatExportPhone("+1 555-0100")).toBe("+1 555-0100");
  });

  it("extractProviderTitle reads job title from raw payload", () => {
    expect(
      extractProviderTitle({
        raw: { job_title: "Chief Marketing Officer" },
      }),
    ).toBe("Chief Marketing Officer");
  });

  it("resolveContactExportTitle uses provider title and matchedRole fallback", () => {
    expect(resolveContactExportTitle({ title: "VP Sales" })).toBe("VP Sales");
    expect(resolveContactExportTitle({ matchedRole: "CMO" })).toBe("CMO");
    expect(resolveContactExportTitle({})).toBe("");
  });

  it("message mentions email when all leads lack email", () => {
    const msg = noExportableLeadsMessage({ total: 10, withoutEmail: 10, analysisFailed: 0 });
    expect(msg).toContain("no usable email address");
    expect(msg).not.toContain("failed analysis");
  });

  it("message mentions analysis when all leads failed analysis", () => {
    const msg = noExportableLeadsMessage({ total: 15, withoutEmail: 0, analysisFailed: 15 });
    expect(msg).toContain("failed analysis");
    expect(msg).not.toContain("email");
  });

  it("message mentions both reasons when mixed", () => {
    const msg = noExportableLeadsMessage({ total: 42, withoutEmail: 10, analysisFailed: 32 });
    expect(msg).toContain("10 had no usable email address");
    expect(msg).toContain("32 had failed analysis");
  });

  it("message handles zero total leads", () => {
    const msg = noExportableLeadsMessage({ total: 0, withoutEmail: 0, analysisFailed: 0 });
    expect(msg).toBe("No leads found for export");
  });

  it("message explains duplicate skips with prior exportable contacts", () => {
    const msg = noExportableLeadsMessage(
      { total: 0, withoutEmail: 0, analysisFailed: 0 },
      { duplicateSkips: 129, priorSearchExportable: 5 },
    );
    expect(msg).toContain("already in your account");
    expect(msg).toContain("5 exportable contacts");
  });

  it("message explains duplicate skips without exportable contacts", () => {
    const msg = noExportableLeadsMessage(
      { total: 0, withoutEmail: 0, analysisFailed: 0 },
      { duplicateSkips: 50, priorSearchExportable: 0 },
    );
    expect(msg).toContain("already in your account");
    expect(msg).toContain("none have exportable contacts yet");
  });
});
