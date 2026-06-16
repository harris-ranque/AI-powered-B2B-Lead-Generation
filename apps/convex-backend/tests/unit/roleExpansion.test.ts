import { describe, expect, it } from "vitest";
import {
  buildStaticRolePatterns,
  mergeRolePatterns,
  mergeTitleMatchers,
  parseAiRoleExpansionResponse,
  resolveEnrichmentRolePatterns,
  resolveTitleMatchPatterns,
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

  it("merges title matchers with a higher cap", () => {
    const matchers = mergeTitleMatchers(
      ["DevOps Engineer"],
      buildStaticRolePatterns(["DevOps Engineer"]),
      [
        "senior devops engineer",
        "devops practitioner",
        "devops developer",
        "devops specialist",
      ],
    );

    expect(matchers).toContain("devops engineer");
    expect(matchers).toContain("devops practitioner");
    expect(matchers.length).toBeLessThanOrEqual(50);
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

  it("uses cached expandedTitleMatchers for acceptance matching", () => {
    const patterns = resolveTitleMatchPatterns(["DevOps Engineer"], {
      expandedTitleMatchers: [
        "devops practitioner",
        "senior devops engineer",
      ],
    });

    expect(patterns).toEqual([
      "devops practitioner",
      "senior devops engineer",
    ]);
  });

  it("parses AI JSON expansions_by_role arrays (legacy)", () => {
    const parsed = parseAiRoleExpansionResponse(
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

    expect(parsed.findymailPatterns).toEqual([
      "vp demand generation",
      "head of demand generation",
    ]);
    expect(parsed.titleSynonyms).toEqual([]);
  });

  it("parses structured findymail_patterns and title_synonyms", () => {
    const parsed = parseAiRoleExpansionResponse(
      JSON.stringify({
        expansions_by_role: {
          "DevOps Engineer": {
            findymail_patterns: ["senior devops engineer", "lead devops"],
            title_synonyms: [
              "devops practitioner",
              "devops developer",
            ],
          },
        },
      }),
      ["DevOps Engineer"],
    );

    expect(parsed.findymailPatterns).toContain("senior devops engineer");
    expect(parsed.titleSynonyms).toContain("devops practitioner");
    expect(parsed.titleSynonyms).toContain("devops developer");
  });
});
