import type { Id } from "../_generated/dataModel";

export type DiscoverySourceSearch = {
  _id: Id<"searches">;
  userId: Id<"users">;
  discoveryFrozenAt?: number;
};

export function canUseAsFrozenDiscoverySource(
  source: DiscoverySourceSearch,
  requesterId: Id<"users">,
  requesterIsAdmin: boolean,
): boolean {
  if (!source.discoveryFrozenAt) {
    return false;
  }
  if (requesterIsAdmin) {
    return true;
  }
  return source.userId === requesterId;
}

export type ClonableDiscoveryLead = {
  businessName: string;
  address: string;
  normalizedAddress?: string;
  placeId: string;
  location: {
    lat: number;
    lng: number;
    formattedAddress: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  category?: string;
};

export function buildClonedDiscoveryLeadInsert(
  sourceLead: ClonableDiscoveryLead,
  targetSearchId: Id<"searches">,
  targetUserId: Id<"users">,
  now = Date.now(),
) {
  return {
    userId: targetUserId,
    searchId: targetSearchId,
    businessName: sourceLead.businessName,
    address: sourceLead.address,
    normalizedAddress: sourceLead.normalizedAddress,
    placeId: sourceLead.placeId,
    location: sourceLead.location,
    phone: sourceLead.phone,
    website: sourceLead.website,
    rating: sourceLead.rating,
    reviewCount: sourceLead.reviewCount,
    category: sourceLead.category,
    dataSource: "google_maps" as const,
    enrichmentStatus: "pending" as const,
    status: "new" as const,
    tags: [] as string[],
    createdAt: now,
    updatedAt: now,
  };
}
