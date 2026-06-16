import { describe, expect, it } from "vitest";
import { buildFindyMailPerRoleFetchPlan } from "../../convex/leads/enrichment/findymail";
import {
  buildExpandedPatternsByRole,
  buildRoundRobinExpandedPatterns,
  mergeRolePatterns,
  buildStaticRolePatterns,
} from "../../convex/lib/roleExpansion";

describe("FindyMail per-role fetch plan", () => {
  it("runs all UI roles first, then expanded patterns without duplicates", () => {
    const userRoles = ["CEO", "Founder", "Owner"];
    const staticPatterns = buildStaticRolePatterns(userRoles);
    const aiPatterns = [
      "vp marketing",
      "chief marketing officer",
      "head of marketing",
      "marketing director",
      "president",
      "partner",
      "managing director",
      "co founder",
      "chief executive officer",
      "executive director",
      "general manager",
      "operations director",
      "sales director",
    ];
    const rolePatterns = mergeRolePatterns(userRoles, staticPatterns, aiPatterns);

    const plan = buildFindyMailPerRoleFetchPlan({
      roles: userRoles,
      rolePatterns,
      enableRoleExpansion: true,
    });

    expect(plan.userRoles).toEqual(["ceo", "founder", "owner"]);
    expect(plan.expandedPatterns[0]).not.toBe("ceo");
    expect(plan.userRoles.every((role) => !plan.expandedPatterns.includes(role))).toBe(
      true,
    );
    expect(plan.expandedPatterns.length).toBeLessThanOrEqual(12);
    expect(
      plan.expandedPatterns.some((pattern) =>
        /\b(vp|chief|head|director)\b/.test(pattern),
      ),
    ).toBe(true);
  });

  it("orders user roles before expanded when combined into a single list", () => {
    const plan = buildFindyMailPerRoleFetchPlan({
      roles: ["CEO", "Founder", "Owner"],
      rolePatternsByRole: {
        ceo: ["vp sales"],
        founder: ["head of sales"],
      },
      enableRoleExpansion: true,
    });

    const combined = [...plan.userRoles, ...plan.expandedPatterns];
    expect(combined.slice(0, 3)).toEqual(["ceo", "founder", "owner"]);
    expect(combined.slice(3)).toEqual(["vp sales", "head of sales"]);
  });

  it("round-robins expanded patterns across role lanes A1, B1, C1, A2...", () => {
    const userRoles = ["CEO", "Founder", "Owner"];
    const patternsByRole = {
      ceo: ["chief executive officer", "president"],
      founder: ["co founder", "cofounder"],
      owner: ["partner", "managing director"],
    };

    const roundRobin = buildRoundRobinExpandedPatterns(userRoles, patternsByRole, 12);
    expect(roundRobin).toEqual([
      "chief executive officer",
      "co founder",
      "partner",
      "president",
      "cofounder",
      "managing director",
    ]);

    const plan = buildFindyMailPerRoleFetchPlan({
      roles: userRoles,
      rolePatternsByRole: patternsByRole,
      enableRoleExpansion: true,
    });

    expect(plan.userRoles).toEqual(["ceo", "founder", "owner"]);
    expect(plan.expandedPatterns).toEqual(roundRobin);
  });
});
