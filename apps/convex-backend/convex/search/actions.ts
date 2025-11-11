import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import {
  createCorrelationContext,
  createChildContext,
  logWithCorrelation,
  startPerformanceTracking,
  endPerformanceTracking,
  OPERATION_TYPES,
  formatCorrelationForLogging,
} from "../lib/correlation";
import { CREDIT_COSTS } from "../lib/helpers";
import {
  searchPlacesWithTiling,
  Bounds,
  LatLng,
  Place,
} from "./googlePlaces";
import { getSingleProviderError } from "../lib/errorMessages";
// Note: This action can be scheduled by the orchestrator (no user auth).

const METERS_PER_MILE = 1609.34;
const MAX_PLACES_RADIUS_METERS = 50000;

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GooglePlaceDetails = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: GoogleAddressComponent[];
  website?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
};

const findAddressComponentValue = (
  components: GoogleAddressComponent[] | undefined,
  targetTypes: string[],
  { preferShort }: { preferShort?: boolean } = {},
): string | undefined => {
  if (!components || components.length === 0) {
    return undefined;
  }

  const match = components.find((component) =>
    targetTypes.every((type) => component.types?.includes(type)),
  );

  if (!match) {
    return undefined;
  }

  if (preferShort) {
    return match.short_name ?? match.long_name ?? undefined;
  }

  return match.long_name ?? match.short_name ?? undefined;
};

const INITIAL_FETCH_MULTIPLIER = 1.5;
const MAX_RADIUS_MULTIPLIER = 3;
const DEFAULT_EXPANSION_ITERATIONS = 5;
const DEFAULT_EXPANSION_MULTIPLIER = 1.5;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Smart radius estimation for large searches
 * Ensures adequate coverage area for requested result count
 * @param maxResults - Requested number of leads
 * @param userRadiusMiles - User's specified radius in miles
 * @returns Recommended radius in miles
 */
function estimateOptimalRadius(maxResults: number, userRadiusMiles: number): number {
  // For small searches, respect user's radius
  if (maxResults <= 50) return userRadiusMiles;

  // For medium searches, suggest minimum 15 miles
  if (maxResults <= 150) return Math.max(userRadiusMiles, 15);

  // For large searches, suggest minimum 25 miles
  if (maxResults <= 300) return Math.max(userRadiusMiles, 25);

  // For very large searches (500+), suggest minimum 35 miles
  return Math.max(userRadiusMiles, 35);
}

function normalizeLongitude(lng: number) {
  if (lng > 180) {
    return ((lng + 180) % 360) - 180;
  }
  if (lng < -180) {
    return ((lng - 180) % 360) + 180;
  }
  return lng;
}

function boundsFromCenterRadius(center: LatLng, radiusMeters: number): Bounds {
  const latOffset = radiusMeters / 111_320;
  const lngOffset =
    radiusMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180) || 1);

  return {
    ne: {
      lat: clamp(center.lat + latOffset, -90, 90),
      lng: normalizeLongitude(center.lng + lngOffset),
    },
    sw: {
      lat: clamp(center.lat - latOffset, -90, 90),
      lng: normalizeLongitude(center.lng - lngOffset),
    },
  };
}

function computeRingSegments(previous: Bounds, expanded: Bounds): Bounds[] {
  const segments: Bounds[] = [];

  // North band
  if (expanded.ne.lat > previous.ne.lat) {
    segments.push({
      ne: { lat: expanded.ne.lat, lng: expanded.ne.lng },
      sw: { lat: previous.ne.lat, lng: expanded.sw.lng },
    });
  }

  // South band
  if (expanded.sw.lat < previous.sw.lat) {
    segments.push({
      ne: { lat: previous.sw.lat, lng: expanded.ne.lng },
      sw: { lat: expanded.sw.lat, lng: expanded.sw.lng },
    });
  }

  // West band
  if (expanded.sw.lng < previous.sw.lng) {
    segments.push({
      ne: { lat: previous.ne.lat, lng: previous.sw.lng },
      sw: { lat: previous.sw.lat, lng: expanded.sw.lng },
    });
  }

  // East band
  if (expanded.ne.lng > previous.ne.lng) {
    segments.push({
      ne: { lat: previous.ne.lat, lng: expanded.ne.lng },
      sw: { lat: previous.sw.lat, lng: previous.ne.lng },
    });
  }

  return segments.filter(
    (segment) =>
      segment.ne.lat > segment.sw.lat && segment.ne.lng > segment.sw.lng,
  );
}

