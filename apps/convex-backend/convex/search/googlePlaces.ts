/**
 * Google Places API Helper with Spatial Tiling
 *
 * Overcomes the 60-result limit by:
 * 1. Tiling the search area into overlapping circles
 * 2. Paginating each tile (up to 3 pages = 60 results per tile)
 * 3. De-duplicating by place_id across all tiles
 *
 * Can achieve 1000+ results for large areas with high density.
 */

import {
  CorrelationContext,
  createChildContext,
  logWithCorrelation,
  OPERATION_TYPES,
} from "../lib/correlation";

// ============================================================================
// Types
// ============================================================================

export type LatLng = { lat: number; lng: number };
export type Bounds = { ne: LatLng; sw: LatLng };

export type Place = {
  place_id: string;
  name?: string;
  business_status?: string;
  rating?: number;
  user_ratings_total?: number;
  formatted_address?: string;
  vicinity?: string;
  geometry?: { location: LatLng };
  types?: string[];
  website?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
};

export type TilingParams = {
  apiKey: string;
  // Search intent
  query: string;
  type?: string;
  keyword?: string;
  // Geography
  bounds?: Bounds;
  center?: LatLng;
  radiusMeters?: number;
  // Controls
  maxResults: number; // Target: up to 1000+ results
  maxTiles?: number; // Default: 250 (safety cap)
  concurrency?: number; // Default: 5 workers (range: 1-10)
  // Logging
  correlation: CorrelationContext;
  // Cancellation check
  shouldCancel?: () => Promise<boolean>;
};

type TileSearchResult = {
  center: LatLng;
  radius: number;
  places: Place[];
  pagesFetched: number;
  apiCalls: number;
};

// ============================================================================
// Helper Functions
// ============================================================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Calculate approximate distance between two lat/lng points in meters
 * Using Haversine formula for accuracy
 */
function distanceMeters(p1: LatLng, p2: LatLng): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generate grid of overlapping circular tiles covering a bounding box
 *
 * @param bounds - NE/SW corners of area to cover
 * @param approxRadiusM - Desired radius per tile (default 1500m for optimal coverage)
 * @param correlation - Correlation context for logging
 * @returns Array of tile centers and radii
 */
export function makeGridTiles(
  bounds: Bounds,
  approxRadiusM: number = 1500,
  correlation: CorrelationContext,
): Array<{ center: LatLng; radius: number }> {
  logWithCorrelation(
    "info",
    correlation,
    "🗺️ Generating grid tiles for spatial coverage",
    {
      bounds,
      tileRadius: approxRadiusM,
      boundsWidth: distanceMeters(
        { lat: bounds.ne.lat, lng: bounds.sw.lng },
        { lat: bounds.ne.lat, lng: bounds.ne.lng },
      ),
      boundsHeight: distanceMeters(
        { lat: bounds.sw.lat, lng: bounds.sw.lng },
        { lat: bounds.ne.lat, lng: bounds.sw.lng },
      ),
    },
  );

  // Convert degrees to meters for grid spacing
  const latDegPerM = 1 / 111_320;
  const midLat = (bounds.ne.lat + bounds.sw.lat) / 2;
  const lngDegPerM = 1 / (111_320 * Math.cos(midLat * Math.PI / 180));

  // Overlap tiles by ~25% (0.75R spacing) to prevent gaps
  const stepLatDeg = approxRadiusM * 0.75 * latDegPerM;
  const stepLngDeg = approxRadiusM * 0.75 * lngDegPerM;

  const tiles: Array<{ center: LatLng; radius: number }> = [];
  let rowCount = 0;
  let maxColCount = 0;

  for (let lat = bounds.sw.lat; lat <= bounds.ne.lat; lat += stepLatDeg) {
    let colCount = 0;
    for (let lng = bounds.sw.lng; lng <= bounds.ne.lng; lng += stepLngDeg) {
      const cellCenter = {
        lat: Math.min(lat + stepLatDeg / 2, bounds.ne.lat),
        lng: Math.min(lng + stepLngDeg / 2, bounds.ne.lng),
      };
      tiles.push({ center: cellCenter, radius: approxRadiusM });
      colCount++;
    }
    maxColCount = Math.max(maxColCount, colCount);
    rowCount++;
  }

  logWithCorrelation(
    "info",
    correlation,
    `✅ Generated ${tiles.length} tiles in ${rowCount}×${maxColCount} grid`,
    {
      totalTiles: tiles.length,
      gridDimensions: `${rowCount}×${maxColCount}`,
      tileRadius: approxRadiusM,
      overlapFactor: 0.75,
      estimatedApiCalls: tiles.length * 3, // Up to 3 pages per tile
    },
  );

  return tiles;
}

