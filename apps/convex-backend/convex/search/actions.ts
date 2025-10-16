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
// Note: This action can be scheduled by the orchestrator (no user auth).

const METERS_PER_MILE = 1609.34;
const MAX_PLACES_RADIUS_METERS = 50000;

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GooglePlaceDetails = {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: GoogleAddressComponent[];
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

      // Get Google Maps API key
      const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!googleMapsApiKey) {
        throw new Error("Google Maps API key not configured");
      }

      // Build search query
      const params: any = search.parameters;
      const query = params.keywords.join(" ");
      const location = params.location;
      const radiusMiles = params.radius;
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

      // Enhanced geocoding: Get both coordinates AND bounding box for tiling
      let lat: number, lng: number;
      let bounds: Bounds | undefined;
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

        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "📍 Enhanced Geocoding Successful",
          {
            originalLocation: location,
            geocodedCoordinates: { lat, lng },
            hasBounds: !!bounds,
            boundsArea: bounds
              ? {
                  latSpan: bounds.ne.lat - bounds.sw.lat,
                  lngSpan: bounds.ne.lng - bounds.sw.lng,
                }
              : undefined,
          },
        );
      } catch (geocodeError) {
        logWithCorrelation(
          "warn",
          discoveryCorrelation,
          "⚠️ Geocoding Failed - Using Text Search Fallback",
          { originalLocation: location },
          geocodeError as Error,
        );
        // Fallback: use text search without location bias
        lat = 0;
        lng = 0;
        bounds = undefined;
      }

      // 🎯 ADAPTIVE STRATEGY: Choose between simple pagination or spatial tiling
      useTiling = params.maxResults > 60 && (!!bounds || (lat !== 0 && lng !== 0));

      let places: Place[] = [];
      totalApiCalls = 0;

      if (useTiling) {
        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "🗺️ Using SPATIAL TILING strategy (maxResults > 60)",
          {
            maxResults: params.maxResults,
            hasBounds: !!bounds,
            hasCenter: lat !== 0 && lng !== 0,
            strategy: "tiled_search",
            estimatedTiles: Math.ceil(params.maxResults / 50), // ~50 places per tile average
            estimatedApiCalls: Math.ceil(params.maxResults / 50) * 3,
            estimatedTimeMinutes: Math.ceil(params.maxResults / 250), // ~250 places per minute
          },
        );

        // Use spatial tiling for large result sets
        const tilingResult = await searchPlacesWithTiling({
          apiKey: googleMapsApiKey,
          query,
          type: "establishment",
          keyword: query,
          bounds: bounds || undefined,
          center: bounds ? undefined : { lat, lng },
          radiusMeters: bounds ? undefined : radius,
          maxResults: params.maxResults,
          maxTiles: 250, // Increased for 1000-result searches
          concurrency: 5, // Increased for better throughput
          correlation: discoveryCorrelation,
          shouldCancel: async () => {
            const latest = await ctx.runQuery(
              internal.search.internal.getSearchInternal,
              { searchId: args.searchId },
            );
            return !latest || latest.status === "cancelled";
          },
        });

        places = tilingResult.places;
        totalApiCalls = tilingResult.totalApiCalls;

        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "✅ TILED SEARCH COMPLETE",
          {
            placesFound: places.length,
            targetPlaces: params.maxResults,
            tilesSearched: tilingResult.tilesSearched,
            apiCalls: totalApiCalls,
            duplicatesFiltered: tilingResult.duplicatesFiltered,
            efficiency: ((places.length / totalApiCalls) * 100).toFixed(1) + "% places per API call",
            timeMs: tilingResult.timeMs,
          },
        );
      } else {
        logWithCorrelation(
          "info",
          discoveryCorrelation,
          "📄 Using SIMPLE PAGINATION strategy (maxResults ≤ 60)",
          {
            maxResults: params.maxResults,
            strategy: "simple_pagination",
            maxPages: 3,
          },
        );

        // Use simple pagination for small result sets (≤60 results)
        let nextPageToken: string | undefined = undefined;
        const maxPages = 3;
        let currentPage = 0;

        while (currentPage < maxPages && places.length < params.maxResults) {
          const placesUrl = new URL(
            "https://maps.googleapis.com/maps/api/place/textsearch/json",
          );
          placesUrl.searchParams.set("query", query);
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

          if (!nextPageToken || places.length >= params.maxResults) {
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
      const totalFound = Math.min(places.length, params.maxResults);

      // Update search progress using scheduler
      await ctx.runMutation(
        internal.search.internal.updateSearchProgressInternal,
        {
          searchId: args.searchId,
          progress: {
            discovered: totalFound,
            enriched: 0,
            analyzed: 0,
            total: totalFound,
          },
          partialResults: totalFound < params.maxResults,
          requestedCount: params.maxResults,
        },
      );

      logWithCorrelation(
        "info",
        discoveryCorrelation,
        "✅ Google Maps API Discovery Completed",
        {
          totalFound,
          requestedMax: params.maxResults,
          discoveryRate: (totalFound / params.maxResults) * 100,
          strategy: useTiling ? "spatial_tiling" : "simple_pagination",
          apiCalls: totalApiCalls,
          efficiency: totalApiCalls > 0 ? (totalFound / totalApiCalls).toFixed(2) + " places/API call" : "N/A",
        },
      );

      // Warn user if we found fewer leads than requested
      const requestedResults = params.maxResults;
      if (totalFound < requestedResults) {
        const foundPercentage = (totalFound / requestedResults) * 100;
        const shortfall = requestedResults - totalFound;
        const warningMessage = `Found ${totalFound} of ${requestedResults} requested leads (${foundPercentage.toFixed(0)}%) in this area`;

        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ PARTIAL RESULTS: Fewer leads found than requested",
          {
            requested: requestedResults,
            found: totalFound,
            shortfall,
            percentage: foundPercentage,
          },
        );

        // Broadcast warning to user immediately
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
              found: totalFound,
              shortfall,
              suggestions: shortfall > requestedResults * 0.5 ? [
                "Try increasing search radius",
                "Use broader keywords",
                "Expand to nearby cities",
              ] : [
                "Try increasing search radius slightly",
                "Adjust keyword specificity",
              ],
            },
          },
        );
      }

      // Create lead records for discovered places with Place Details enrichment
      const leadIds: string[] = [];
      for (let i = 0; i < totalFound; i++) {
        // Early exit if cancelled mid-loop
        const current = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: args.searchId,
          },
        );
        if (!current || current.status === "cancelled") {
          return {
            success: false,
            message: "Search cancelled",
            totalFound: i,
            leadIds,
          } as any;
        }
        const place = places[i];
        if (!place || !place.place_id) {
          // Skip invalid places
          continue;
        }

        // Get detailed place information including website and phone
        let detailedPlace: any = place;
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
            detailsUrl.searchParams.set("key", googleMapsApiKey);

            const detailsResponse = await fetch(detailsUrl.toString());
            if (detailsResponse.ok) {
              const detailsData = (await detailsResponse.json()) as {
                status: string;
                result?: {
                  website?: string;
                  formatted_phone_number?: string;
                  international_phone_number?: string;
                };
              };
              if (detailsData.status === "OK" && detailsData.result) {
                detailedPlace = { ...place, ...detailsData.result };
              }
            }

            // Add small delay to respect rate limits
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            console.warn(
              `Failed to get place details for ${place.place_id}:`,
              error,
            );
            // Continue with basic place data
          }
        }

        // Create lead using internal mutation (works without user auth)
        const detailedPlaceInfo = detailedPlace as GooglePlaceDetails;
        const basePlaceInfo = place as GooglePlaceDetails;
        const addressComponents =
          detailedPlaceInfo.address_components ??
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

        const leadId = await ctx.runMutation(
          internal.leads.internal.createLeadInternal,
          {
            userId: search.userId,
            searchId: args.searchId,
            leadData: {
              businessName: detailedPlace.name || "Unknown",
              address: detailedPlace.formatted_address || "",
              placeId: detailedPlace.place_id || "",
              location: {
                lat:
                  detailedPlaceInfo.geometry?.location?.lat ??
                  basePlaceInfo.geometry?.location?.lat ??
                  0,
                lng:
                  detailedPlaceInfo.geometry?.location?.lng ??
                  basePlaceInfo.geometry?.location?.lng ??
                  0,
                formattedAddress:
                  detailedPlaceInfo.formatted_address ??
                  basePlaceInfo.formatted_address ??
                  "",
                city: city ?? undefined,
                state: state ?? undefined,
                country: country ?? undefined,
                postalCode: postalCode ?? undefined,
              },
              phone:
                detailedPlace.formatted_phone_number ||
                detailedPlace.international_phone_number ||
                undefined,
              website: detailedPlace.website || undefined,
              rating: detailedPlace.rating || undefined,
              reviewCount: detailedPlace.user_ratings_total || undefined,
              category: detailedPlace.types?.[0] || undefined,
            },
          },
        );

        // Skip duplicates - null means duplicate was detected and skipped
        if (leadId !== null) {
          leadIds.push(leadId);
        }
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
          totalFound,
          leadIds: leadIds.length,
          discoveryDurationMs: performanceData?.duration || 0,
          averageTimePerLead: totalFound > 0 ? (performanceData?.duration || 0) / totalFound : 0,
          nextPhase: "lead_enrichment",
          phaseCompletionRate: 100,
          // API efficiency metrics
          strategy: useTiling ? "spatial_tiling" : "simple_pagination",
          totalApiCalls,
          placesPerApiCall: totalApiCalls > 0 ? (totalFound / totalApiCalls).toFixed(2) : "N/A",
          apiCostEfficiency: totalApiCalls > 0 ? ((totalFound / totalApiCalls) * 100).toFixed(1) + "%" : "N/A",
        },
      );

      // If no leads found, complete the search immediately
      if (totalFound === 0) {
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
              leadsToEnrich: totalFound,
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
        message: `Discovered ${totalFound} potential leads using ${useTiling ? "spatial tiling" : "pagination"} (${totalApiCalls} API calls)`,
        totalFound,
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

      // Determine credit costs for this search execution
      const totalFound =
        typeof results.totalFound === "number" ? results.totalFound : 0;
      const enrichedCount =
        typeof results.enrichedCount === "number" ? results.enrichedCount : 0;
      const analyzedCount =
        typeof results.analyzedCount === "number" ? results.analyzedCount : 0;

      const creditBreakdown = {
        discovery: totalFound * CREDIT_COSTS.LEAD_DISCOVERY,
        enrichment: enrichedCount * CREDIT_COSTS.EMAIL_ENRICHMENT,
        analysis: analyzedCount * CREDIT_COSTS.AI_ANALYSIS,
      } as const;
      const totalCreditsUsed =
        creditBreakdown.discovery +
        creditBreakdown.enrichment +
        creditBreakdown.analysis;

      const previouslyRecordedCredits = search.creditsUsed || 0;
      const creditsToCharge = Math.max(
        totalCreditsUsed - previouslyRecordedCredits,
        0,
      );

      if (creditsToCharge > 0) {
        await ctx.runMutation(internal.credits.transactions.recordTransaction, {
          userId: search.userId,
          amount: creditsToCharge,
          operation: "usage",
          description: `Lead generation search "${search.name}" completed`,
          relatedEntityType: "search",
          relatedEntityId: args.searchId as unknown as string,
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
