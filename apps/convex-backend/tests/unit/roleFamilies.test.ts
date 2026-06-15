import { describe, expect, it } from "vitest";
import {
  expandRolesForMatching,
  ROLE_LANE_MATCH_SCORE,
  scoreRoleLaneMatch,
} from "../../convex/lib/roleFamilies";
import {
  scoreTitleAgainstRoles,
  TITLE_MATCH_ACCEPT_THRESHOLD,
} from "../../convex/lib/contactAcceptance";

describe("roleFamilies", () => {
  it("expands Marketing Manager into related marketing decision-maker patterns", () => {
    const patterns = expandRolesForMatching(["Marketing Manager"], true);
    expect(patterns).toContain("marketing manager");
    expect(patterns).toContain("marketing director");
    expect(patterns).toContain("vp of marketing");
    expect(patterns).toContain("head of marketing");
    expect(patterns).toContain("chief marketing officer");
  });

  it("lane match accepts marketing director when user requested marketing manager", () => {
    const match = scoreRoleLaneMatch(
      "Marketing Director",
      ["Marketing Manager"],
      true,
    );
    expect(match.score).toBe(ROLE_LANE_MATCH_SCORE);
    expect(match.reason).toBe("lane_match");
  });

  it("lane match accepts VP of Marketing for Marketing Manager search", () => {
    const match = scoreTitleAgainstRoles(
      "VP of Marketing",
      ["Marketing Manager"],
      true,
    );
    expect(match.score).toBeGreaterThanOrEqual(TITLE_MATCH_ACCEPT_THRESHOLD);
  });

  it("lane match accepts CMO for Marketing Manager search", () => {
    const match = scoreTitleAgainstRoles(
      "Chief Marketing Officer",
      ["Marketing Manager"],
      true,
    );
    expect(match.score).toBeGreaterThanOrEqual(TITLE_MATCH_ACCEPT_THRESHOLD);
  });

  it("lane match accepts Head of Marketing for Marketing Manager search", () => {
    const match = scoreTitleAgainstRoles(
      "Head of Marketing",
      ["Marketing Manager"],
      true,
    );
    expect(match.score).toBeGreaterThanOrEqual(TITLE_MATCH_ACCEPT_THRESHOLD);
  });

  it("does not lane-match unrelated titles", () => {
    const match = scoreRoleLaneMatch(
      "Junior Accountant",
      ["Marketing Manager"],
      true,
    );
    expect(match.score).toBe(0);
  });
});
