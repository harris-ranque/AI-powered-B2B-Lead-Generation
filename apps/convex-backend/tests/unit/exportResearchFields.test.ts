import { describe, expect, it } from "vitest";
import {
  enrichResearchPayloadForExport,
  hasCompleteExportResearch,
  mergeCompanyResearchPayloadForWebhook,
  resolveExportResearchFields,
} from "../../convex/lib/exportResearchFields";

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

  it("supports people discovery payloads with scraped website citations", () => {
    const result = resolveExportResearchFields(undefined, {
      company_overview: "Team found on website",
      confidence_score: 0.75,
      raw_data: {
        company_overview: "Team found on website",
        people_discovery: true,
        research_metadata: {
          comprehensive_report: "Team found on website",
          citations: [{ url: "https://cafe.com/team", title: "Company website" }],
          confidence_score: 0.75,
        },
        raw: {
          website: {
            scraped_urls: ["https://cafe.com/team [http]"],
          },
        },
      },
    });

    expect(result.fullResearchReport).toBe("Team found on website");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(hasCompleteExportResearch(result)).toBe(true);
  });

  it("hasCompleteExportResearch requires report, citations, and numeric confidence", () => {
    expect(
      hasCompleteExportResearch({
        fullResearchReport: "Report",
        citations: ["https://a.com"],
        researchConfidenceScore: 0.7,
      }),
    ).toBe(true);
    expect(
      hasCompleteExportResearch({
        fullResearchReport: "",
        citations: ["https://a.com"],
        researchConfidenceScore: 0.7,
      }),
    ).toBe(false);
    expect(
      hasCompleteExportResearch({
        fullResearchReport: "Report",
        citations: [],
        researchConfidenceScore: 0.7,
      }),
    ).toBe(false);
  });

  it("enrichResearchPayloadForExport normalizes webhook-shaped payloads", () => {
    const enriched = enrichResearchPayloadForExport({
      company_overview: "Summary",
      raw_data: {
        research_summary: "Summary",
        research_metadata: {
          langchain_tavily_result: {
            results: [{ url: "https://tavily.com/1" }],
          },
        },
      },
      confidence_score: 0.66,
    }) as {
      raw_data: {
        research_metadata: {
          comprehensive_report: string;
          citations: string[];
          confidence_score: number;
        };
      };
    };

    expect(enriched.raw_data.research_metadata.comprehensive_report).toBe(
      "Summary",
    );
    expect(enriched.raw_data.research_metadata.citations).toEqual([
      "https://tavily.com/1",
    ]);
    expect(enriched.raw_data.research_metadata.confidence_score).toBe(0.66);
  });

  it("mergeCompanyResearchPayloadForWebhook preserves people-discovery citations", () => {
    const existing = {
      company_overview: "2 team members found on website",
      confidence_score: 0.75,
      raw_data: {
        people_discovery: true,
        research_metadata: {
          comprehensive_report: "2 team members found on website",
          citations: [{ url: "https://cafe.com/team", title: "Company website" }],
          confidence_score: 0.75,
          source: "people_discovery",
        },
      },
    };
    const incoming = {
      company_overview: "UCSF student housing operations overview",
      raw_data: {
        company_overview: "UCSF student housing operations overview",
        research_metadata: {},
      },
      confidence_score: 0.52,
    };

    const merged = mergeCompanyResearchPayloadForWebhook(
      existing,
      incoming,
    ) as {
      company_overview: string;
      raw_data: {
        people_discovery: boolean;
        research_metadata: {
          citations: Array<{ url: string }>;
          comprehensive_report: string;
        };
      };
    };

    expect(merged.company_overview).toContain("UCSF");
    expect(merged.raw_data.people_discovery).toBe(true);
    expect(merged.raw_data.research_metadata.citations).toEqual([
      { url: "https://cafe.com/team", title: "Company website" },
    ]);
    expect(merged.raw_data.research_metadata.comprehensive_report).toContain(
      "UCSF",
    );
  });
});
