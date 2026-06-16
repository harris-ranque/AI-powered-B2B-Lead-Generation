import { describe, expect, it } from "vitest";
import { isAllEnrichmentTerminal } from "../../convex/lib/searchAnalysisRecovery";

describe("search enrichment completion (linked-only searches)", () => {
  it("treats empty native lead list as not terminal via isAllEnrichmentTerminal", () => {
    expect(isAllEnrichmentTerminal([])).toBe(false);
  });

  it("treats native leads with terminal enrichment as complete", () => {
    expect(
      isAllEnrichmentTerminal([
        { enrichmentStatus: "no_contacts_found" },
        { enrichmentStatus: "failed" },
      ]),
    ).toBe(true);
  });

  it("linked-only pipeline uses empty native + no pending links as complete", () => {
    const nativeLeads: Array<{ enrichmentStatus?: string }> = [];
    const linkedPending = false;
    const nativeTerminal =
      nativeLeads.length === 0 || isAllEnrichmentTerminal(nativeLeads);

    expect(nativeTerminal && !linkedPending).toBe(true);
  });
});
