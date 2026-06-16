import { describe, expect, it } from "vitest";
import { shouldEndDiscoveryWithoutEnrichment } from "../../convex/lib/searchAnalysisRecovery";

describe("enrichment re-enrich queue fixes", () => {
  it("does not end discovery when only linked duplicates exist", () => {
    expect(shouldEndDiscoveryWithoutEnrichment(0, 74)).toBe(false);
  });

  it("ends discovery when nothing was found or linked", () => {
    expect(shouldEndDiscoveryWithoutEnrichment(0, 0)).toBe(true);
  });
});
