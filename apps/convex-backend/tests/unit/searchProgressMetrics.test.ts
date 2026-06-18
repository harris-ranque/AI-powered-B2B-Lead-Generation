import { describe, expect, it } from "vitest";
import { mergeDiscoveredCount } from "../../convex/lib/searchProgressMetrics";
import type { Doc, Id } from "../../convex/_generated/dataModel";

function makeSearch(overrides: {
  progress?: { discovered?: number };
  results?: { totalFound?: number };
}): Doc<"searches"> {
  return {
    _id: "search1" as Id<"searches">,
    _creationTime: 0,
    userId: "user1" as Id<"users">,
    name: "Test",
    status: "completed",
    createdAt: 0,
    parameters: {},
    progress: {
      discovered: overrides.progress?.discovered ?? 0,
      enriched: 0,
      analyzed: 0,
      total: overrides.progress?.discovered ?? 0,
    },
    results: {
      totalFound: overrides.results?.totalFound ?? 0,
      enrichedCount: 0,
      analyzedCount: 0,
      avgRelevanceScore: 0,
      exportableCount: 0,
    },
  } as Doc<"searches">;
}

describe("mergeDiscoveredCount", () => {
  it("never shrinks discovered when a small batch reports fewer leads", () => {
    const search = makeSearch({ progress: { discovered: 12 }, results: { totalFound: 12 } });
    expect(mergeDiscoveredCount(search, 1)).toBe(12);
  });

  it("uses lead table count when larger than stored progress", () => {
    const search = makeSearch({ progress: { discovered: 1 }, results: { totalFound: 1 } });
    expect(mergeDiscoveredCount(search, 60)).toBe(60);
  });

  it("returns lead count when search is null", () => {
    expect(mergeDiscoveredCount(null, 8)).toBe(8);
  });
});