/**
 * Fetch a single page of results from Google Places Nearby Search API
 */
async function fetchPlacesPageNearby(
  params: {
    apiKey: string;
    location: LatLng;
    radiusMeters: number;
    type?: string;
    keyword?: string;
    pagetoken?: string;
  },
  correlation: CorrelationContext,
): Promise<{
  results: Place[];
  next_page_token?: string;
  status: string;
  error_message?: string;
}> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
  );

  if (params.pagetoken) {
    url.searchParams.set("pagetoken", params.pagetoken);
    logWithCorrelation(
      "debug",
      correlation,
      "📄 Fetching next page with token",
      {
        hasToken: true,
      },
    );
  } else {
    url.searchParams.set(
      "location",
      `${params.location.lat},${params.location.lng}`,
    );
    url.searchParams.set("radius", String(params.radiusMeters));
    if (params.type) url.searchParams.set("type", params.type);
    if (params.keyword) url.searchParams.set("keyword", params.keyword);
    logWithCorrelation(
      "debug",
      correlation,
      "📍 Fetching first page for location",
      {
        location: params.location,
        radius: params.radiusMeters,
        type: params.type,
        keyword: params.keyword,
      },
    );
  }

  url.searchParams.set("key", params.apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Places API HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Fetch all pages (up to 3) for a single tile with exponential backoff
 */
async function fetchTileAllPages(
  args: {
    apiKey: string;
    center: LatLng;
    radiusMeters: number;
    type?: string;
    keyword?: string;
    maxPerTile?: number;
    backoffBaseMs?: number;
    tileIndex: number;
    correlation: CorrelationContext;
  },
): Promise<TileSearchResult> {
  const tileCorrelation = createChildContext(
    args.correlation,
    OPERATION_TYPES.GOOGLE_MAPS_API,
    {
      metadata: {
        tileIndex: args.tileIndex,
        center: args.center,
        radius: args.radiusMeters,
      },
    },
  );

  logWithCorrelation(
    "info",
    tileCorrelation,
    `🔍 Starting tile ${args.tileIndex + 1} search`,
    {
      center: args.center,
      radius: args.radiusMeters,
      maxPerTile: args.maxPerTile || 60,
    },
  );

  const results: Place[] = [];
  let pageToken: string | undefined = undefined;
  let pagesFetched = 0;
  let apiCalls = 0;

  for (;;) {
    let data: any;
    let attempt = 0;

    // Retry loop with exponential backoff
    while (true) {
      try {
        apiCalls++;
        data = await fetchPlacesPageNearby(
          {
            apiKey: args.apiKey,
            location: args.center,
            radiusMeters: args.radiusMeters,
            type: args.type,
            keyword: args.keyword,
            pagetoken: pageToken,
          },
          tileCorrelation,
        );

        // Handle INVALID_REQUEST for page tokens (need to wait)
        if (data.status === "INVALID_REQUEST" && pageToken) {
          logWithCorrelation(
            "warn",
            tileCorrelation,
            "⏳ Page token not ready yet, waiting 2 seconds...",
            {
              pagesFetched,
              attempt,
            },
          );
          await sleep(2000);
          continue;
        }

        if (["OK", "ZERO_RESULTS"].includes(data.status)) {
          logWithCorrelation(
            "debug",
            tileCorrelation,
            `✅ API call successful: ${data.status}`,
            {
              resultsInPage: data.results?.length || 0,
              hasNextPage: !!data.next_page_token,
            },
          );
          break;
        }

        // Rate limiting
        if (["OVER_QUERY_LIMIT", "RESOURCE_EXHAUSTED"].includes(data.status)) {
          const wait = Math.min(
            60_000,
            (args.backoffBaseMs ?? 1000) * 2 ** attempt,
          );
          logWithCorrelation(
            "warn",
            tileCorrelation,
            `⚠️ Rate limit hit, backing off ${wait}ms`,
            {
              status: data.status,
              attempt,
              waitMs: wait,
            },
          );
          await sleep(wait);
          attempt++;
          continue;
        }

        // Other errors
        throw new Error(
          `Places API status=${data.status} ${data.error_message ?? ""}`,
        );
      } catch (e: any) {
        const wait = Math.min(
          60_000,
          (args.backoffBaseMs ?? 1000) * 2 ** attempt,
        );
        logWithCorrelation(
          "error",
          tileCorrelation,
          `❌ API call failed, retrying in ${wait}ms`,
          {
            error: e.message,
            attempt,
            waitMs: wait,
          },
          e,
        );
        await sleep(wait);
        attempt++;
        if (attempt > 5) throw e;
      }
    }

    const pageResults = data.results || [];
    results.push(...pageResults);
    pagesFetched++;

    logWithCorrelation(
      "info",
      tileCorrelation,
      `📄 Page ${pagesFetched} fetched: ${pageResults.length} places (total: ${results.length})`,
      {
        pageNumber: pagesFetched,
        placesInPage: pageResults.length,
        totalPlaces: results.length,
        hasNextPage: !!data.next_page_token,
      },
    );

    // Stop conditions
    if (
      !data.next_page_token ||
      pagesFetched >= 3 ||
      (args.maxPerTile && results.length >= args.maxPerTile)
    ) {
      logWithCorrelation(
        "info",
        tileCorrelation,
        `✅ Tile ${args.tileIndex + 1} complete`,
        {
          totalPlaces: results.length,
          pagesFetched,
          apiCalls,
          stoppedReason: !data.next_page_token
            ? "no_more_pages"
            : pagesFetched >= 3
              ? "max_pages_reached"
              : "max_results_reached",
        },
      );
      break;
    }

    pageToken = data.next_page_token;

    // Google requires ~2 seconds for token to become valid
    logWithCorrelation(
      "debug",
      tileCorrelation,
      "⏳ Waiting 2 seconds for next page token activation",
      { nextPage: pagesFetched + 1 },
    );
    await sleep(2000);
  }

  return {
    center: args.center,
    radius: args.radiusMeters,
    places: results,
    pagesFetched,
    apiCalls,
  };
}

/**
 * Main entry point: Search with spatial tiling and de-duplication
 */
export async function searchPlacesWithTiling(
  params: TilingParams,
): Promise<{
  places: Place[];
  tilesSearched: number;
  totalApiCalls: number;
  duplicatesFiltered: number;
  timeMs: number;
}> {
  const startTime = Date.now();

  logWithCorrelation(
    "info",
    params.correlation,
    "🚀 Starting tiled Places search",
    {
      maxResults: params.maxResults,
      hasBounds: !!params.bounds,
      hasCenter: !!params.center,
      query: params.query,
      type: params.type,
      keyword: params.keyword,
    },
  );

  if (!params.bounds && !params.center) {
    throw new Error("Must provide either bounds or center for tiling search");
  }

  // Generate tiles
  const tiles = params.bounds
    ? makeGridTiles(
        params.bounds,
        Math.min(params.radiusMeters || 1500, 3000),
        params.correlation,
      )
    : [{ center: params.center!, radius: params.radiusMeters || 3000 }];

  // Cap tiles for safety
  const maxTiles = params.maxTiles || 250;
  if (tiles.length > maxTiles) {
    logWithCorrelation(
      "warn",
      params.correlation,
      `⚠️ Capping tiles at ${maxTiles} (generated ${tiles.length})`,
      {
        generated: tiles.length,
        capped: maxTiles,
        note: "Increase maxTiles parameter for larger coverage",
      },
    );
    tiles.length = maxTiles;
  }

  logWithCorrelation(
    "info",
    params.correlation,
    `📊 Processing ${tiles.length} tiles with concurrency ${params.concurrency || 5}`,
    {
      totalTiles: tiles.length,
      concurrency: params.concurrency || 5,
      estimatedMaxApiCalls: tiles.length * 3,
      estimatedTimeSeconds: Math.ceil((tiles.length / (params.concurrency || 5)) * 8), // ~8s per tile batch
    },
  );

  // Worker result type for safe aggregation
  type WorkerResult = {
    places: Place[];
    apiCalls: number;
    localDuplicates: number;
  };

  // Concurrent tile processing with worker pool
  let tileIndex = 0;
  const concurrency = Math.max(1, Math.min(params.concurrency || 5, 10));

  async function worker(): Promise<WorkerResult> {
    // Worker-local deduplication (thread-safe)
    const localSeen = new Set<string>();
    const localPlaces: Place[] = [];
    let localApiCalls = 0;
    let localDuplicates = 0;

    while (tileIndex < tiles.length) {
      const idx = tileIndex++;
      const tile = tiles[idx];

      if (!tile) {
        // Safety check: skip if tile is undefined
        continue;
      }

      // Check cancellation
      if (params.shouldCancel && (await params.shouldCancel())) {
        logWithCorrelation(
          "warn",
          params.correlation,
          "🛑 Search cancelled during tiling",
          {
            tilesCompleted: idx,
            totalTiles: tiles.length,
          },
        );
        break;
      }

      logWithCorrelation(
        "info",
        params.correlation,
        `🔄 Processing tile ${idx + 1}/${tiles.length}`,
        {
          tileIndex: idx + 1,
          totalTiles: tiles.length,
          targetPlaces: params.maxResults,
          progress: ((idx / tiles.length) * 100).toFixed(1) + "%",
        },
      );

      const tileResult = await fetchTileAllPages({
        apiKey: params.apiKey,
        center: tile.center,
        radiusMeters: tile.radius,
        type: params.type,
        keyword: params.keyword,
        maxPerTile: 60,
        backoffBaseMs: 1000,
        tileIndex: idx,
        correlation: params.correlation,
      });

      localApiCalls += tileResult.apiCalls;

      // Worker-local de-duplication
      let newPlaces = 0;
      for (const place of tileResult.places) {
        if (!place.place_id) continue;
        if (localSeen.has(place.place_id)) {
          localDuplicates++;
          continue;
        }
        localSeen.add(place.place_id);
        localPlaces.push(place);
        newPlaces++;
      }

      logWithCorrelation(
        "info",
        params.correlation,
        `✅ Tile ${idx + 1} processed: ${newPlaces} new places (${tileResult.places.length - newPlaces} duplicates)`,
        {
          tileIndex: idx + 1,
          totalInTile: tileResult.places.length,
          newPlaces,
          duplicates: tileResult.places.length - newPlaces,
          workerLocalTotal: localPlaces.length,
          apiCallsForTile: tileResult.apiCalls,
        },
      );
    }

    return {
      places: localPlaces,
      apiCalls: localApiCalls,
      localDuplicates,
    };
  }

  // Run worker pool and collect results
  const workers = Array(concurrency)
    .fill(0)
    .map(() => worker());
  const workerResults = await Promise.all(workers);

  // Global deduplication (single-threaded, safe)
  const globalSeen = new Set<string>();
  const allPlaces: Place[] = [];
  let totalApiCalls = 0;
  let duplicatesFiltered = 0;

  for (const result of workerResults) {
    totalApiCalls += result.apiCalls;
    duplicatesFiltered += result.localDuplicates;

    for (const place of result.places) {
      if (!globalSeen.has(place.place_id)) {
        globalSeen.add(place.place_id);
        allPlaces.push(place);
        if (allPlaces.length >= params.maxResults) break;
      } else {
        duplicatesFiltered++;
      }
    }
    if (allPlaces.length >= params.maxResults) break;
  }

  const timeMs = Date.now() - startTime;

  logWithCorrelation(
    "info",
    params.correlation,
    "🎉 Tiled search complete",
    {
      placesFound: allPlaces.length,
      targetPlaces: params.maxResults,
      tilesSearched: Math.min(tiles.length, tileIndex),
      totalTiles: tiles.length,
      apiCalls: totalApiCalls,
      duplicatesFiltered,
      avgPlacesPerTile: (
        allPlaces.length / Math.min(tiles.length, tileIndex)
      ).toFixed(1),
      timeMs,
      timeSec: (timeMs / 1000).toFixed(1),
    },
  );

  return {
    places: allPlaces.slice(0, params.maxResults), // Cap at maxResults
    tilesSearched: Math.min(tiles.length, tileIndex),
    totalApiCalls,
    duplicatesFiltered,
    timeMs,
  };
}
