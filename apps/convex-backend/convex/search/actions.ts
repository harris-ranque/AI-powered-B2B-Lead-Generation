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
import {
  createApiConvexError,
  shouldBlockPipeline,
  type ApiError,
} from "../lib/apiErrors";
import { normalizeAddress } from "../lib/deduplication";
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
    // BLOCKING: Fail fast if LangGraph is down to prevent cascade failures
    try {
      const healthCheckResult = await ctx.runAction(
        internal.langgraph.health.checkLangGraphHealth,
        {},
      );

      if (!healthCheckResult?.success) {
        const errorMessage = healthCheckResult?.error || "LangGraph worker is not responding";
        logWithCorrelation(
          "error",
          correlation,
          "❌ LangGraph health check FAILED - blocking search",
          {
            status: healthCheckResult?.status ?? "unknown",
            error: errorMessage,
            blockingReason: "prevent_cascade_failure",
          },
        );
        throw new Error(`LangGraph worker health check failed: ${errorMessage}. Please try again in a few minutes.`);
      }

      logWithCorrelation(
        "info",
        correlation,
        "✅ LangGraph health check PASSED - proceeding with search",
        {
          status: healthCheckResult?.status ?? "healthy",
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Health check failed";
      logWithCorrelation(
        "error",
        correlation,
        "❌ LangGraph health check ERROR - blocking search",
        {
          error: errorMessage,
          blockingReason: "prevent_cascade_failure",
        },
      );
      throw new Error(`LangGraph worker health check failed: ${errorMessage}. Please try again in a few minutes.`);
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

            // Place Details API fields:
            // - formatted_address (Basic Data - FREE) ✅
            // - geometry (Basic Data - FREE) ✅
            // - website (Contact Data SKU - $0.003/call) ✅ REQUIRED for lead enrichment
            // - international_phone_number (Contact Data SKU - $0.003/call) ✅ REQUIRED for CSV export
            //
            // NOTE: Nearby Search API does NOT return website or phone fields - must fetch via Place Details
            detailsUrl.searchParams.set(
              "fields",
              "formatted_address,geometry,website,international_phone_number"
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

        // Fetch detailed place info including website from Place Details API
        // NOTE: Nearby Search API does NOT return website field - must fetch via Place Details
        const detailedPlace = await fetchDetailedPlace(place);

        // Filter leads without website (website only available after Place Details call)
        if (!detailedPlace.website) {
          logWithCorrelation(
            "debug",
            discoveryCorrelation,
            "⏭️ Skipping lead without website URL (post-fetch validation)",
            {
              placeId: place.place_id,
              businessName: detailedPlace.name || "Unknown",
              reason: "no_website_url_after_details",
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

        // ========================================================================
        // ADDRESS DEDUPLICATION (Paginated Query - Safe for Large User Datasets)
        // ========================================================================
        // Check for duplicate address BEFORE calling mutation.
        // Uses paginated query that can safely iterate through all user leads.
        // This avoids the Convex "multiple paginated queries" error in mutations.
        if (deduplicationConfig.enableAddressDedup && detailedPlace.formatted_address) {
          const normalizedAddr = normalizeAddress(detailedPlace.formatted_address);

          if (normalizedAddr) {
            let addressCursor: string | null = null;
            let addressDedupDone = false;
            let duplicateAddressLeadId: string | null = null;

            // Iterate through all pages of user's leads to check for address match
            while (!addressDedupDone) {
              const dedupResult: {
                found: boolean;
                duplicateId: string | null;
                continueCursor: string | null;
                isDone: boolean;
              } = await ctx.runQuery(
                internal.leads.internal.checkAddressDuplicatePage,
                {
                  userId: search.userId,
                  normalizedAddress: normalizedAddr,
                  cursor: addressCursor ?? undefined,
                  batchSize: 1000,
                },
              );

              if (dedupResult.found && dedupResult.duplicateId) {
                duplicateAddressLeadId = dedupResult.duplicateId;
                addressDedupDone = true;
              } else if (dedupResult.isDone) {
                addressDedupDone = true;
              } else {
                addressCursor = dedupResult.continueCursor;
              }
            }

            // If duplicate address found, skip this lead
            if (duplicateAddressLeadId) {
              logWithCorrelation(
                "debug",
                discoveryCorrelation,
                "⏭️ Skipping lead with duplicate address",
                {
                  placeId: place.place_id,
                  businessName: detailedPlace.name || "Unknown",
                  address: detailedPlace.formatted_address,
                  reason: "address_duplicate",
                  duplicateLeadId: duplicateAddressLeadId,
                },
              );

              // Track duplicate for analytics (via mutation)
              await ctx.runMutation(
                internal.search.internal.trackDuplicateMetric,
                {
                  userId: search.userId,
                  searchId: args.searchId,
                  placeId: detailedPlace.place_id || place.place_id,
                  duplicateType: "address",
                  originalLeadId: duplicateAddressLeadId,
                  businessName: detailedPlace.name || "Unknown",
                },
              );

              duplicateCounters.address++;
              return;
            }
          }
        }
        // ========================================================================
        // END ADDRESS DEDUPLICATION
        // ========================================================================

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
                detailedPlace.international_phone_number ||
                detailedPlace.formatted_phone_number ||
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
          }
          // Note: Address duplicates are now handled before calling createLeadInternal
          // and tracked via duplicateCounters.address++ above
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
      let lat: number | undefined;
      let lng: number | undefined;
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

            // 🚫 BLOCKING: Prevent county-level searches to avoid weak geographic filtering
            if (isCounty && !isCity) {
              const errorMessage = `Location "${result.formatted_address}" is a county, not a city. County-level searches would return results from a very large geographic area. Please select a specific city instead.`;
              logWithCorrelation(
                "error",
                discoveryCorrelation,
                "❌ County-level search BLOCKED - too broad",
                {
                  locationType: "county",
                  formattedAddress: result.formatted_address,
                  blockingReason: "prevent_weak_geographic_filtering",
                  suggestion: "User must select a specific city",
                },
              );
              throw new Error(errorMessage);
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

          // 🚫 BLOCKING: Prevent county-level searches in geocoding fallback
          if (isCounty && !isCity) {
            const errorMessage = `Location "${result.formatted_address}" is a county, not a city. County-level searches would return results from a very large geographic area. Please select a specific city instead.`;
            logWithCorrelation(
              "error",
              discoveryCorrelation,
              "❌ County-level search BLOCKED (geocoding) - too broad",
              {
                searchedFor: location,
                geocodedTo: result.formatted_address,
                locationType: "county",
                types: result.types,
                blockingReason: "prevent_weak_geographic_filtering",
                suggestion: "User must select a specific city from location picker",
              },
            );
            throw new Error(errorMessage);
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

      // 🎯 PHASE 3 OPTIMIZATION: Result-based tile caps
      // Old logic: Fixed caps (250/300/400 tiles regardless of density)
      // New logic: Dynamic caps based on expected leads per tile
      //
      // Assumption: Urban areas yield 15-20 leads per tile average
      // Strategy: 2× coverage buffer to ensure target achievement
      // Formula: tiles = (requestedResults / avgLeadsPerTile) × bufferMultiplier
      //
      // Result-based tile caps (70-85% reduction vs old fixed caps):
      const avgLeadsPerTile = 15; // Conservative estimate for urban areas
      const coverageBuffer = 2.0; // 2× buffer ensures target achievement
      const calculatedTiles = Math.ceil((requestedResults / avgLeadsPerTile) * coverageBuffer);

      // Apply caps with result-based limits
      const maxTilesForSearch = Math.min(
        calculatedTiles,
        requestedResults > 300 ? 180 :  // 500+ leads: max 180 tiles (vs 400 old)
        requestedResults > 150 ? 120 :  // 300 leads: max 120 tiles (vs 300 old)
        requestedResults > 50 ? 60 :    // 100 leads: max 60 tiles (vs 250 old)
        40                              // 50 leads: max 40 tiles (vs 250 old)
      );
      const concurrencyForSearch = requestedResults > 300 ? 7 : 5;

      let places: Place[] = [];
      totalApiCalls = 0;

      if (useTiling) {
        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "🗺️ Using OPTIMIZED SPATIAL TILING with cost reduction",
          {
            maxResults: requestedResults,
            hasBounds: !!bounds,
            hasCenter: lat !== 0 && lng !== 0,
            strategy: "optimized_tiled_search_nearby_api",
            fetchMultiplier: INITIAL_FETCH_MULTIPLIER,
            maxTiles: maxTilesForSearch,
            calculatedTiles,
            tileReduction: `${((1 - maxTilesForSearch / 250) * 100).toFixed(0)}% vs baseline`,
            concurrency: concurrencyForSearch,
            estimatedTiles: Math.ceil(requestedResults / avgLeadsPerTile),
            estimatedApiCalls: Math.ceil(requestedResults / avgLeadsPerTile) * 3,
            optimization: "50% overlap + result-based caps + progressive termination",
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
          // 🎯 Pass resolved city center for intelligent tile ordering
          // This ensures business districts are searched first, not geographic corners
          sortCenterHint: lat !== 0 && lng !== 0 ? { lat, lng } : undefined,
          correlation: discoveryCorrelation,
          shouldCancel: async () => !(await ensureSearchActive()),
        });

        places = tilingResult.places;
        totalApiCalls = tilingResult.totalApiCalls;
        rawPlacesDiscovered += places.length;
        duplicatesFromTiles += tilingResult.duplicatesFiltered;

        // Check if tiling encountered a user-actionable API error (e.g., quota exhausted)
        if (tilingResult.apiError && shouldBlockPipeline(tilingResult.apiError)) {
          logWithCorrelation(
            "error",
            discoveryCorrelation,
            "🚨 Google Places API error - blocking pipeline",
            {
              errorCode: tilingResult.apiError.errorCode,
              category: tilingResult.apiError.category,
              userMessage: tilingResult.apiError.userMessage,
              placesFoundBeforeError: places.length,
              suggestedAction: tilingResult.apiError.suggestedAction,
            },
          );

          // Log the error for user visibility
          await ctx.runMutation(internal.search.internal.logApiError, {
            userId: search.userId,
            searchId: args.searchId,
            errorCode: tilingResult.apiError.errorCode,
            provider: tilingResult.apiError.provider,
            category: tilingResult.apiError.category,
            severity: tilingResult.apiError.severity,
            userMessage: tilingResult.apiError.userMessage,
            originalStatus: tilingResult.apiError.originalStatus,
            operationType: "lead_discovery",
          });

          // Update search status with the error
          await ctx.runMutation(
            internal.search.internal.updateSearchStatusInternal,
            {
              searchId: args.searchId,
              status: "failed",
              error: tilingResult.apiError.userMessage,
            },
          );

          // Broadcast the error to the user
          await ctx.runMutation(
            internal.realtime.broadcaster.broadcastPipelineUpdate,
            {
              userId: search.userId,
              searchId: args.searchId,
              stage: "error",
              progress: 0,
              priority: "urgent",
              message: tilingResult.apiError.userMessage,
              data: {
                apiError: {
                  code: tilingResult.apiError.errorCode,
                  provider: tilingResult.apiError.provider,
                  category: tilingResult.apiError.category,
                  userMessage: tilingResult.apiError.userMessage,
                  suggestedAction: tilingResult.apiError.suggestedAction,
                  actionUrl: tilingResult.apiError.actionUrl,
                  actionLabel: tilingResult.apiError.actionLabel,
                },
                partialResults: places.length > 0,
                placesFound: places.length,
              },
            },
          );

          // Throw a structured error so the frontend can display it properly
          throw createApiConvexError(tilingResult.apiError);
        }

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

      // 🎯 PHASE 3 OPTIMIZATION: Smarter expansion trigger and tile limits
      // Only expand if initial coverage was insufficient (<70% of target)
      const initialCoveragePercent = (leadIds.length / requestedResults) * 100;
      const shouldExpand = initialCoveragePercent < 70 && maxExpansionIterations > 0;

      if (
        hasValidCenter &&
        leadIds.length < requestedResults &&
        shouldExpand
      ) {
        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "📏 Starting optimized radius expansion (initial coverage <70%)",
          {
            initialLeads: leadIds.length,
            targetLeads: requestedResults,
            initialCoveragePercent: initialCoveragePercent.toFixed(1) + "%",
            expansionJustification: "Area appears sparse, expanding search radius",
          },
        );

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

            // 🎯 PHASE 3 OPTIMIZATION: Reduce expansion tiles by 50%
            // Old logic: 120/150/200 tiles for expansion
            // New logic: 60/90/100 tiles (50% reduction)
            // Rationale: Expansion indicates sparse area, fewer tiles still cover gaps effectively
            const expansionMaxTiles = requestedResults > 300 ? 100 : requestedResults > 150 ? 90 : 60;
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
              // 🎯 Use original city center for expansion tile ordering too
              sortCenterHint: lat !== 0 && lng !== 0 ? { lat, lng } : undefined,
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

      // Update results.totalFound immediately after discovery so frontend shows live count
      await ctx.runMutation(internal.search.internal.updateSearchResults, {
        searchId: args.searchId,
        results: {
          totalFound: deliveredLeads,
          enrichedCount: 0, // Will be updated during enrichment phase
          analyzedCount: 0, // Will be updated during analysis phase
          avgRelevanceScore: 0, // Will be updated during analysis phase
        },
        progress: {
          discovered: deliveredLeads,
          enriched: 0,
          analyzed: 0,
          total: deliveredLeads,
        },
      });

      const performanceData = endPerformanceTracking(performanceTracker);

      // 💰 COMPREHENSIVE COST TRACKING
      // Calculate actual vs baseline costs with detailed breakdown
      const nearbySearchCost = totalApiCalls * 0.032; // $0.032 per Nearby Search call
      const placeDetailsCallsEstimate = deliveredLeads; // 1 per lead (website filter after Place Details)
      const contactDataCost = deliveredLeads * 0.003; // $0.003 per lead (website field from Contact Data SKU)
      const atmosphereDataCost = 0; // $0 (not requesting atmosphere data fields)
      const totalEstimatedCost = nearbySearchCost + contactDataCost + atmosphereDataCost;

      // Baseline cost (old implementation)
      const baselineNearbySearchCalls = Math.ceil((requestedResults / 15) * 250); // 250 tiles baseline
      const baselineNearbySearchCost = baselineNearbySearchCalls * 0.032;
      const baselineContactDataCost = deliveredLeads * 0.003;
      const baselineAtmosphereDataCost = deliveredLeads * 0.005;
      const baselineTotalCost = baselineNearbySearchCost + baselineContactDataCost + baselineAtmosphereDataCost;

      const costSavings = baselineTotalCost - totalEstimatedCost;
      const costSavingsPercent = baselineTotalCost > 0
        ? ((costSavings / baselineTotalCost) * 100).toFixed(1)
        : "0";

      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 1 COMPLETE: Optimized Google Maps Discovery Finished",
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

          // 🎯 API EFFICIENCY METRICS
          strategy: useTiling ? "optimized_spatial_tiling" : "simple_pagination",
          totalApiCalls,
          placesPerApiCall:
            totalApiCalls > 0
              ? (deliveredLeads / totalApiCalls).toFixed(2)
              : "N/A",
          apiCallEfficiency:
            totalApiCalls > 0
              ? ((deliveredLeads / totalApiCalls) * 100).toFixed(1) + "%"
              : "N/A",

          // 💰 COST BREAKDOWN (OPTIMIZED)
          costBreakdown: {
            nearbySearchCalls: totalApiCalls,
            nearbySearchCost: `$${nearbySearchCost.toFixed(2)}`,
            placeDetailsCalls: placeDetailsCallsEstimate,
            contactDataCost: "$0.00 (eliminated)",
            atmosphereDataCost: "$0.00 (eliminated)",
            totalEstimatedCost: `$${totalEstimatedCost.toFixed(2)}`,
          },

          // 📊 SAVINGS vs BASELINE
          savingsAnalysis: {
            baselineApiCalls: baselineNearbySearchCalls,
            actualApiCalls: totalApiCalls,
            apiCallReduction: `${((1 - totalApiCalls / baselineNearbySearchCalls) * 100).toFixed(1)}%`,
            baselineCost: `$${baselineTotalCost.toFixed(2)}`,
            actualCost: `$${totalEstimatedCost.toFixed(2)}`,
            totalSavings: `$${costSavings.toFixed(2)}`,
            savingsPercent: `${costSavingsPercent}%`,
          },

          // ✨ OPTIMIZATIONS APPLIED
          optimizations: [
            "50% tile overlap (vs 75% baseline)",
            "Adaptive tile sizing based on area",
            "Progressive termination at target",
            "Website filtering after Place Details",
            "Minimal field selection (address, geometry, website)",
            "Result-based tile caps",
            "Optimized expansion logic",
          ],
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

        // Update results to show 0 leads found
        await ctx.runMutation(internal.search.internal.updateSearchResults, {
          searchId: args.searchId,
          results: {
            totalFound: 0,
            enrichedCount: 0,
            analyzedCount: 0,
            avgRelevanceScore: 0,
          },
          progress: {
            discovered: 0,
            enriched: 0,
            analyzed: 0,
            total: 0,
          },
        });

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

      // Get all leads to count tier 2 vs tier 3 usage
      const allLeads = await ctx.runQuery(internal.leads.internal.getSearchLeadsInternal, {
        searchId: args.searchId,
      });

      // Count leads by research tier
      const tier3Leads = allLeads.filter((lead: any) => lead.deepResearchUsed === true).length;
      const tier2Leads = analyzedCount - tier3Leads; // All analyzed leads minus tier 3

      // Calculate per-lead pricing: 1 credit per tier 2 lead, 2 credits per tier 3 lead
      const tier2Cost = tier2Leads * CREDIT_COSTS.AI_ANALYSIS_TIER2;
      const tier3Cost = tier3Leads * CREDIT_COSTS.AI_ANALYSIS_TIER3;
      const totalCreditsUsed = tier2Cost + tier3Cost;

      // For analytics, track breakdown
      const creditBreakdown = {
        tier2Leads,
        tier2Cost,
        tier3Leads,
        tier3Cost,
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
        const tierBreakdown = tier3Leads > 0
          ? ` (${tier2Leads} tier 2 + ${tier3Leads} tier 3)`
          : ` (${tier2Leads} tier 2)`;
        await ctx.runMutation(internal.credits.transactions.recordTransaction, {
          userId: search.userId,
          amount: creditsToCharge,
          operation: "usage",
          description: `Search "${search.name}"${tierBreakdown} - ${totalCreditsUsed} credit${totalCreditsUsed > 1 ? 's' : ''}`,
          relatedEntityType: "search",
          relatedEntityId: args.searchId as unknown as string,
        });
      } else if (bypassCredits && creditsToCharge > 0) {
        console.log(
          `BYOK: Skipping ${creditsToCharge} credit charge for enterprise search ${args.searchId}`
        );

        // Log the credit bypass for audit trail
        await ctx.runMutation(internal.lib.auditLog.logCreditBypass, {
          userId: search.userId,
          operation: `Search "${search.name}" completed`,
          creditsSkipped: creditsToCharge,
          providers: [], // Will be populated with actual providers in future enhancement
          relatedEntityType: "search",
          relatedEntityId: args.searchId as unknown as string,
          metadata: {
            totalFound,
            enrichedCount,
            analyzedCount,
            tier2Leads,
            tier3Leads,
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
