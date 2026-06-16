import { describe, expect, it } from "vitest";
import {
  isAllEnrichmentTerminal,
  isFailedSearchAnalysisTimeout,
  isTerminalEnrichmentStatus,
  hasPendingEnrichment,
} from "../../convex/lib/searchAnalysisRecovery";

describe("searchAnalysisRecovery", () => {
  it("recognizes terminal enrichment statuses", () => {
    expect(isTerminalEnrichmentStatus("completed")).toBe(true);
    expect(isTerminalEnrichmentStatus("no_contacts_found")).toBe(true);
    expect(isTerminalEnrichmentStatus("pending")).toBe(false);
  });

  it("detects when all leads finished enrichment", () => {
    expect(
      isAllEnrichmentTerminal([
        { enrichmentStatus: "completed" },
        { enrichmentStatus: "no_contacts_found" },
      ]),
    ).toBe(true);
    expect(
      isAllEnrichmentTerminal([
        { enrichmentStatus: "completed" },
        { enrichmentStatus: "in_progress" },
      ]),
    ).toBe(false);
  });

  it("detects pending enrichment", () => {
    expect(hasPendingEnrichment([{ enrichmentStatus: "pending" }])).toBe(true);
    expect(hasPendingEnrichment([{ enrichmentStatus: "completed" }])).toBe(
      false,
    );
  });

  it("detects failed search errors caused by pending analysis timeout", () => {
    expect(
      isFailedSearchAnalysisTimeout(
        "Search timed out during processing phase. 0 leads pending enrichment, 0 leads failed enrichment, 4 leads pending analysis.",
      ),
    ).toBe(true);
    expect(isFailedSearchAnalysisTimeout("Discovery timed out")).toBe(false);
  });
});
