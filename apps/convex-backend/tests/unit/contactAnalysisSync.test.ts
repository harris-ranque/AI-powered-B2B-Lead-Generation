import { describe, expect, it } from "vitest";
import { deriveLeadAnalysisStatusFromContacts } from "../../convex/lib/contactAnalysisSync";

describe("deriveLeadAnalysisStatusFromContacts", () => {
  it("returns null while any accepted contact is still in flight", () => {
    expect(
      deriveLeadAnalysisStatusFromContacts([
        { status: "accepted", analysisStatus: "completed" },
        { status: "accepted", analysisStatus: "scheduled" },
      ]),
    ).toBeNull();
  });

  it("returns completed when all accepted contacts are terminal and at least one completed", () => {
    expect(
      deriveLeadAnalysisStatusFromContacts([
        { status: "accepted", analysisStatus: "completed" },
        { status: "accepted", analysisStatus: "failed" },
      ]),
    ).toBe("completed");
  });

  it("returns skipped when all accepted contacts are skipped", () => {
    expect(
      deriveLeadAnalysisStatusFromContacts([
        { status: "accepted", analysisStatus: "skipped" },
        { status: "accepted", analysisStatus: "skipped" },
      ]),
    ).toBe("skipped");
  });

  it("returns failed when all terminal without any completed", () => {
    expect(
      deriveLeadAnalysisStatusFromContacts([
        { status: "accepted", analysisStatus: "failed" },
        { status: "accepted", analysisStatus: "timeout" },
      ]),
    ).toBe("failed");
  });

  it("ignores non-accepted contacts", () => {
    expect(
      deriveLeadAnalysisStatusFromContacts([
        { status: "rejected", analysisStatus: "scheduled" },
        { status: "accepted", analysisStatus: "completed" },
      ]),
    ).toBe("completed");
  });
});
