import { describe, expect, it } from "vitest";
import { summarizeAcceptedContactAnalysis } from "../../convex/lib/analysisProgress";

describe("summarizeAcceptedContactAnalysis", () => {
  it("counts only accepted contacts with email as the write-emails total", () => {
    const summary = summarizeAcceptedContactAnalysis([
      {
        status: "accepted",
        email: "a@co.com",
        analysisStatus: "pending",
      },
      {
        status: "accepted",
        email: "b@co.com",
        analysisStatus: "completed",
        emailContent: { subject: "Hi", body: "Body" },
      },
      {
        status: "accepted",
        email: "",
        analysisStatus: "pending",
      },
      {
        status: "rejected",
        email: "c@co.com",
        analysisStatus: "pending",
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.personalized).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.isComplete).toBe(false);
  });

  it("marks complete when all eligible contacts are terminal", () => {
    const summary = summarizeAcceptedContactAnalysis([
      {
        status: "accepted",
        email: "a@co.com",
        analysisStatus: "completed",
        emailContent: { subject: "Hi" },
      },
      {
        status: "accepted",
        email: "b@co.com",
        analysisStatus: "skipped",
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.personalized).toBe(1);
    expect(summary.inProgress).toBe(0);
    expect(summary.isComplete).toBe(true);
  });
});
