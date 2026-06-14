import { describe, expect, it } from "vitest";
import {
  extractContactDetails,
  isLeadExportable,
  noExportableLeadsMessage,
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

  it("accepts leads with non-failed analysisStatus", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
      analysisStatus: "completed",
    };

    expect(isLeadExportable(lead)).toBe(true);
  });

  it("accepts leads with undefined analysisStatus", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
    };

    expect(isLeadExportable(lead)).toBe(true);
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
