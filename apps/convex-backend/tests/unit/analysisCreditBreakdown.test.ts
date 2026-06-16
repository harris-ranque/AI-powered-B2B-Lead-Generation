import { describe, it, expect } from "vitest";
import { computeAnalysisCreditBreakdown } from "../../convex/lib/helpers";

describe("computeAnalysisCreditBreakdown", () => {
  it("returns zero when no personalized contacts were analyzed", () => {
    const result = computeAnalysisCreditBreakdown([]);

    expect(result).toEqual({
      analyzedCount: 0,
      tier2Leads: 0,
      tier3Leads: 0,
      tier2Cost: 0,
      tier3Cost: 0,
      total: 0,
    });
  });

  it("does not produce negative tier2 when stale deepResearch exists without analysis", () => {
    const result = computeAnalysisCreditBreakdown([]);

    expect(result.tier2Leads).toBeGreaterThanOrEqual(0);
    expect(result.tier3Leads).toBe(0);
    expect(result.total).toBe(0);
  });

  it("charges tier 2 and tier 3 only for analyzed contacts", () => {
    const result = computeAnalysisCreditBreakdown([
      { deepResearchUsed: false },
      { deepResearchUsed: true },
      { deepResearchUsed: false },
    ]);

    expect(result.analyzedCount).toBe(3);
    expect(result.tier2Leads).toBe(2);
    expect(result.tier3Leads).toBe(1);
    expect(result.tier2Cost).toBe(2);
    expect(result.tier3Cost).toBe(2);
    expect(result.total).toBe(4);
  });
});
