import { describe, expect, it } from "vitest";
import {
  computeEffectiveRankScore,
  rankProspectsForFindyMail,
  selectProspectsForFindyMailNameSearch,
  MAX_FINDYMAIL_NAME_ATTEMPTS,
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

  it("selects top prospects by rank without confidence gate", () => {
    const prospects = [
      {
        name: "Jane",
        title: "Operations Manager",
        confidence: 0.72,
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
      {
        name: "Bob",
        title: "CEO",
        confidence: 0.5,
        matchedRole: "CEO",
        rankScore: 0.95,
      },
    ];

    const selected = selectProspectsForFindyMailNameSearch(prospects, [
      "Founder",
      "CEO",
    ]);

    expect(selected.length).toBe(MAX_FINDYMAIL_NAME_ATTEMPTS);
    expect(selected[0]?.name).toBe("John");
    expect(selected[1]?.name).toBe("Bob");
  });
});
