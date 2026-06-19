import { describe, expect, it } from "vitest";
import {
  computeEffectiveRankScore,
  rankProspectsForFindyMail,
  selectProspectsForFindyMailNameSearch,
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

  it("selects prospects covering each role and multiple same-role contacts", () => {
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
      {
        name: "Alice",
        title: "Co-CEO",
        confidence: 0.92,
        matchedRole: "CEO",
        rankScore: 0.94,
      },
    ];

    const selected = selectProspectsForFindyMailNameSearch(prospects, [
      "Founder",
      "CEO",
      "Operations Manager",
    ]);

    expect(selected.map((p) => p.name)).toEqual([
      "John",
      "Alice",
      "Jane",
      "Bob",
    ]);
    expect(selected.length).toBe(4);
  });

  it("includes every discovered prospect with no upper cap", () => {
    const prospects = Array.from({ length: 7 }, (_, index) => ({
      name: `Person ${index + 1}`,
      title: `Role ${index + 1}`,
      confidence: 0.8,
      matchedRole: "CEO",
      rankScore: 0.9 - index * 0.01,
    }));

    const selected = selectProspectsForFindyMailNameSearch(prospects, ["CEO"]);

    expect(selected).toHaveLength(7);
  });

  it("includes all co-founders when they share the same matched role", () => {
    const prospects = [
      {
        name: "Philipp Povel",
        title: "Co-CEO and Co-Founder",
        confidence: 0.98,
        matchedRole: "CEO",
        rankScore: 0.98,
      },
      {
        name: "Malte Huffmann",
        title: "Co-CEO and Co-Founder",
        confidence: 0.98,
        matchedRole: "CEO",
        rankScore: 0.98,
      },
    ];

    const selected = selectProspectsForFindyMailNameSearch(prospects, [
      "CEO",
      "Founder",
      "Owner",
    ]);

    expect(selected.map((p) => p.name)).toEqual([
      "Philipp Povel",
      "Malte Huffmann",
    ]);
  });

  it("excludes prospects that failed employment verification", () => {
    const prospects = [
      {
        name: "Verified Person",
        title: "Founder",
        confidence: 0.9,
        matchedRole: "Founder",
        rankScore: 0.98,
        employmentVerified: true,
      },
      {
        name: "Stale Person",
        title: "Marketing Director",
        confidence: 0.9,
        matchedRole: "Operations Manager",
        rankScore: 0.72,
        employmentVerified: false,
      },
    ];

    const selected = selectProspectsForFindyMailNameSearch(prospects, [
      "Founder",
      "Operations Manager",
    ]);

    expect(selected.map((p) => p.name)).toEqual(["Verified Person"]);
  });
});
