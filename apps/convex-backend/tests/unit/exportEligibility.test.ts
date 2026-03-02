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

  it("exports leads with email even when analysis failed", () => {
    const lead: ExportableLead = {
      email: "valid@example.com",
      analysisStatus: "failed",
    };

    expect(isLeadExportable(lead)).toBe(true);
  });

  it("returns hardened no-exportable-leads message", () => {
    expect(noExportableLeadsMessage(42)).toContain(
      "none had usable email addresses",
    );
  });
});
