import { describe, expect, it } from "vitest";

/** Mirrors getLeadsForPeopleDiscovery merge/dedupe behavior. */
function mergePeopleDiscoveryLeads(
  newNativeLeads: Array<{ _id: string }>,
  linkedLeads: Array<{ _id: string }>,
): Array<{ _id: string }> {
  const nativeIds = new Set(newNativeLeads.map((lead) => String(lead._id)));
  const filteredLinked = linkedLeads.filter(
    (lead) => !nativeIds.has(String(lead._id)),
  );

  const seen = new Set<string>();
  const result: Array<{ _id: string }> = [];

  for (const lead of [...newNativeLeads, ...filteredLinked]) {
    const id = String(lead._id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(lead);
  }

  return result;
}

describe("people discovery lead selection", () => {
  it("includes pending linked leads when no native leads exist", () => {
    const linked = [{ _id: "lead_a" }, { _id: "lead_b" }];
    expect(mergePeopleDiscoveryLeads([], linked)).toEqual(linked);
  });

  it("merges native and linked without duplicates", () => {
    const native = [{ _id: "lead_a" }];
    const linked = [{ _id: "lead_a" }, { _id: "lead_b" }];
    expect(mergePeopleDiscoveryLeads(native, linked)).toEqual([
      { _id: "lead_a" },
      { _id: "lead_b" },
    ]);
  });

  it("prefers native list order before linked additions", () => {
    const native = [{ _id: "lead_a" }, { _id: "lead_c" }];
    const linked = [{ _id: "lead_b" }];
    expect(mergePeopleDiscoveryLeads(native, linked)).toEqual([
      { _id: "lead_a" },
      { _id: "lead_c" },
      { _id: "lead_b" },
    ]);
  });
});
