import { describe, expect, it } from "vitest";
import {
  acceptFindyMailNameSearchEmail,
  evaluateContactCandidate,
  evaluateProspectEmailCandidate,
  extractProviderTitle,
  resolveDisplayableContactTitle,
  resolveProspectStoredTitle,
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

  it("accepts FindyMail role contact without provider job title when queried role matches", () => {
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
        fromRoleContact: true,
        sourceRole: "CEO",
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.matchedRole).toBe("CEO");
    expect(result.titleMatchReason).toBe("queried_role_trust");
  });

  it("accepts untitled FindyMail role contact with enableRoleExpansion false (production path)", () => {
    const result = evaluateContactCandidate(
      {
        name: "Julian Lubke",
        email: "julian@deeploi.io",
        verified: true,
        confidence: 0,
      },
      {
        requestedRoles: ["Ceo", "Founder", "Owner"],
        companyWebsite: "https://www.deeploi.io/de",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: false,
        requireVerifiedEmail: true,
        fromRoleContact: true,
        sourceRole: "ceo",
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.titleMatchReason).toBe("queried_role_trust");
    expect(result.rejectionReason).toBeUndefined();
  });

  it("rejects untitled FindyMail role contact without a queried role fallback", () => {
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
        fromRoleContact: true,
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("missing_title");
  });

  it("accepts contact from people-discovery prospect with known title", () => {
    const result = evaluateContactCandidate(
      {
        name: "John Doe",
        email: "john@acme.com",
        verified: true,
      },
      {
        requestedRoles: ["Founder"],
        companyWebsite: "https://acme.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
        fromProspect: true,
        prospectTitle: "CEO",
        prospectMatchedRole: "Founder",
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.titleMatchReason).toBe("prospect_discovery");
    expect(result.emailVerified).toBe(true);
    expect(result.domainMatchVerified).toBe(true);
  });

  it("evaluateProspectEmailCandidate accepts without verified flag or domain match", () => {
    const result = evaluateProspectEmailCandidate("owner@gmail.com", {
      acceptedEmailsInSearch: new Set(),
      prospectMatchedRole: "Owner",
    });

    expect(result.accepted).toBe(true);
    expect(result.rejectionReason).toBeUndefined();
    expect(result.emailVerified).toBe(true);
    expect(result.domainMatchVerified).toBe(true);
    expect(result.matchedRole).toBe("Owner");
  });

  it("evaluateProspectEmailCandidate rejects missing email only", () => {
    expect(
      evaluateProspectEmailCandidate("", {
        acceptedEmailsInSearch: new Set(),
      }).rejectionReason,
    ).toBe("missing_email");
    expect(
      evaluateProspectEmailCandidate(undefined, {
        acceptedEmailsInSearch: new Set(),
      }).rejectionReason,
    ).toBe("missing_email");
  });

  it("evaluateProspectEmailCandidate rejects duplicate email in search", () => {
    const result = evaluateProspectEmailCandidate("jane@acme.com", {
      acceptedEmailsInSearch: new Set(["jane@acme.com"]),
    });
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("duplicate_email");
  });

  it("accepts when provider title semantically matches the FindyMail queried role", () => {
    const result = evaluateContactCandidate(
      {
        name: "Jane Doe",
        title: "DevOps practitioner",
        email: "jane@acme.com",
        verified: true,
      },
      {
        requestedRoles: ["DevOps Engineer"],
        companyWebsite: "https://acme.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
        fromRoleContact: true,
        sourceRole: "DevOps Engineer",
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.titleMatchReason).toBe("queried_role_match");
  });

  it("accepts Co-Founder provider title when user requested Founder", () => {
    const result = evaluateContactCandidate(
      {
        name: "Jane Doe",
        title: "Co-Founder",
        email: "jane@acme.com",
        verified: true,
      },
      {
        requestedRoles: ["Founder"],
        companyWebsite: "https://acme.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.titleMatchScore ?? 0).toBeGreaterThanOrEqual(
      TITLE_MATCH_ACCEPT_THRESHOLD,
    );
  });

  it("rejects provider title that does not match requested roles", () => {
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
        fromRoleContact: true,
        sourceRole: "CEO",
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("title_mismatch");
  });

  it("accepts named role contact with matching title and domain", () => {
    const result = evaluateContactCandidate(
      {
        name: "Thalia Castillo",
        title: "CEO",
        email: "thalia.castillo@karmaclubchicago.com",
        verified: true,
      },
      {
        requestedRoles: ["CEO", "Owner"],
        companyWebsite: "https://www.karmaclubchicago.com",
        acceptedEmailsInSearch: new Set(),
        enableRoleExpansion: true,
        requireVerifiedEmail: true,
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

  it("resolveProspectStoredTitle uses website title only, never UI matched role", () => {
    expect(resolveProspectStoredTitle("General Manager")).toBe("General Manager");
    expect(resolveProspectStoredTitle("")).toBeUndefined();
    expect(resolveProspectStoredTitle(undefined)).toBeUndefined();
  });

  it("resolveDisplayableContactTitle prefers provider title then matchedRole then sourceRole", () => {
    expect(
      resolveDisplayableContactTitle({
        providerTitle: "CMO",
        matchedRole: "CEO",
        sourceRole: "Owner",
      }),
    ).toBe("CMO");
    expect(
      resolveDisplayableContactTitle({
        matchedRole: "VP Marketing",
        sourceRole: "Marketing",
      }),
    ).toBe("VP Marketing");
    expect(
      resolveDisplayableContactTitle({ sourceRole: "CEO" }),
    ).toBe("CEO");
    expect(resolveDisplayableContactTitle({})).toBeUndefined();
  });

  it("accepts related marketing decision-makers when user requested Marketing Manager", () => {
    const titles = [
      "VP of Marketing",
      "Marketing Director",
      "Head of Marketing",
      "Chief Marketing Officer",
    ];

    for (const title of titles) {
      const match = scoreTitleAgainstRoles(title, ["Marketing Manager"], true);
      expect(match.score).toBeGreaterThanOrEqual(TITLE_MATCH_ACCEPT_THRESHOLD);
    }
  });

  it("accepts DevOps provider titles when user requested DevOps Engineer", () => {
    const titles = [
      "Senior DevOps Engineer",
      "DevOps practitioner",
      "DevOps Developer",
    ];

    for (const title of titles) {
      const result = evaluateContactCandidate(
        {
          name: "Jane Doe",
          title,
          email: "jane@acme.com",
          verified: true,
        },
        {
          requestedRoles: ["DevOps Engineer"],
          companyWebsite: "https://acme.com",
          acceptedEmailsInSearch: new Set(),
          enableRoleExpansion: true,
          requireVerifiedEmail: true,
        },
      );

      expect(result.accepted).toBe(true);
      expect(result.titleMatchScore ?? 0).toBeGreaterThanOrEqual(
        TITLE_MATCH_ACCEPT_THRESHOLD,
      );
    }
  });
});
