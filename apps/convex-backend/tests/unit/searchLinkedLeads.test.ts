import { describe, expect, it } from "vitest";
import { countDuplicateSkipsFromSearch } from "../../convex/lib/exportEligibility";

describe("duplicate re-enrichment discovery counts", () => {
  it("counts duplicate skips from search filters", () => {
    const skips = countDuplicateSkipsFromSearch({
      duplicatesFilteredPlaceId: 10,
      duplicatesFilteredAddress: 5,
      duplicatesFilteredPlaceName: 2,
      duplicatesFilteredEmail: 1,
    });
    expect(skips).toBe(18);
  });
});
