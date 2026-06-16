import { describe, expect, it } from "vitest";
import {
  shouldEndDiscoveryWithoutEnrichment,
} from "../../convex/lib/searchAnalysisRecovery";

describe("searchAnalysisRecovery", () => {
  it("ends discovery only when nothing was discovered or linked", () => {
    expect(shouldEndDiscoveryWithoutEnrichment(0, 0)).toBe(true);
    expect(shouldEndDiscoveryWithoutEnrichment(0, 32)).toBe(false);
    expect(shouldEndDiscoveryWithoutEnrichment(5, 32)).toBe(false);
    expect(shouldEndDiscoveryWithoutEnrichment(10, 10)).toBe(false);
  });
});