// Google Maps search action
export const searchGoogleMaps: any = action({
  args: {
    searchId: v.id("searches"),
    forceRestart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Create correlation context for this search operation
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY,
      "system", // Will be updated with actual userId once we have search
      {
        searchId: args.searchId,
        metadata: {
          forceRestart: args.forceRestart,
          stage: "google_maps_discovery",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    logWithCorrelation(
      "info",
      correlation,
      "🚀 PHASE 1 START: Google Maps Discovery Phase Beginning",
      {
        searchId: args.searchId,
        forceRestart: args.forceRestart,
        timestamp: new Date().toISOString(),
      },
    );

    // Hoist variables for error handling scope
    let useTiling = false;
    let totalApiCalls = 0;

    // Run a LangGraph health check before beginning the lead generation pipeline
    try {
      const healthCheckResult = await ctx.runAction(
        internal.langgraph.health.checkLangGraphHealth,
        {},
      );

      const logLevel = healthCheckResult?.success ? "info" : "warn";
      logWithCorrelation(
        logLevel,
        correlation,
        "🏥 LangGraph health check executed prior to lead generation",
        {
          success: healthCheckResult?.success ?? false,
          status: healthCheckResult?.status ?? "unknown",
          error: healthCheckResult?.error,
        },
      );
    } catch (error) {
      logWithCorrelation(
        "error",
        correlation,
        "❌ Failed to run LangGraph health check before lead generation",
        {
          error:
            error instanceof Error ? error.message : JSON.stringify(error),
        },
      );
    }

    // Check emergency stop first
    const systemConfig = await ctx.runQuery(
      api.admin.queries.getSystemConfiguration,
      {},
    );
    // Treat missing orchestration settings as enabled by default.
    // Only block when explicitly paused (leadGenerationEnabled === false).
    const leadGenEnabled =
      systemConfig?.orchestrationSettings?.leadGenerationEnabled;
    if (leadGenEnabled === false) {
      throw new Error(
        "Lead generation is currently paused. Please contact administrator.",
      );
    }

    // Get search record (internal query works in scheduled/system context)
    const search: any = await ctx.runQuery(
      internal.search.internal.getSearchInternal,
      { searchId: args.searchId },
    );
    if (!search) {
      logWithCorrelation(
        "error",
        correlation,
        "❌ PHASE 1 FAILED: Search record not found",
        { searchId: args.searchId },
      );
      throw new Error("Search not found or access denied");
    }

    // Update correlation with actual userId
    correlation.userId = search.userId;

    logWithCorrelation(
      "info",
      correlation,
      "📋 Search Configuration Loaded",
      {
        userId: search.userId,
        keywords: search.parameters.keywords,
        location: search.parameters.location,
        radius: search.parameters.radius,
        maxResults: search.parameters.maxResults,
      },
    );

    // If already cancelled, do nothing
    if (search.status === "cancelled") {
      return {
        success: false,
        message: "Search already cancelled",
      } as any;
    }

    // Check per-user processing pause
    const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
      userId: search.userId,
    });
    if (user?.processingPaused) {
      // Mark search as cancelled due to pause
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "cancelled",
          error: user.pauseReason || "User processing paused by admin",
        },
      );
      // Broadcast cancellation
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: search.userId,
          searchId: args.searchId,
          stage: "cancelled",
          progress: 0,
          message: user.pauseReason || "User processing paused by admin",
        },
      );
      return {
        success: false,
        message: "User processing paused – search cancelled",
      } as any;
    }

    // Check if search is already in progress (unless force restart)
    if (!args.forceRestart && search.status === "in_progress") {
      throw new Error("Search is already in progress");
    }

    // Credits are validated at creation; deduction happens below via internal mutation

    try {
      // Update search status to in progress using scheduler
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "in_progress",
        },
      );

      // Create child context for discovery operation
      const discoveryCorrelation = createChildContext(
        correlation,
        OPERATION_TYPES.GOOGLE_MAPS_API,
        {
          metadata: {
            query: search.parameters.keywords.join(" "),
            location: search.parameters.location,
            radius: search.parameters.radius,
          },
        },
      );

      logWithCorrelation(
        "info",
        discoveryCorrelation,
        "🔍 Starting Google Maps API Lead Discovery",
        {
          query: search.parameters.keywords.join(" "),
          location: search.parameters.location,
          radius: search.parameters.radius,
          maxResults: search.parameters.maxResults,
        },
      );

      // Re-check cancellation before external calls
      {
        const latest = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: args.searchId,
          },
        );
        if (!latest || latest.status === "cancelled") {
          return {
            success: false,
            message: "Search cancelled",
          } as any;
        }
      }

      // Get Google Places API key (use user's key for enterprise users)
      let googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

      if (user?.plan === "enterprise") {
        try {
          const providerKeys = await ctx.runAction(
            internal.userApiKeys.actions.resolveUserProviderKeys,
            {
              userId: search.userId,
              purpose: "lead_search",
            },
          );

          const locationKey =
            providerKeys.google_places || providerKeys.google_maps;

          if (!locationKey) {
            throw new Error(
              getSingleProviderError("Google Places", "lead discovery")
            );
          }

          if (!providerKeys.google_places && providerKeys.google_maps) {
            console.warn(
              `BYOK: Enterprise user ${search.userId} is using legacy google_maps key. Ask them to re-save as google_places.`,
            );
          }

          googleMapsApiKey = locationKey;
        } catch (error) {
          if (error instanceof Error && /Enterprise users must provide/.test(error.message)) {
            throw error;
          }
          throw new Error(
            getSingleProviderError("Google Places", "lead discovery")
          );
        }
      }

      if (!googleMapsApiKey) {
        throw new Error("Google Places API key not configured");
      }

      const deduplicationConfig = {
        enablePlaceNameDedup:
          search.parameters.deduplication?.enablePlaceNameDedup ??
          user?.preferences?.enablePlaceNameDedup ??
          false,
        enableEmailDedup:
          search.parameters.deduplication?.enableEmailDedup ??
          user?.preferences?.enableEmailDedup ??
          true,
        enableAddressDedup:
          search.parameters.deduplication?.enableAddressDedup ??
          user?.preferences?.enableAddressDedup ??
          true,
      };

      const maxExpansionIterations = Math.max(
        0,
        Math.min(
          Math.round(
            user?.preferences?.maxSearchExpansionIterations ??
              DEFAULT_EXPANSION_ITERATIONS,
          ),
          DEFAULT_EXPANSION_ITERATIONS,
        ),
      );
      const expansionRadiusMultiplier = clamp(
        user?.preferences?.searchExpansionMultiplier ??
          DEFAULT_EXPANSION_MULTIPLIER,
        1.1,
        MAX_RADIUS_MULTIPLIER,
      );

      const processedPlaceIds = new Set<string>();
      const placeDetailsCache = new Map<string, GooglePlaceDetails>();
      const duplicateCounters = {
        placeId: 0,
        placeName: 0,
        address: 0,
      };
      const areaLeadBreakdown = {
        initial: 0,
        expansion: 0,
      };
      let duplicatesFromTiles = 0;
      let rawPlacesDiscovered = 0;
      let expansionIterationsUsed = 0;
      let finalRadiusMeters = 0;
      const leadIds: string[] = [];

      const ensureSearchActive = async () => {
        const current = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: args.searchId,
          },
        );
        return current && current.status !== "cancelled";
      };

      const fetchDetailedPlace = async (
        place: Place,
      ): Promise<GooglePlaceDetails> => {
        if (place.place_id && placeDetailsCache.has(place.place_id)) {
          return placeDetailsCache.get(place.place_id)!;
        }

        let detailedPlace: GooglePlaceDetails = place as GooglePlaceDetails;

        if (place.place_id) {
          try {
            const detailsUrl = new URL(
              "https://maps.googleapis.com/maps/api/place/details/json",
            );
            detailsUrl.searchParams.set("place_id", place.place_id);
            detailsUrl.searchParams.set(
              "fields",
              [
                "address_component",
                "formatted_address",
                "geometry",
                "website",
                "formatted_phone_number",
                "international_phone_number",
              ].join(","),
            );
            detailsUrl.searchParams.set("key", googleMapsApiKey!);

            const detailsResponse = await fetch(detailsUrl.toString());
            if (detailsResponse.ok) {
              const detailsData = (await detailsResponse.json()) as {
                status: string;
                result?: GooglePlaceDetails;
              };
              if (detailsData.status === "OK" && detailsData.result) {
                detailedPlace = {
                  ...place,
                  ...detailsData.result,
                } as GooglePlaceDetails;
              }
            }

            // Add small delay to respect rate limits
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            console.warn(
              `Failed to get place details for ${place.place_id}:`,
              error,
            );
          }
        }

        if (place.place_id) {
          placeDetailsCache.set(place.place_id, detailedPlace);
        }

        return detailedPlace;
      };

      const tryProcessPlace = async (
        place: Place,
        phase: "initial" | "expansion",
      ) => {
        if (!place || !place.place_id) {
          duplicateCounters.placeId++;
          return;
        }

        if (processedPlaceIds.has(place.place_id)) {
          duplicateCounters.placeId++;
          return;
        }
        processedPlaceIds.add(place.place_id);

        const detailedPlace = await fetchDetailedPlace(place);

        // 🚫 CRITICAL FILTER: Discard leads without website URLs
        // Without a website, leads cannot be enriched or researched effectively
        if (!detailedPlace.website) {
          logWithCorrelation(
            "debug",
            discoveryCorrelation,
            "⏭️ Skipping lead without website URL",
            {
              placeId: place.place_id,
              businessName: detailedPlace.name || "Unknown",
              reason: "no_website_url",
            },
          );
          return;
        }

        const basePlaceInfo = place as GooglePlaceDetails;
        const addressComponents =
          detailedPlace.address_components ??
          basePlaceInfo.address_components;

        const city =
          findAddressComponentValue(addressComponents, ["locality"]) ??
          findAddressComponentValue(addressComponents, ["postal_town"]) ??
          findAddressComponentValue(addressComponents, [
            "administrative_area_level_2",
          ]);

        const state = findAddressComponentValue(
          addressComponents,
          ["administrative_area_level_1"],
          { preferShort: true },
        );

        const country = findAddressComponentValue(addressComponents, ["country"]);

        const postalCode = findAddressComponentValue(
          addressComponents,
          ["postal_code"],
        );

        const leadResult = await ctx.runMutation(
          internal.leads.internal.createLeadInternal,
          {
            userId: search.userId,
            searchId: args.searchId,
            deduplication: deduplicationConfig,
            leadData: {
              businessName: detailedPlace.name || "Unknown",
              address: detailedPlace.formatted_address || "",
              placeId: detailedPlace.place_id || place.place_id,
              location: {
                lat:
                  detailedPlace.geometry?.location?.lat ??
                  basePlaceInfo.geometry?.location?.lat ??
                  0,
                lng:
                  detailedPlace.geometry?.location?.lng ??
                  basePlaceInfo.geometry?.location?.lng ??
                  0,
                formattedAddress:
                  detailedPlace.formatted_address ??
                  basePlaceInfo.formatted_address ??
                  "",
                city: city ?? undefined,
                state: state ?? undefined,
                country: country ?? undefined,
                postalCode: postalCode ?? undefined,
              },
              phone:
                detailedPlace.formatted_phone_number ||
                (detailedPlace as any).international_phone_number ||
                undefined,
              website: detailedPlace.website, // Always has value due to filter above
              rating: detailedPlace.rating || undefined,
              reviewCount: detailedPlace.user_ratings_total || undefined,
              category: detailedPlace.types?.[0] || undefined,
            },
          },
        );

        if (leadResult?.status === "created") {
          leadIds.push(leadResult.leadId);
          if (phase === "initial") {
            areaLeadBreakdown.initial++;
          } else {
            areaLeadBreakdown.expansion++;
          }
          return;
        }

        if (leadResult?.status === "skipped") {
          if (
            leadResult.reason === "search_level" ||
            leadResult.reason === "user_level"
          ) {
            duplicateCounters.placeId++;
          } else if (leadResult.reason === "place_name") {
            duplicateCounters.placeName++;
          } else if (leadResult.reason === "address") {
            duplicateCounters.address++;
          }
        }
      };

      const processPlacesBatch = async (
        placesToProcess: Place[],
        phase: "initial" | "expansion",
      ) => {
        for (const place of placesToProcess) {
          if (leadIds.length >= requestedResults) {
            return true;
          }

          const active = await ensureSearchActive();
          if (!active) {
            return false;
          }

          await tryProcessPlace(place, phase);
        }
        return true;
      };

      // Build search query
      const params: any = search.parameters;
      const location = params.location;
      const requestedResults = search.parameters.maxResults;

      // 🎯 SMART RADIUS: Estimate optimal radius based on request size
      const userRadiusMiles = params.radius;
      const optimalRadiusMiles = estimateOptimalRadius(requestedResults, userRadiusMiles);
      const radiusMiles = optimalRadiusMiles;

      // Log if we're suggesting a larger radius
      if (optimalRadiusMiles > userRadiusMiles) {
        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "📏 Increasing search radius for large request",
          {
            requestedResults,
            userRadiusMiles,
            optimalRadiusMiles,
            reason: "Large searches need wider coverage area",
          },
        );
      }

      const requestedRadiusMeters = Math.max(radiusMiles, 0) * METERS_PER_MILE;
      const radius = Math.round(
        Math.min(requestedRadiusMeters, MAX_PLACES_RADIUS_METERS),
      );

      if (requestedRadiusMeters > MAX_PLACES_RADIUS_METERS) {
        logWithCorrelation(
          "warn",
          discoveryCorrelation,
          "Requested radius exceeds Google Places API limit. Clamping to 50km (~31 miles).",
          {
            requestedRadiusMiles: radiusMiles,
            appliedRadiusMeters: radius,
          },
        );
      }

      // 🔍 BUILD QUERY: Strategy-specific query construction
      // - Text Search API: Needs location in query string (e.g., "Marketing in Jackson, MS")
      // - Nearby Search API: Uses lat/lng for location, keyword should be pure search term (e.g., "Marketing")
      const keywords = params.keywords.join(" ");

      // For Text Search fallback (when geocoding fails)
      const textSearchQuery = location
        ? `${keywords} in ${location}`
        : keywords;

      // For Nearby Search API (spatial tiling) - pure keyword without location
      const nearbyKeyword = keywords;

      logWithCorrelation(
        "info",
        discoveryCorrelation,
        "🔍 Search Query Construction",
        {
          keywords,
          location,
          textSearchQuery,
          nearbyKeyword,
          radiusMiles,
        },
      );

      // Enhanced location resolution: Use Place Details API with place_id OR geocoding fallback
      let lat: number, lng: number;
      let bounds: Bounds | undefined;
      const locationPlaceId = params.locationPlaceId;

      // 🎯 STRATEGY 1: Use Place Details API with place_id (most accurate)
      if (locationPlaceId) {
        try {
          const placeDetailsUrl = new URL(
            "https://maps.googleapis.com/maps/api/place/details/json",
          );
          placeDetailsUrl.searchParams.set("place_id", locationPlaceId);
          // Request only needed fields to minimize billing (per Google's best practices)
          placeDetailsUrl.searchParams.set(
            "fields",
            "geometry,formatted_address,types,address_components",
          );
          placeDetailsUrl.searchParams.set("key", googleMapsApiKey);

          const placeDetailsResponse = await fetch(placeDetailsUrl.toString());
          const placeDetailsData = (await placeDetailsResponse.json()) as {
            status: string;
            result?: {
              geometry: {
                location: { lat: number; lng: number };
                viewport: {
                  northeast: { lat: number; lng: number };
                  southwest: { lat: number; lng: number };
                };
              };
              formatted_address: string;
              types: string[];
              address_components?: Array<{
                long_name: string;
                short_name: string;
                types: string[];
              }>;
            };
          };

          if (
            placeDetailsData.status === "OK" &&
            placeDetailsData.result?.geometry
          ) {
            const result = placeDetailsData.result;
            lat = result.geometry.location.lat;
            lng = result.geometry.location.lng;

            // Place Details API always provides viewport bounds
            bounds = {
              ne: {
                lat: result.geometry.viewport.northeast.lat,
                lng: result.geometry.viewport.northeast.lng,
              },
              sw: {
                lat: result.geometry.viewport.southwest.lat,
                lng: result.geometry.viewport.southwest.lng,
              },
            };

            // Validate location type to detect city vs county ambiguity
            const isCity = result.types.includes("locality");
            const isCounty = result.types.includes("administrative_area_level_2");
            const locationType = isCity
              ? "city"
              : isCounty
                ? "county"
                : result.types[0] || "unknown";

            logWithCorrelation(
              "info",
              discoveryCorrelation,
              "✅ Place Details API Resolution Successful (using place_id)",
              {
                placeId: locationPlaceId,
                formattedAddress: result.formatted_address,
                locationType,
                types: result.types,
                coordinates: { lat, lng },
                hasBounds: !!bounds,
                isCity,
                isCounty,
                boundsArea: {
                  latSpan: bounds.ne.lat - bounds.sw.lat,
                  lngSpan: bounds.ne.lng - bounds.sw.lng,
                },
              },
            );

            // ⚠️ Warning: Detect if we got a county instead of a city
            if (isCounty && !isCity) {
              logWithCorrelation(
                "warn",
                discoveryCorrelation,
                "⚠️ Location is a COUNTY, not a city - results may span large area",
                {
                  locationType: "county",
                  formattedAddress: result.formatted_address,
                  suggestion:
                    "User may have intended a city. Consider UI hint for location selection.",
                },
              );
            }
          } else {
            // Place Details API failed (expired place_id, etc.)
            throw new Error(
              `Place Details API failed: ${placeDetailsData.status}`,
            );
          }
        } catch (placeDetailsError) {
          logWithCorrelation(
            "warn",
            discoveryCorrelation,
            "⚠️ Place Details API Failed - Falling back to Geocoding API",
            {
              placeId: locationPlaceId,
              reason: (placeDetailsError as Error).message,
            },
            placeDetailsError as Error,
          );
          // Fall through to geocoding fallback below
        }
      }

      // 🔄 STRATEGY 2: Geocoding API fallback (when place_id not available or failed)
      if (!lat || !lng) {
        try {
          const geocodeUrl = new URL(
            "https://maps.googleapis.com/maps/api/geocode/json",
          );
          geocodeUrl.searchParams.set("address", location);
          geocodeUrl.searchParams.set("key", googleMapsApiKey);

          const geocodeResponse = await fetch(geocodeUrl.toString());
          const geocodeData = (await geocodeResponse.json()) as {
            status: string;
            results?: Array<{
              geometry: {
                location: { lat: number; lng: number };
                viewport?: {
                  northeast: { lat: number; lng: number };
                  southwest: { lat: number; lng: number };
                };
                bounds?: {
                  northeast: { lat: number; lng: number };
                  southwest: { lat: number; lng: number };
                };
              };
              formatted_address: string;
              types: string[];
            }>;
          };

          if (geocodeData.status !== "OK" || !geocodeData.results?.[0]) {
            throw new Error(`Geocoding failed: ${geocodeData.status}`);
          }

          const result = geocodeData.results[0];
          const coordinates = result.geometry.location;
          lat = coordinates.lat;
          lng = coordinates.lng;

          // Extract bounds (prefer bounds, fallback to viewport)
          const geoBounds = result.geometry.bounds || result.geometry.viewport;
          if (geoBounds) {
            bounds = {
              ne: {
                lat: geoBounds.northeast.lat,
                lng: geoBounds.northeast.lng,
              },
              sw: {
                lat: geoBounds.southwest.lat,
                lng: geoBounds.southwest.lng,
              },
            };
          }

          // Validate location type for geocoding results too
          const isCity = result.types.includes("locality");
          const isCounty = result.types.includes("administrative_area_level_2");
          const locationType = isCity
            ? "city"
            : isCounty
              ? "county"
              : result.types[0] || "unknown";

          logWithCorrelation(
            "info",
            discoveryCorrelation,
            "📍 Geocoding API Resolution Successful (string-based)",
            {
              originalLocation: location,
              formattedAddress: result.formatted_address,
              locationType,
              types: result.types,
              geocodedCoordinates: { lat, lng },
              hasBounds: !!bounds,
              isCity,
              isCounty,
              boundsArea: bounds
                ? {
                    latSpan: bounds.ne.lat - bounds.sw.lat,
                    lngSpan: bounds.ne.lng - bounds.sw.lng,
                  }
                : undefined,
            },
          );

          // ⚠️ Warning: Detect county ambiguity in geocoding results
          if (isCounty && !isCity) {
            logWithCorrelation(
              "warn",
              discoveryCorrelation,
              "⚠️ Geocoding returned COUNTY instead of CITY - may cause geographic mismatch",
              {
                searchedFor: location,
                geocodedTo: result.formatted_address,
                locationType: "county",
                types: result.types,
                suggestion:
                  "Results may be far from intended location. Consider using place_id from frontend.",
              },
            );
          }
        } catch (geocodeError) {
          logWithCorrelation(
            "warn",
            discoveryCorrelation,
            "⚠️ All Location Resolution Failed - Using Text Search Fallback",
            { originalLocation: location },
            geocodeError as Error,
          );
          // Fallback: use text search without location bias
          lat = 0;
          lng = 0;
          bounds = undefined;
        }
      }

      // 🎯 ADAPTIVE STRATEGY: Always use spatial tiling for location-based searches
      // This ensures STRICT geographic filtering via Nearby Search API
      // Text Search API only used as fallback when geocoding fails
      useTiling = (!!bounds || (lat !== 0 && lng !== 0));

      // 📊 SCALE MAX TILES: Increase capacity for large searches
      // Google Places API returns max 60 results per query (20 per page × 3 pages)
      // More tiles = more coverage for large result requirements
      const maxTilesForSearch = requestedResults > 300 ? 400 : requestedResults > 150 ? 300 : 250;
      const concurrencyForSearch = requestedResults > 300 ? 7 : 5;

      let places: Place[] = [];
      totalApiCalls = 0;

      if (useTiling) {
        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "🗺️ Using SPATIAL TILING strategy with STRICT geographic filtering",
          {
            maxResults: requestedResults,
            hasBounds: !!bounds,
            hasCenter: lat !== 0 && lng !== 0,
            strategy: "tiled_search_nearby_api",
            fetchMultiplier: INITIAL_FETCH_MULTIPLIER,
            maxTiles: maxTilesForSearch,
            concurrency: concurrencyForSearch,
            estimatedTiles: Math.ceil(requestedResults / 50),
            estimatedApiCalls: Math.ceil(requestedResults / 50) * 3,
            apiNote: "Using Nearby Search API for strict radius enforcement",
          },
        );

        const initialFetchCount = Math.ceil(
          requestedResults * INITIAL_FETCH_MULTIPLIER,
        );

        const tilingResult = await searchPlacesWithTiling({
          apiKey: googleMapsApiKey,
          query: nearbyKeyword,
          type: "establishment",
          keyword: nearbyKeyword,
          bounds: bounds || undefined,
          center: bounds ? undefined : { lat, lng },
          radiusMeters: bounds ? undefined : radius,
          maxResults: initialFetchCount,
          maxTiles: maxTilesForSearch,
          concurrency: concurrencyForSearch,
          correlation: discoveryCorrelation,
          shouldCancel: async () => !(await ensureSearchActive()),
        });

        places = tilingResult.places;
        totalApiCalls = tilingResult.totalApiCalls;
        rawPlacesDiscovered += places.length;
        duplicatesFromTiles += tilingResult.duplicatesFiltered;

        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "✅ TILED SEARCH COMPLETE",
          {
            bufferedTarget: initialFetchCount,
            placesFound: places.length,
            tilesSearched: tilingResult.tilesSearched,
            apiCalls: totalApiCalls,
            duplicatesFiltered: tilingResult.duplicatesFiltered,
            efficiency:
              totalApiCalls > 0
                ? ((places.length / totalApiCalls) * 100).toFixed(1) +
                  "% places per API call"
                : "N/A",
            timeMs: tilingResult.timeMs,
          },
        );
      } else {
        logWithCorrelation(
          "warn",
          discoveryCorrelation,
          "⚠️ FALLBACK: Using Text Search API (geocoding failed)",
          {
            maxResults: params.maxResults,
            strategy: "text_search_fallback",
            maxPages: 3,
            reason: "No valid coordinates or bounds from geocoding",
            note: "Location bias will be WEAK - results may include distant businesses",
          },
        );

        // FALLBACK: Use Text Search API when geocoding fails completely
        // Note: This has WEAK location filtering - results may span large geographic areas
        let nextPageToken: string | undefined = undefined;
        const maxPages = 3;
        let currentPage = 0;
        const paginationTarget = Math.ceil(
          requestedResults * INITIAL_FETCH_MULTIPLIER,
        );
        const simpleFetchCap = Math.max(requestedResults, paginationTarget);

        while (currentPage < maxPages && places.length < simpleFetchCap) {
          const placesUrl = new URL(
            "https://maps.googleapis.com/maps/api/place/textsearch/json",
          );
          placesUrl.searchParams.set("query", textSearchQuery);
          if (lat !== 0 && lng !== 0 && radius > 0) {
            placesUrl.searchParams.set("location", `${lat},${lng}`);
            placesUrl.searchParams.set("radius", radius.toString());
          }
          placesUrl.searchParams.set("type", "establishment");
          placesUrl.searchParams.set("key", googleMapsApiKey);

          if (nextPageToken) {
            placesUrl.searchParams.set("pagetoken", nextPageToken);
          }

          const response = await fetch(placesUrl.toString());
          if (!response.ok) {
            throw new Error(
              `Google Maps API error: ${response.status} ${response.statusText}`,
            );
          }
          totalApiCalls++;

          const data = (await response.json()) as {
            status: string;
            error_message?: string;
            results?: any[];
            next_page_token?: string;
          };

          if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            throw new Error(
              `Google Maps API error: ${data.status} - ${data.error_message || "Unknown error"}`,
            );
          }

          const pageResults = data.results || [];
          places.push(...pageResults);
          rawPlacesDiscovered += pageResults.length;

          logWithCorrelation(
            "info",
            discoveryCorrelation,
            `📄 Page ${currentPage + 1}: ${pageResults.length} results (total: ${places.length})`,
            {
              page: currentPage + 1,
              pageResults: pageResults.length,
              totalResults: places.length,
              hasNextPage: !!data.next_page_token,
            },
          );

          nextPageToken = data.next_page_token;
          currentPage++;

          if (!nextPageToken || places.length >= simpleFetchCap) {
            break;
          }

          // Check cancellation between pages
          const latest = await ctx.runQuery(
            internal.search.internal.getSearchInternal,
            { searchId: args.searchId },
          );
          if (!latest || latest.status === "cancelled") {
            return { success: false, message: "Search cancelled" } as any;
          }

          // Wait for token activation
          logWithCorrelation(
            "debug",
            discoveryCorrelation,
            "⏳ Waiting 2s for next page token",
            { nextPage: currentPage + 1 },
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "✅ SIMPLE PAGINATION COMPLETE",
          {
            placesFound: places.length,
            pagesSearched: currentPage,
            apiCalls: totalApiCalls,
          },
        );
      }

      // Final cancellation check before processing results
      {
        const latest = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          { searchId: args.searchId },
        );
        if (!latest || latest.status === "cancelled") {
          return { success: false, message: "Search cancelled" } as any;
        }
      }
      const processedInitial = await processPlacesBatch(places, "initial");
      if (!processedInitial) {
        return {
          success: false,
          message: "Search cancelled",
          totalFound: leadIds.length,
          leadIds,
        } as any;
      }

      const hasValidCenter = lat !== 0 || lng !== 0;
      const maxRadiusMeters = Math.min(
        radius * MAX_RADIUS_MULTIPLIER,
        MAX_PLACES_RADIUS_METERS,
      );
      finalRadiusMeters = radius;

      if (
        hasValidCenter &&
        leadIds.length < requestedResults &&
        maxExpansionIterations > 0
      ) {
        let currentRadiusMeters = radius;

        while (
          leadIds.length < requestedResults &&
          expansionIterationsUsed < maxExpansionIterations &&
          currentRadiusMeters < maxRadiusMeters
        ) {
          const nextRadiusMeters = Math.min(
            Math.max(
              Math.ceil(currentRadiusMeters * expansionRadiusMultiplier),
              currentRadiusMeters + 500,
            ),
            maxRadiusMeters,
          );

          if (nextRadiusMeters <= currentRadiusMeters) {
            break;
          }

          const previousBounds = boundsFromCenterRadius(
            { lat, lng },
            currentRadiusMeters,
          );
          const expandedBounds = boundsFromCenterRadius(
            { lat, lng },
            nextRadiusMeters,
          );
          const ringSegments = computeRingSegments(
            previousBounds,
            expandedBounds,
          );

          if (ringSegments.length === 0) {
            break;
          }

          expansionIterationsUsed++;

          for (const segment of ringSegments) {
            const remainingNeed = requestedResults - leadIds.length;
            const segmentFetchCount = Math.max(
              Math.ceil(remainingNeed * INITIAL_FETCH_MULTIPLIER),
              requestedResults,
            );

            // 📊 SCALE EXPANSION RESOURCES: Increase for large searches
            const expansionMaxTiles = requestedResults > 300 ? 200 : requestedResults > 150 ? 150 : 120;
            const expansionConcurrency = requestedResults > 300 ? 6 : 4;

            const expansionResult = await searchPlacesWithTiling({
              apiKey: googleMapsApiKey,
              query: nearbyKeyword,
              type: "establishment",
              keyword: nearbyKeyword,
              bounds: segment,
              radiusMeters: nextRadiusMeters,
              maxResults: segmentFetchCount,
              maxTiles: expansionMaxTiles,
              concurrency: expansionConcurrency,
              correlation: discoveryCorrelation,
              shouldCancel: async () => !(await ensureSearchActive()),
            });

            totalApiCalls += expansionResult.totalApiCalls;
            duplicatesFromTiles += expansionResult.duplicatesFiltered;
            rawPlacesDiscovered += expansionResult.places.length;

            const processedExpansion = await processPlacesBatch(
              expansionResult.places,
              "expansion",
            );
            if (!processedExpansion) {
              return {
                success: false,
                message: "Search cancelled",
                totalFound: leadIds.length,
                leadIds,
              } as any;
            }

            if (leadIds.length >= requestedResults) {
              break;
            }
          }

          currentRadiusMeters = nextRadiusMeters;
          finalRadiusMeters = currentRadiusMeters;

          if (leadIds.length >= requestedResults) {
            break;
          }
        }
      }

      const deliveredLeads = leadIds.length;
      const shortfall = Math.max(requestedResults - deliveredLeads, 0);
      const totalDuplicatesPlaceId =
        duplicateCounters.placeId + duplicatesFromTiles;

      await ctx.runMutation(
        internal.search.internal.updateSearchProgressInternal,
        {
          searchId: args.searchId,
          progress: {
            discovered: deliveredLeads,
            enriched: 0,
            analyzed: 0,
            total: deliveredLeads,
          },
          partialResults: deliveredLeads < requestedResults,
          requestedCount: requestedResults,
        },
      );

      await ctx.runMutation(
        internal.search.internal.updateDiscoveryMetadataInternal,
        {
          searchId: args.searchId,
          initialSearchRadius: radius,
          finalSearchRadius: finalRadiusMeters,
          expansionIterations: expansionIterationsUsed,
          duplicatesFilteredPlaceId: totalDuplicatesPlaceId,
          duplicatesFilteredPlaceName: duplicateCounters.placeName,
          duplicatesFilteredAddress: duplicateCounters.address,
          discoveryMetadata: {
            requested: requestedResults,
            delivered: deliveredLeads,
            shortfall,
            expanded: expansionIterationsUsed > 0,
            originalAreaLeads: areaLeadBreakdown.initial,
            expansionAreaLeads: areaLeadBreakdown.expansion,
            expansionMessage:
              expansionIterationsUsed > 0
                ? deliveredLeads >= requestedResults
                  ? `Found ${deliveredLeads} leads after expanding search radius ${expansionIterationsUsed}×`
                  : `Found ${deliveredLeads} of ${requestedResults} leads after ${expansionIterationsUsed} expansions (max radius reached)`
                : `Found ${deliveredLeads} leads in the original search area`,
          },
        },
      );

      logWithCorrelation(
        "info",
        discoveryCorrelation,
        "✅ Google Maps API Discovery Completed",
        {
          deliveredLeads,
          requestedMax: requestedResults,
          rawPlacesDiscovered,
          duplicatesFilteredPlaceId: totalDuplicatesPlaceId,
          duplicatesFilteredPlaceName: duplicateCounters.placeName,
          duplicatesFilteredAddress: duplicateCounters.address,
          expansionIterations: expansionIterationsUsed,
          finalRadiusMeters,
          strategy: useTiling ? "spatial_tiling" : "simple_pagination",
          apiCalls: totalApiCalls,
          efficiency:
            totalApiCalls > 0
              ? (deliveredLeads / totalApiCalls).toFixed(2) +
                " leads/API call"
              : "N/A",
        },
      );

      if (deliveredLeads < requestedResults) {
        const foundPercentage =
          requestedResults > 0
            ? (deliveredLeads / requestedResults) * 100
            : 0;
        const warningMessage =
          expansionIterationsUsed > 0
            ? `Found ${deliveredLeads} of ${requestedResults} requested leads after ${expansionIterationsUsed} expansions (max area reached)`
            : `Found ${deliveredLeads} of ${requestedResults} requested leads in this area`;

        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ PARTIAL RESULTS: Fewer leads found than requested",
          {
            requested: requestedResults,
            found: deliveredLeads,
            shortfall,
            percentage: foundPercentage,
            expansionsAttempted: expansionIterationsUsed,
          },
        );

        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: args.searchId,
            stage: "discovery_complete",
            progress: 33,
            priority: "high",
            message: warningMessage,
            data: {
              partialResults: true,
              requested: requestedResults,
              found: deliveredLeads,
              shortfall,
              duplicatesFiltered: {
                placeId: totalDuplicatesPlaceId,
                placeName: duplicateCounters.placeName,
                address: duplicateCounters.address,
              },
              expansions: expansionIterationsUsed,
              suggestions:
                shortfall > requestedResults * 0.5
                  ? [
                      "Try increasing search radius",
                      "Use broader keywords",
                      "Expand to nearby cities",
                    ]
                  : [
                      "Try increasing search radius slightly",
                      "Adjust keyword specificity",
                    ],
            },
          },
        );
      }

      // Update search status to processing (discovery complete, but pipeline continues)
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "processing", // Changed from "completed" - pipeline continues
        },
      );

      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 1 COMPLETE: Google Maps Discovery Phase Finished",
        {
          totalFound: deliveredLeads,
          leadIds: leadIds.length,
          discoveryDurationMs: performanceData?.duration || 0,
          averageTimePerLead:
            deliveredLeads > 0
              ? (performanceData?.duration || 0) / deliveredLeads
              : 0,
          nextPhase: "lead_enrichment",
          phaseCompletionRate: 100,
          // API efficiency metrics
          strategy: useTiling ? "spatial_tiling" : "simple_pagination",
          totalApiCalls,
          placesPerApiCall:
            totalApiCalls > 0
              ? (deliveredLeads / totalApiCalls).toFixed(2)
              : "N/A",
          apiCostEfficiency:
            totalApiCalls > 0
              ? ((deliveredLeads / totalApiCalls) * 100).toFixed(1) + "%"
              : "N/A",
        },
      );

      // If no leads found, complete the search immediately
      if (deliveredLeads === 0) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ PHASE 1 COMPLETE: No Leads Found - Pipeline Ending",
          {
            searchQuery: search.parameters.keywords.join(" "),
            location: search.parameters.location,
            reason: "zero_results",
          },
        );
        
        await ctx.runMutation(
          internal.search.internal.updateSearchStatusInternal,
          {
            searchId: args.searchId,
            status: "completed",
          },
        );

        return {
          success: true,
          message: "Search completed - no results found",
          totalFound: 0,
          leadIds: [],
        };
      }

      // Trigger enrichment stage for discovered leads (if not cancelled)
      {
        const latest = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: args.searchId,
          },
        );
        if (latest && latest.status !== "cancelled") {
          logWithCorrelation(
            "info",
            correlation,
            "🔄 PHASE TRANSITION: Triggering Phase 2 (Lead Enrichment)",
            {
              leadsToEnrich: deliveredLeads,
              schedulingDelay: "immediate",
            },
          );
          
          await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
            searchId: args.searchId,
          });
        }
      }

      return {
        success: true,
        message: `Discovered ${deliveredLeads} potential leads using ${useTiling ? "spatial tiling" : "pagination"} (${totalApiCalls} API calls)`,
        totalFound: deliveredLeads,
        leadIds,
        strategy: useTiling ? "spatial_tiling" : "simple_pagination",
        apiCalls: totalApiCalls,
      };
    } catch (error) {
      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "error",
        correlation,
        "💥 PHASE 1 FAILED: Google Maps Discovery Phase Error",
        {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          duration: performanceData?.duration || 0,
          searchQuery: search?.parameters?.keywords?.join(" ") || "unknown",
          location: search?.parameters?.location || "unknown",
          strategy: useTiling ? "spatial_tiling" : "simple_pagination",
          apiCallsBeforeFailure: totalApiCalls || 0,
        },
        error as Error,
      );

      // Update search status to failed using scheduler
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );

      throw error;
    }
  },
});

