/**
 * Google Places API actions.
 *
 * Enrichment pipeline overview (see enrichBatch):
 *  1. Filter out previously processed placeIds via suppressions before any network I/O.
 *  2. Fetch Google Place details with a concurrency cap of 15 to extract domains.
 *  3. Call FindyMail in a domain-first lane capped at 5 concurrent requests.
 *  4. Promote only verified-email leads and update suppression statuses synchronously.
 *
 * No Convex scheduling is used; the entire flow completes within a single action invocation.
 */
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { mapWithConcurrency } from "../utils/async";
import { canonicalizeDomain } from "../utils/domains";
import { fetchWithRetry } from "../utils/http";
import { resolveDomainsWithFindyMail } from "../leads/enrichment/findymail";

const MAX_AUTOCOMPLETE_RADIUS_METERS = 50000;

// Google Places API types
interface PlacePrediction {
  description: string;
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text?: string;
  };
  types: string[];
}

interface PlacesAutocompleteResponse {
  predictions: PlacePrediction[];
  status: string;
  error_message?: string;
}

// Get place predictions from Google Places API
export const getPlacePredictions = action({
  args: {
    input: v.string(),
    types: v.optional(v.array(v.string())),
    location: v.optional(v.string()),
    radius: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get Google Maps API key
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      throw new Error("Google Maps API key not configured");
    }

    // Validate input
    if (!args.input.trim()) {
      return {
        success: true,
        predictions: [],
        message: "Empty input provided",
      };
    }

    try {
      // Build Places Autocomplete API URL
      const placesUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      );
      placesUrl.searchParams.set("input", args.input);
      placesUrl.searchParams.set("key", googleMapsApiKey);

      // Set default types to cities and administrative areas for location search
      const types =
        args.types && args.types.length > 0 ? args.types : ["(cities)"];
      if (types.length > 0) {
        placesUrl.searchParams.set("types", types.join("|"));
      }

      // Add location bias if provided
      if (args.location && args.radius) {
        const clampedRadius = Math.min(
          Math.max(args.radius, 0),
          MAX_AUTOCOMPLETE_RADIUS_METERS,
        );
        placesUrl.searchParams.set("location", args.location);
        placesUrl.searchParams.set("radius", clampedRadius.toString());
      }

      // Make request to Google Places API
      const response = await fetch(placesUrl.toString());
      if (!response.ok) {
        throw new Error(
          `Google Places API HTTP error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as PlacesAutocompleteResponse;

      // Check API response status
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        throw new Error(
          `Google Places API error: ${data.status} - ${data.error_message || "Unknown error"}`,
        );
      }

      const predictions = data.predictions || [];

      return {
        success: true,
        predictions: predictions.map((prediction) => ({
          placeId: prediction.place_id,
          description: prediction.description,
          mainText: prediction.structured_formatting.main_text,
          secondaryText:
            prediction.structured_formatting.secondary_text || null,
          types: prediction.types,
        })),
        message: `Found ${predictions.length} location suggestions`,
      };
    } catch (error) {
      console.error("Places Autocomplete API error:", error);

      return {
        success: false,
        predictions: [],
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch location suggestions",
      };
    }
  },
});

// Get place details from Google Places API
export const getPlaceDetails = action({
  args: {
    placeId: v.string(),
    fields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get Google Maps API key
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      throw new Error("Google Maps API key not configured");
    }

    // Validate place ID
    if (!args.placeId.trim()) {
      throw new Error("Place ID is required");
    }

    try {
      // Build Places Details API URL
      const detailsUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/details/json",
      );
      detailsUrl.searchParams.set("place_id", args.placeId);
      detailsUrl.searchParams.set("key", googleMapsApiKey);

      // Set fields to return (default to basic place info)
      const fields =
        args.fields && args.fields.length > 0
          ? args.fields
          : ["place_id", "formatted_address", "geometry", "name", "types"];
      detailsUrl.searchParams.set("fields", fields.join(","));

      // Make request to Google Places API
      const response = await fetch(detailsUrl.toString());
      if (!response.ok) {
        throw new Error(
          `Google Places Details API HTTP error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        result?: any;
        status: string;
        error_message?: string;
      };

      // Check API response status
      if (data.status !== "OK") {
        throw new Error(
          `Google Places Details API error: ${data.status} - ${data.error_message || "Unknown error"}`,
        );
      }

      const place = data.result;
      if (!place) {
        throw new Error("No place details found");
      }

      return {
        success: true,
        place: {
          placeId: place.place_id,
          name: place.name || null,
          formattedAddress: place.formatted_address || null,
          geometry: place.geometry
            ? {
                location: {
                  lat: place.geometry.location?.lat || 0,
                  lng: place.geometry.location?.lng || 0,
                },
              }
            : null,
          types: place.types || [],
        },
        message: "Place details retrieved successfully",
      };
    } catch (error) {
      console.error("Places Details API error:", error);

      return {
        success: false,
        place: null,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch place details",
      };
    }
  },
});

const PLACE_DETAILS_CONCURRENCY = 15;
const FINDYMAIL_CONCURRENCY = 5;
const PLACE_DETAILS_FIELDS = [
  "place_id",
  "name",
  "formatted_address",
  "international_phone_number",
  "website",
  "url",
  "types",
];

interface PlaceCandidate {
  placeId: string;
  domain: string;
  meta: {
    placeId: string;
    name: string | null;
    formattedAddress: string | null;
    internationalPhoneNumber: string | null;
    website: string | null;
    googleUrl: string | null;
    types: string[];
  };
  hadWebsite: boolean;
}

