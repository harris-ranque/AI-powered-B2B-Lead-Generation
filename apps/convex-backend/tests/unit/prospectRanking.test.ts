import { describe, expect, it } from "vitest";
import {
  computeEffectiveRankScore,
  rankProspectsForFindyMail,
  FINDYMAIL_MIN_CONFIDENCE,
} from "../../convex/lib/prospectRanking";

describe("prospectRanking", () => {
  it("ranks founder above operations manager", () => {
    const prospects = [
      {
        name: "Jane",
        title: "Operations Manager",
        confidence: 0.9,
        matchedRole: "Operations Manager",
        rankScore: 0.72,
      },
      {
        name: "John",
        title: "Founder",
        confidence: 0.88,
        matchedRole: "Founder",
        rankScore: 0.98,
      },
    ];

    const ranked = rankProspectsForFindyMail(prospects, [
      "Founder",
      "Operations Manager",
    ]);

    expect(ranked[0]?.name).toBe("John");
    expect(ranked[1]?.name).toBe("Jane");
  });

  it("uses rank score when provided", () => {
    const highRank = computeEffectiveRankScore(
      {
        confidence: 0.7,
        matchedRole: "Founder",
        rankScore: 0.98,
        title: "Founder",
      },
      ["Founder", "CEO"],
    );
    const lowRank = computeEffectiveRankScore(
      {
        confidence: 0.95,
        matchedRole: "Operations Manager",
        rankScore: 0.72,
        title: "Operations Manager",
      },
      ["Founder", "CEO"],
    );
    expect(highRank).toBeGreaterThan(lowRank);
  });

  it("defines findymail confidence gate", () => {
    expect(FINDYMAIL_MIN_CONFIDENCE).toBe(0.85);
  });
});