// Complete the search pipeline and finalize results
export const completeSearch: any = action({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Create correlation context for completion phase
    const correlation = createCorrelationContext(
      OPERATION_TYPES.SEARCH_COMPLETION,
      "system", // Will be updated with actual userId
      {
        searchId: args.searchId,
        metadata: {
          stage: "search_completion",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    logWithCorrelation(
      "info",
      correlation,
      "🏁 PIPELINE COMPLETION: Finalizing Search Results",
      {
        searchId: args.searchId,
        timestamp: new Date().toISOString(),
      },
    );

    try {

      // Get search info
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        {
          searchId: args.searchId,
        },
      );

      if (!search) {
        throw new Error("Search not found");
      }

      // Calculate final results
      const results: any = await ctx.runQuery(
        internal.search.internal.getSearchResults,
        {
          searchId: args.searchId,
        },
      );

      // Get search results for analytics and completion message
      const totalFound =
        typeof results.totalFound === "number" ? results.totalFound : 0;
      const enrichedCount =
        typeof results.enrichedCount === "number" ? results.enrichedCount : 0;
      const analyzedCount =
        typeof results.analyzedCount === "number" ? results.analyzedCount : 0;

      // Determine credit costs for this search execution using new per-search model
      // Base cost: 1 credit per search (includes discovery, enrichment, and AI analysis)
      // Additional cost: +1 credit if using Perplexity deep research (tier 3)
      const baseCost = CREDIT_COSTS.SEARCH_BASE;
      const deepResearchCost = search.researchTier === "perplexity"
        ? CREDIT_COSTS.SEARCH_DEEP_RESEARCH
        : 0;

      const totalCreditsUsed = baseCost + deepResearchCost;

      // For backward compatibility and analytics, track breakdown
      const creditBreakdown = {
        base: baseCost,
        deepResearch: deepResearchCost,
        total: totalCreditsUsed,
      } as const;

      const previouslyRecordedCredits = search.creditsUsed || 0;
      const creditsToCharge = Math.max(
        totalCreditsUsed - previouslyRecordedCredits,
        0,
      );

      // BYOK: Check if enterprise user with own API keys (skip credit charging)
      // Use internal query since action contexts don't have ctx.db
      const bypassCredits = await ctx.runQuery(
        internal.lib.creditHelpers.shouldBypassCreditsQuery,
        { userId: search.userId }
      );

      if (creditsToCharge > 0 && !bypassCredits) {
        const researchTierLabel = search.researchTier === "perplexity" ? " (Tier 3 - Deep Research)" : "";
        await ctx.runMutation(internal.credits.transactions.recordTransaction, {
          userId: search.userId,
          amount: creditsToCharge,
          operation: "usage",
          description: `Search "${search.name}"${researchTierLabel} - ${totalCreditsUsed} credit${totalCreditsUsed > 1 ? 's' : ''}`,
          relatedEntityType: "search",
          relatedEntityId: args.searchId as unknown as string,
        });
      } else if (bypassCredits && creditsToCharge > 0) {
        console.log(
          `BYOK: Skipping ${creditsToCharge} credit charge for enterprise search ${args.searchId}`
        );

        // Log the credit bypass for audit trail
        const results = await ctx.runQuery(internal.search.internal.getSearchResults, {
          searchId: args.searchId,
        });
        await ctx.runMutation(internal.lib.auditLog.logCreditBypass, {
          userId: search.userId,
          operation: `Search "${search.name}" completed`,
          creditsSkipped: creditsToCharge,
          providers: [], // Will be populated with actual providers in future enhancement
          relatedEntityType: "search",
          relatedEntityId: args.searchId as unknown as string,
          metadata: {
            totalFound: results.totalFound,
            enrichedCount: results.enrichedCount,
            analyzedCount: results.analyzedCount,
            researchTier: search.researchTier,
            creditBreakdown,
          },
        });
      }

      // Update search status to completed with final results
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "completed",
        },
      );

      // Update search progress and results
      await ctx.runMutation(internal.search.internal.updateSearchResults, {
        searchId: args.searchId,
        results: {
          totalFound,
          enrichedCount,
          analyzedCount,
          avgRelevanceScore: results.avgRelevanceScore,
        },
        progress: {
          discovered: totalFound,
          enriched: enrichedCount,
          analyzed: analyzedCount,
          total: totalFound,
        },
        creditsUsed: totalCreditsUsed,
      });

      // Build completion message with partial results awareness
      const isPartialResults = search.partialResults === true;
      const requestedCount = search.requestedCount || search.parameters.maxResults;

      let completionMessage = `Search completed! Found ${totalFound} leads, enriched ${enrichedCount}, analyzed ${analyzedCount}`;
      if (isPartialResults && requestedCount) {
        const foundPercentage = ((totalFound / requestedCount) * 100).toFixed(0);
        completionMessage = `Search completed with partial results: Found ${totalFound} of ${requestedCount} requested leads (${foundPercentage}%). Enriched ${enrichedCount}, analyzed ${analyzedCount}. Consider expanding search radius or adjusting keywords.`;
      }

      // Send final pipeline update broadcast
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: search.userId,
          searchId: args.searchId,
          stage: "completed",
          progress: 100,
          priority: isPartialResults ? "high" : "normal",
          message: completionMessage,
          data: {
            results: {
              totalFound,
              enrichedCount,
              analyzedCount,
              avgRelevanceScore: results.avgRelevanceScore,
            },
            progress: {
              discovered: totalFound,
              enriched: enrichedCount,
              analyzed: analyzedCount,
              total: totalFound,
            },
            creditsUsed: totalCreditsUsed,
            creditBreakdown,
            partialResults: isPartialResults,
            requestedCount: isPartialResults ? requestedCount : undefined,
          },
        },
      );

      // Send completion notification
      try {
        await ctx.runAction(
          internal.notifications.actions.sendSearchCompletedEmail,
          {
            searchId: args.searchId,
            results: results,
          },
        );
      } catch (error) {
        // Don't fail the completion if email fails
        console.warn(
          `Failed to send completion email for search ${args.searchId}:`,
          error,
        );
      }

      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "info",
        correlation,
        "🎉 PIPELINE COMPLETE: Search Successfully Finished",
        {
          totalLeads: totalFound,
          enrichedLeads: enrichedCount,
          analyzedLeads: analyzedCount,
          avgRelevanceScore: results.avgRelevanceScore,
          completionDurationMs: performanceData?.duration || 0,
          enrichmentRate: totalFound > 0 ? (enrichedCount / totalFound) * 100 : 0,
          analysisRate: totalFound > 0 ? (analyzedCount / totalFound) * 100 : 0,
          finalStatus: "completed",
          creditsUsed: totalCreditsUsed,
          creditBreakdown,
        },
      );

      return {
        success: true,
        message: "Search completed successfully",
        results: results,
        creditsUsed: totalCreditsUsed,
      };
    } catch (error) {
      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "error",
        correlation,
        "💥 PIPELINE FAILED: Search Completion Error",
        {
          duration: performanceData?.duration || 0,
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
        },
        error as Error,
      );

      // Update search status to failed
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "failed",
          error:
            error instanceof Error ? error.message : "Search completion failed",
        },
      );

      throw error;
    }
  },
});
