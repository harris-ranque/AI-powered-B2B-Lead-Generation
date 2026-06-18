import { describe, expect, it } from "vitest";
import {
  mapFindyMailEmployeesToProspects,
  parseFindyMailEmployeesResponse,
  sanitizeFindyMailEmployeeJobTitles,
} from "../../convex/lib/findymailEmployees";

describe("findymailEmployees helpers", () => {
  it("parses top-level employee arrays", () => {
    const employees = parseFindyMailEmployeesResponse([
      {
        name: "Julian Lübke",
        jobTitle: "Co-founder & CEO",
        linkedinUrl: "https://linkedin.com/in/julian",
      },
    ]);

    expect(employees).toEqual([
      {
        name: "Julian Lübke",
        jobTitle: "Co-founder & CEO",
        linkedinUrl: "https://linkedin.com/in/julian",
      },
    ]);
  });

  it("parses wrapped employees payloads", () => {
    const employees = parseFindyMailEmployeesResponse({
      employees: [
        { name: "Dirk Schmidt", job_title: "CEO" },
      ],
    });

    expect(employees).toEqual([{ name: "Dirk Schmidt", jobTitle: "CEO" }]);
  });

  it("deduplicates job titles for API requests", () => {
    expect(
      sanitizeFindyMailEmployeeJobTitles(["CEO", "ceo", " Founder ", "CEO"], 3),
    ).toEqual(["CEO", "Founder"]);
  });

  it("maps role-matched employees to prospects", () => {
    const prospects = mapFindyMailEmployeesToProspects(
      [
        {
          name: "Jakob Freund",
          jobTitle: "CEO and Co-Founder",
        },
        {
          name: "Random Engineer",
          jobTitle: "Software Engineer",
        },
      ],
      ["CEO", "Founder", "Owner"],
    );

    expect(prospects).toHaveLength(1);
    expect(prospects[0]).toMatchObject({
      name: "Jakob Freund",
      title: "CEO and Co-Founder",
      source: "findymail_employees",
    });
    expect(prospects[0]?.matchedRole).toBeTruthy();
  });
});
