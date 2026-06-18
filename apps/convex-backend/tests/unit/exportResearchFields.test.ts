import { describe, expect, it } from "vitest";
import {
  buildWebhookResearchPayload,
  enrichResearchPayloadForExport,
  hasCompleteExportResearch,
  leadAnalysisHasSaveableResearch,
  mergeCompanyResearchPayloadForWebhook,
  resolveExportResearchFields,
} from "../../convex/lib/exportResearchFields";

describe("resolveExportResearchFields", () => {
  it("reads structured Perplexity report from companyResearch", () => {
    const result = resolveExportResearchFields(
      { company_profile: "Short summary" },
      {
        company_overview: "Overview",
        confidence_score: 0.82,
        raw_data: {
          research_metadata: {
            comprehensive_report: `### 1. ANNUAL REVENUE
Revenue is $5M annually.`,
            citations: ["https://example.com/news", "https://example.com/about"],
            confidence_score: 0.9,
          },
        },
      },
    );

    expect(result.fullResearchReport).toContain("ANNUAL REVENUE");
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

  it("prefers leadAnalysis Perplexity research_metadata when present", () => {
    const result = resolveExportResearchFields(
      {
        research_metadata: {
          citations: ["https://lead.com"],
          comprehensive_report: `### 1. ANNUAL REVENUE
From lead`,
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

    expect(result.fullResearchReport).toContain("ANNUAL REVENUE");
    expect(result.citations).toEqual(["https://lead.com"]);
  });

  it("ignores people-discovery-only company research payloads", () => {
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
          source: "people_discovery",
        },
      },
    });

    expect(result.fullResearchReport).toBe("");
    expect(result.citations).toEqual([]);
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

  it("does not use slim BI overview as full_research_report", () => {
    const result = resolveExportResearchFields(
      {
        company_overview: "Slim overview from Write Emails",
        confidence_score: 0.61,
      },
      undefined,
      { relevanceScore: 0.55 },
    );

    expect(result.fullResearchReport).toBe("");
    expect(result.researchConfidenceScore).toBe(0.61);
  });

  it("does not use company_profile as full_research_report without Perplexity structure", () => {
    const result = resolveExportResearchFields(
      { company_profile: "Profile text" },
      undefined,
      { relevanceScore: 0.48 },
    );

    expect(result.fullResearchReport).toBe("");
    expect(result.researchConfidenceScore).toBe(0.48);
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

  it("mergeCompanyResearchPayloadForWebhook prefers Perplexity comprehensive_report", () => {
    const existing = {
      company_overview: "2 team members found on website",
      raw_data: {
        people_discovery: true,
        research_metadata: {
          comprehensive_report: "2 team members found on website",
          source: "people_discovery",
        },
      },
    };
    const incoming = {
      company_overview: "Short BI summary",
      raw_data: {
        research_metadata: {
          comprehensive_report: `### 1. ANNUAL REVENUE
Revenue is $768,000 in 2024.`,
          citations: [{ url: "https://growjo.com/company/Acme", title: "Growjo" }],
        },
      },
    };

    const merged = mergeCompanyResearchPayloadForWebhook(
      existing,
      incoming,
    ) as {
      raw_data: {
        comprehensive_report: string;
        research_metadata: { comprehensive_report: string };
      };
    };

    expect(merged.raw_data.research_metadata.comprehensive_report).toContain(
      "ANNUAL REVENUE",
    );
    expect(merged.raw_data.comprehensive_report).toContain("ANNUAL REVENUE");
  });
});

describe("leadAnalysisHasSaveableResearch", () => {
  it("returns true when Perplexity comprehensive_report is nested in research_metadata", () => {
    expect(
      leadAnalysisHasSaveableResearch({
        research_metadata: {
          comprehensive_report: `### 1. ANNUAL REVENUE
Full report from Perplexity`,
          citations: ["https://example.com"],
        },
      }),
    ).toBe(true);
  });

  it("returns false for company_overview-only BI output", () => {
    expect(
      leadAnalysisHasSaveableResearch({
        company_overview: "Short company summary",
      }),
    ).toBe(false);
  });

  it("returns false when lead_analysis has no research text", () => {
    expect(leadAnalysisHasSaveableResearch({ pain_points: ["slow ops"] })).toBe(
      false,
    );
  });
});

describe("buildWebhookResearchPayload", () => {
  it("uses company_overview when present", () => {
    const payload = buildWebhookResearchPayload(
      {
        company_overview: "Short",
        research_metadata: {
          comprehensive_report: "Long comprehensive report",
        },
      },
      {
        confidence_score: 0.88,
        research_tier: "perplexity",
        deep_research_used: true,
        deep_research_reason: "Missing data points",
      },
    );

    expect(payload.company_overview).toBe("Short");
    expect(payload.confidence_score).toBe(0.88);
    expect(payload.deep_research_used).toBe(true);
  });

  it("falls back to comprehensive_report when overview is missing", () => {
    const payload = buildWebhookResearchPayload(
      {
        research_metadata: {
          comprehensive_report: "Long comprehensive report",
        },
      },
      {
        confidence_score: 0.88,
        research_tier: "perplexity",
        deep_research_used: false,
      },
    );

    expect(payload.company_overview).toBe("Long comprehensive report");
  });
});
