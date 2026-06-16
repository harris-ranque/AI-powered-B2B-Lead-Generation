import { describe, expect, it } from "vitest";
import { scoreSemanticTitleMatch } from "../../convex/lib/roleSemanticMatch";

describe("roleSemanticMatch", () => {
  it("accepts DevOps lane variants for DevOps Engineer", () => {
    const titles = [
      "Senior DevOps Engineer",
      "DevOps practitioner",
      "DevOps Developer",
    ];

    for (const title of titles) {
      const match = scoreSemanticTitleMatch(title, ["DevOps Engineer"]);
      expect(match.score).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("rejects unrelated roles", () => {
    const match = scoreSemanticTitleMatch("Junior Accountant", ["DevOps Engineer"]);
    expect(match.score).toBeLessThan(0.6);
  });
});
