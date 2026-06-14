import { describe, expect, it } from "vitest";
import {
  slimContactAiAnalysisForStorage,
  slimLeadAnalysisForContactStorage,
} from "../../convex/lib/contactAnalysisStorage";

describe("contactAnalysisStorage", () => {
  it("removes large research blobs from leadAnalysis", () => {
    const slim = slimLeadAnalysisForContactStorage({
      company_overview: "Short overview",
      comprehensive_report: "very long report",
      research_metadata: { citations: ["https://example.com"] },
      error: "Analysis failed",
    });

    expect(slim).toEqual({
      company_overview: "Short overview",
      error: "Analysis failed",
    });
  });

  it("trims very long summaries", () => {
    const longSummary = "a".repeat(3000);
    const slim = slimLeadAnalysisForContactStorage({
      research_summary: longSummary,
    });

    expect(slim?.research_summary).toHaveLength(2003);
    expect(String(slim?.research_summary).endsWith("...")).toBe(true);
  });

  it("slims nested aiAnalysis payloads", () => {
    const slim = slimContactAiAnalysisForStorage({
      relevanceScore: 0.8,
      painPoints: ["growth"],
      valueMatches: ["fit"],
      leadAnalysis: {
        comprehensive_report: "huge",
        company_overview: "Overview",
      },
    });

    expect(slim.leadAnalysis).toEqual({ company_overview: "Overview" });
  });
});