function pickBestContact(
  contacts: { email: string; name?: string }[],
): { email: string; name?: string } | null {
  for (const contact of contacts) {
    if (contact && typeof contact.email === "string" && contact.email.length > 0) {
      return contact;
    }
  }
  return null;
}

async function fetchPlaceCandidate(
  placeId: string,
  apiKey: string,
): Promise<PlaceCandidate | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", PLACE_DETAILS_FIELDS.join(","));
  url.searchParams.set("key", apiKey);

  const response = await fetchWithRetry(
    url.toString(),
    { method: "GET" },
    {
      maxAttempts: 4,
      baseDelayMs: 600,
      shouldRetry: (res, error) => {
        if (error) {
          return true;
        }
        if (!res) {
          return false;
        }
        return (
          res.status === 429 ||
          res.status === 500 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504
        );
      },
      onRetry: ({ attempt, delayMs }) => {
        console.warn(
          `[GooglePlaces] place=${placeId} retrying details fetch in ${Math.round(delayMs)}ms (attempt ${attempt})`,
        );
      },
    },
  );

  if (!response.ok) {
    console.warn(
      `[GooglePlaces] place=${placeId} HTTP error ${response.status} ${response.statusText}`,
    );
    return null;
  }

  const payload = (await response.json()) as {
    status: string;
    result?: any;
    error_message?: string;
  };

  if (payload.status !== "OK" || !payload.result) {
    console.warn(
      `[GooglePlaces] place=${placeId} API error ${payload.status}: ${
        payload.error_message || "unknown"
      }`,
    );
    return null;
  }

  const result = payload.result;
  const website = typeof result.website === "string" ? result.website : null;
  const domain = website ? canonicalizeDomain(website) : "";

  return {
    placeId,
    domain,
    meta: {
      placeId,
      name: typeof result.name === "string" ? result.name : null,
      formattedAddress:
        typeof result.formatted_address === "string" ? result.formatted_address : null,
      internationalPhoneNumber:
        typeof result.international_phone_number === "string"
          ? result.international_phone_number
          : null,
      website,
      googleUrl: typeof result.url === "string" ? result.url : null,
      types: Array.isArray(result.types) ? result.types.filter((t: unknown) => typeof t === "string") : [],
    },
    hadWebsite: Boolean(website && domain),
  };
}

export const enrichBatch = action({
  args: {
    userId: v.string(),
    placeIds: v.array(v.string()),
    roles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const caller = await requireAuth(ctx);
    if (!caller) {
      throw new Error("Authentication required");
    }

    const callerId = `${caller._id}`;
    if (callerId !== args.userId) {
      throw new Error("Cannot enrich leads for another user");
    }

    const { userId, placeIds, roles } = args;
    const startedAt = Date.now();

    if (placeIds.length === 0) {
      return {
        attempted: 0,
        promoted: 0,
        noEmail: 0,
        skippedNoWebsite: 0,
        durationMs: 0,
      };
    }

    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      throw new Error("Google Maps API key not configured");
    }

    const unseen = await ctx.runMutation(
      api.places.suppressions.filterAndMarkUnseen,
      {
        userId,
        placeIds,
      },
    );

    if (unseen.length === 0) {
      return {
        attempted: 0,
        promoted: 0,
        noEmail: 0,
        skippedNoWebsite: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    const detailResults = await mapWithConcurrency(
      unseen,
      PLACE_DETAILS_CONCURRENCY,
      async (placeId) => ({
        placeId,
        detail: await fetchPlaceCandidate(placeId, googleMapsApiKey),
      }),
    );

    const candidates: PlaceCandidate[] = [];
    let skippedNoWebsite = 0;
    let noEmail = 0;

    for (const { placeId, detail } of detailResults) {
      if (!detail) {
        await ctx.runMutation(api.places.suppressions.markNoEmail, {
          userId,
          placeId,
          reason: "place_details_failed",
        });
        noEmail += 1;
        continue;
      }

      if (!detail.domain) {
        skippedNoWebsite += 1;
        await ctx.runMutation(api.places.suppressions.markNoEmail, {
          userId,
          placeId,
          reason: "missing_domain",
        });
        continue;
      }

      candidates.push(detail);
    }

    let domainResults = new Map<string, { name?: string; email: string }[]>();
    const uniqueDomains = Array.from(new Set(candidates.map((candidate) => candidate.domain)));
    if (uniqueDomains.length > 0) {
      domainResults = await resolveDomainsWithFindyMail(uniqueDomains, roles, {
        concurrency: FINDYMAIL_CONCURRENCY,
      });
    }

    let promoted = 0;

    for (const candidate of candidates) {
      const contacts = domainResults.get(candidate.domain) ?? [];
      const best = pickBestContact(contacts);

      if (!best) {
        await ctx.runMutation(api.places.suppressions.markNoEmail, {
          userId,
          placeId: candidate.placeId,
          reason: "findymail_no_email",
        });
        noEmail += 1;
        continue;
      }

      const meta = {
        ...candidate.meta,
        contact: best,
      };

      await ctx.runMutation(api.places.leads.promoteLead, {
        userId,
        placeId: candidate.placeId,
        email: best.email,
        domain: candidate.domain,
        meta,
      });
      promoted += 1;
    }

    return {
      attempted: unseen.length,
      promoted,
      noEmail,
      skippedNoWebsite,
      durationMs: Date.now() - startedAt,
    };
  },
});
