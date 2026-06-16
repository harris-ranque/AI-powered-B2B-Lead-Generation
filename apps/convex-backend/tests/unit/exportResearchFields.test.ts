import { describe, expect, it } from "vitest";
import { resolveExportResearchFields } from "../../convex/lib/exportResearchFields";

describe("resolveExportResearchFields", () => {
  it("reads citations from companyResearch when contact analysis is slimmed", () => {
    const result = resolveExportResearchFields(
      { company_profile: "Short summary" },
      {
        company_overview: "Overview",
        confidence_score: 0.82,
        raw_data: {
          research_metadata: {
            comprehensive_report: "Full Perplexity report body",
            citations: ["https://example.com/news", "https://example.com/about"],
            confidence_score: 0.9,
          },
        },
      },
    );

    expect(result.fullResearchReport).toBe("Full Perplexity report body");
    expect(result.citations).toEqual([
      "https://example.com/news",
      "https://example.com/about",
    ]);
    expect(result.researchConfidenceScore).toBe(0.9);
  });

  it("falls back to Tavily result URLs when citations array is empty", () => {
    const result = resolveExportResearchFields(undefined, {
      raw_data: {
        research_metadata: {
          langchain_tavily_result: {
            results: [
              { url: "https://tavily.com/1", title: "One" },
              { url: "https://tavily.com/2", title: "Two" },
            ],
          },
        },
      },
    });

    expect(result.citations).toEqual([
      "https://tavily.com/1",
      "https://tavily.com/2",
    ]);
  });

  it("prefers leadAnalysis research_metadata when present", () => {
    const result = resolveExportResearchFields(
      {
        research_metadata: {
          citations: ["https://lead.com"],
          comprehensive_report: "From lead",
        },
      },
      {
        raw_data: {
          research_metadata: {
            citations: ["https://company.com"],
            comprehensive_report: "From company",
          },
        },
      },
    );

    expect(result.fullResearchReport).toBe("From lead");
    expect(result.citations).toEqual(["https://lead.com"]);
  });
});
