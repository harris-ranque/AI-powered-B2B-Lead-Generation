import { describe, expect, it } from "vitest";

describe("people discovery JSON parsing", () => {
  it("parses JSON from fenced code block", () => {
    const text = '```json\n{"company_overview": "SaaS co", "people": []}\n```';
    const match = text.match(/```(?:json)?\s*([\{].*?[\}])\s*```/s);
    expect(match?.[1]).toBeDefined();
    const parsed = JSON.parse(match![1]!);
    expect(parsed.company_overview).toBe("SaaS co");
  });

  it("matches co-founder title to Founder role", () => {
    const roles = ["Founder", "Owner"];
    const titleNorm = "co-founder";
    const matched = roles.find(
      (role) =>
        titleNorm.includes(role.toLowerCase()) ||
        role.toLowerCase().includes(titleNorm),
    );
    expect(matched).toBe("Founder");
  });
});
