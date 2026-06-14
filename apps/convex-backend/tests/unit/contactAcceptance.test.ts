import { describe, expect, it } from "vitest";
import {
  evaluateContactCandidate,
  scoreTitleAgainstRoles,
  TITLE_MATCH_ACCEPT_THRESHOLD,
} from "../../convex/lib/contactAcceptance";

describe("contactAcceptance", () => {
  it("accepts a verified contact with matching title and domain", () => {
    const result = evaluateContactCandidate(
      {
        name: "Jane Doe",
        title: "Chief Marketing Officer",
        email: "jane@acme.com",
        verified: true,
        confidence: 0.9,
      },
      {
        requestedRoles: ["Head of Marketing"],
        companyWebsite: "https://www.acme.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.domainMatchVerified).toBe(true);
    expect(result.emailVerified).toBe(true);
    expect(result.titleMatchScore ?? 0).toBeGreaterThanOrEqual(
      TITLE_MATCH_ACCEPT_THRESHOLD,
    );
  });

  it("rejects wrong-role contact even with valid email", () => {
    const result = evaluateContactCandidate(
      {
        name: "Bob Smith",
        title: "Junior Accountant",
        email: "bob@acme.com",
        verified: true,
      },
      {
        requestedRoles: ["CEO", "Founder"],
        companyWebsite: "https://acme.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: false,
        requireVerifiedEmail: true,
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("title_mismatch");
  });

  it("rejects duplicate email in search", () => {
    const result = evaluateContactCandidate(
      {
        name: "Jane",
        title: "CEO",
        email: "jane@acme.com",
        verified: true,
      },
      {
        requestedRoles: ["CEO"],
        companyWebsite: "https://acme.com",
        acceptedEmailsInSearch: new Set(["jane@acme.com"]),
        enableRoleExpansion: false,
        requireVerifiedEmail: true,
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("duplicate_email");
  });

  it("expands marketing manager to marketing director titles", () => {
    const match = scoreTitleAgainstRoles(
      "VP of Marketing",
      ["Marketing Manager"],
      true,
    );
    expect(match.score).toBeGreaterThanOrEqual(TITLE_MATCH_ACCEPT_THRESHOLD);
  });
});
