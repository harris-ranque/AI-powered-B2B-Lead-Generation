import { describe, expect, it } from "vitest";
import {
  isPeopleDiscoveryOnlyResearch,
  isValidCompanyResearchCache,
  normalizeCompanyResearchPayload,
} from "../../convex/lib/companyResearchCache";

describe("companyResearchCache", () => {
  it("normalizes webhook-style payloads", () => {
    const normalized = normalizeCompanyResearchPayload({
      company_overview: "Acme is a property manager.",
      raw_data: { recent_news: ["Expanded in 2025"] },
      confidence_score: 0.82,
      research_tier: "perplexity",
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.company_overview).toBe("Acme is a property manager.");
    expect(isValidCompanyResearchCache(normalized)).toBe(true);
  });

  it("normalizes legacy lead_analysis payloads", () => {
    const normalized = normalizeCompanyResearchPayload({
      lead_analysis: {
        company_overview: "Legacy overview",
        research_metadata: { confidence_score: 0.6 },
      },
      research_tier: "tavily",
    });

    expect(normalized?.company_overview).toBe("Legacy overview");
    expect(normalized?.confidence_score).toBe(0.6);
  });

  it("rejects empty payloads", () => {
    expect(normalizeCompanyResearchPayload({ raw_data: {} })).toBeNull();
    expect(isValidCompanyResearchCache(null)).toBe(false);
  });

  it("rejects people-discovery-only cache so Perplexity can run", () => {
    const peopleDiscoveryPayload = {
      company_overview: "3 role-matched team members found on Acme's website.",
      confidence_score: 0.75,
      research_tier: "pro",
      raw_data: {
        company_overview: "3 role-matched team members found on Acme's website.",
        people_discovery: true,
        research_metadata: {
          comprehensive_report: "3 role-matched team members found on Acme's website.",
          source: "people_discovery",
          citations: [{ url: "https://acme.com/team", title: "Company website" }],
        },
      },
    };

    expect(isPeopleDiscoveryOnlyResearch(peopleDiscoveryPayload)).toBe(true);
    expect(isValidCompanyResearchCache(peopleDiscoveryPayload)).toBe(false);
  });

  it("accepts merged cache that includes Perplexity structure", () => {
    const mergedPayload = {
      company_overview: "Acme is a regional services firm.",
      research_tier: "perplexity",
      raw_data: {
        people_discovery: true,
        research_metadata: {
          comprehensive_report: `### 1. ANNUAL REVENUE
Acme earns $1M-$5M annually.`,
          citations: [{ url: "https://growjo.com/company/Acme", title: "Growjo" }],
        },
      },
    };

    expect(isPeopleDiscoveryOnlyResearch(mergedPayload)).toBe(false);
    expect(isValidCompanyResearchCache(mergedPayload)).toBe(true);
  });
});
