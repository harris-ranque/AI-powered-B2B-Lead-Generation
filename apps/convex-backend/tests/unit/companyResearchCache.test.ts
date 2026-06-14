import { describe, expect, it } from "vitest";
import {
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
});
