import { describe, expect, it } from "vitest";
import { expandRolesForMatching } from "../../convex/lib/roleFamilies";
import { normalizeRolePattern } from "../../convex/lib/roleExpansion";

const DECISION_MAKER_PATTERN =
  /\b(vp|vice president|chief|head|director|cmo|cro|cto|cfo|coo|president|owner|founder|partner|managing)\b/i;

function prioritizeFindyMailRolePatterns(
  patterns: string[],
  userRoles: string[],
  max = 12,
): string[] {
  const seen = new Set<string>();
  const userNormalized = new Set(userRoles.map((role) => normalizeRolePattern(role)));
  const userBucket: string[] = [];
  const decisionMakerBucket: string[] = [];
  const otherBucket: string[] = [];

  for (const pattern of patterns) {
    const normalized = normalizeRolePattern(pattern);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (userNormalized.has(normalized)) userBucket.push(normalized);
    else if (DECISION_MAKER_PATTERN.test(normalized)) decisionMakerBucket.push(normalized);
    else otherBucket.push(normalized);
  }

  return [...userBucket, ...decisionMakerBucket, ...otherBucket].slice(0, max);
}

describe("FindyMail role pattern cap", () => {
  it("prioritizes user roles and decision-maker patterns when capping", () => {
    const userRoles = ["Marketing"];
    const patterns = expandRolesForMatching(userRoles, true);
    const capped = prioritizeFindyMailRolePatterns(patterns, userRoles, 5);

    expect(capped.length).toBe(5);
    expect(capped[0]).toBe("marketing");
    expect(capped.some((p) => DECISION_MAKER_PATTERN.test(p))).toBe(true);
  });
});
