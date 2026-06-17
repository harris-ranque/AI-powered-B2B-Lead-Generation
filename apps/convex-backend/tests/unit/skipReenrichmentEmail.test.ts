import { describe, expect, it } from "vitest";
import { leadRecordHasStoredEmail } from "../../convex/lib/deduplication";

describe("leadRecordHasStoredEmail", () => {
  it("returns true when primaryEmail is set", () => {
    expect(
      leadRecordHasStoredEmail({ primaryEmail: "ceo@example.com" }),
    ).toBe(true);
  });

  it("returns true when contactInfo has emails", () => {
    expect(
      leadRecordHasStoredEmail({
        contactInfo: {
          emails: [{ email: "founder@company.com" }],
        },
      }),
    ).toBe(true);
  });

  it("returns false when no email is stored", () => {
    expect(leadRecordHasStoredEmail({})).toBe(false);
    expect(
      leadRecordHasStoredEmail({
        contactInfo: { emails: [] },
      }),
    ).toBe(false);
  });

  it("ignores invalid email strings", () => {
    expect(
      leadRecordHasStoredEmail({
        primaryEmail: "not-an-email",
        contactInfo: { emails: [{ email: "also-bad" }] },
      }),
    ).toBe(false);
  });
});
