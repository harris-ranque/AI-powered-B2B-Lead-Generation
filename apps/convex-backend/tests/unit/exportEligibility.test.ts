import { describe, expect, it } from "vitest";
import {
  extractContactDetails,
  hasWrittenEmail,
  isContactExportable,
  isLeadExportable,
  noExportableLeadsMessage,
  resolveContactExportTitle,
  type ExportableLead,
} from "../../convex/lib/exportEligibility";

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
      isContactExportable({
        email: "alex@company.com",
        analysisStatus: "completed",
        emailContent: { subject: "Hi Alex", body: "..." },
        status: "accepted",
      }),
    ).toBe(true);
  });

  it("rejects contacts with failed analysis", () => {
    expect(
      isContactExportable({
        email: "alex@company.com",
        analysisStatus: "failed",
        status: "accepted",
      }),
    ).toBe(false);
  });

  it("rejects contacts still pending or scheduled without written email", () => {
    expect(
      isContactExportable({
        email: "alex@company.com",
        analysisStatus: "scheduled",
        status: "accepted",
      }),
    ).toBe(false);
    expect(
      isContactExportable({
        email: "alex@company.com",
        analysisStatus: "completed",
        status: "accepted",
      }),
    ).toBe(false);
  });

  it("resolveContactExportTitle prefers title then matchedRole", () => {
    expect(
      resolveContactExportTitle({ title: "VP Sales", matchedRole: "Owner" }),
    ).toBe("VP Sales");
    expect(resolveContactExportTitle({ matchedRole: "Owner" })).toBe("Owner");
    expect(resolveContactExportTitle({})).toBe("");
  });

  it("resolveContactExportTitle falls back to first requestedRole", () => {
    expect(
      resolveContactExportTitle({
        requestedRoles: ["Marketing Manager", "Owner"],
      }),
    ).toBe("Marketing Manager");
    expect(
      resolveContactExportTitle({
        matchedRole: "",
        requestedRoles: ["", "Owner"],
      }),
    ).toBe("Owner");
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
