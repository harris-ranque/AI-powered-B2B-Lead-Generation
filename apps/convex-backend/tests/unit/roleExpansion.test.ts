import { describe, expect, it } from "vitest";
import {
  buildStaticRolePatterns,
  mergeRolePatterns,
  parseAiRoleExpansionResponse,
  resolveEnrichmentRolePatterns,
  rolesNeedingAiExpansion,
} from "../../convex/lib/roleExpansion";

describe("roleExpansion", () => {
  it("detects custom roles that need AI expansion", () => {
    expect(rolesNeedingAiExpansion(["Demand Gen"])).toEqual(["Demand Gen"]);
    expect(rolesNeedingAiExpansion(["Marketing"])).toEqual([]);
  });

  it("merges static and AI patterns with a cap", () => {
    const merged = mergeRolePatterns(
      ["Demand Gen"],
      buildStaticRolePatterns(["Demand Gen"]),
      [
        "vp demand generation",
        "head of demand generation",
        "director of demand gen",
      ],
    );

    expect(merged).toContain("demand gen");
    expect(merged).toContain("vp demand generation");
    expect(merged.length).toBeLessThanOrEqual(18);
  });

  it("uses cached expandedRolePatterns from search parameters", () => {
    const patterns = resolveEnrichmentRolePatterns(["Marketing"], {
      expandedRolePatterns: ["vp of marketing", "chief marketing officer"],
    });

    expect(patterns).toEqual([
      "vp of marketing",
      "chief marketing officer",
    ]);
  });

  it("parses AI JSON expansions_by_role", () => {
    const patterns = parseAiRoleExpansionResponse(
      JSON.stringify({
        expansions_by_role: {
          "Demand Gen": [
            "vp demand generation",
            "head of demand generation",
          ],
        },
      }),
      ["Demand Gen"],
    );

    expect(patterns).toEqual([
      "vp demand generation",
      "head of demand generation",
    ]);
  });
});
