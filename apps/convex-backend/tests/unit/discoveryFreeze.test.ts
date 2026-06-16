import { describe, expect, it } from "vitest";
import {
  buildClonedDiscoveryLeadInsert,
  canUseAsFrozenDiscoverySource,
} from "../../convex/lib/discoveryFreeze";
import type { Id } from "../../convex/_generated/dataModel";

const userA = "user_a" as Id<"users">;
const userB = "user_b" as Id<"users">;
const searchId = "search_1" as Id<"searches">;

describe("discoveryFreeze", () => {
  it("requires frozen discovery before reuse", () => {
    expect(
      canUseAsFrozenDiscoverySource(
        { _id: searchId, userId: userA },
        userA,
        false,
      ),
    ).toBe(false);

    expect(
      canUseAsFrozenDiscoverySource(
        { _id: searchId, userId: userA, discoveryFrozenAt: Date.now() },
        userA,
        false,
      ),
    ).toBe(true);
  });

  it("allows admins to reuse another user's frozen search", () => {
    expect(
      canUseAsFrozenDiscoverySource(
        { _id: searchId, userId: userA, discoveryFrozenAt: Date.now() },
        userB,
        true,
      ),
    ).toBe(true);

    expect(
      canUseAsFrozenDiscoverySource(
        { _id: searchId, userId: userA, discoveryFrozenAt: Date.now() },
        userB,
        false,
      ),
    ).toBe(false);
  });

  it("builds cloned lead rows with pending enrichment", () => {
    const insert = buildClonedDiscoveryLeadInsert(
      {
        businessName: "Acme Co",
        address: "1 Main St",
        placeId: "place_123",
        location: {
          lat: 1,
          lng: 2,
          formattedAddress: "1 Main St",
        },
        website: "https://acme.com",
      },
      "target_search" as Id<"searches">,
      userA,
      1000,
    );

    expect(insert.searchId).toBe("target_search");
    expect(insert.enrichmentStatus).toBe("pending");
    expect(insert.dataSource).toBe("google_maps");
    expect(insert.businessName).toBe("Acme Co");
    expect(insert.createdAt).toBe(1000);
  });
});
