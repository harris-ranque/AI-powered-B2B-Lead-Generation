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

  it("accepts FindyMail role contact with person name when verification metadata is missing", () => {
    const result = evaluateContactCandidate(
      {
        name: "Thalia Castillo",
        email: "thalia.castillo@karmaclubchicago.com",
        confidence: 0,
      },
      {
        requestedRoles: ["CEO", "Owner"],
        companyWebsite: "https://www.karmaclubchicago.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
        trustNamedRoleContacts: true,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.emailVerified).toBe(true);
    expect(result.domainMatchVerified).toBe(true);
  });

  it("accepts named role contact with matching title and domain", () => {
    const result = evaluateContactCandidate(
      {
        name: "Thalia Castillo",
        title: "CEO",
        email: "thalia.castillo@karmaclubchicago.com",
        confidence: 0,
      },
      {
        requestedRoles: ["CEO", "Owner"],
        companyWebsite: "https://www.karmaclubchicago.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
        trustNamedRoleContacts: true,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.emailVerified).toBe(true);
    expect(result.domainMatchVerified).toBe(true);
  });

  it("accepts contact when confidence is high enough without explicit verified flag", () => {
    const result = evaluateContactCandidate(
      {
        name: "Jane Doe",
        title: "CEO",
        email: "jane@acme.com",
        confidence: 0.85,
      },
      {
        requestedRoles: ["CEO"],
        companyWebsite: "https://acme.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: false,
        requireVerifiedEmail: true,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.emailVerified).toBe(true);
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
