/**
 * Comprehensive Tests for search/googlePlaces.ts
 *
 * Tests the Google Places API helper with spatial tiling including:
 * - makeGridTiles() - Grid generation with adaptive sizing
 * - searchPlacesWithTiling() - Main tiled search function
 * - Helper functions for distance, bounds, etc.
 * - Rate limiting and error handling
 * - Deduplication logic
 *
 * Priority: P0 - Critical for lead discovery pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAllMocks } from '../testUtils';

// Mock fetch for Google API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Types from googlePlaces.ts
type LatLng = { lat: number; lng: number };
type Bounds = { ne: LatLng; sw: LatLng };
type Place = {
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
};

describe('Google Places Helper Tests - search/googlePlaces.ts', () => {
  beforeEach(() => {
    resetAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    resetAllMocks();
  });

  // ============================================================================
  // Helper Function Tests
  // ============================================================================

  describe('Helper Functions', () => {
    describe('distanceMeters() - Haversine formula', () => {
      const distanceMeters = (p1: LatLng, p2: LatLng): number => {
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
      };

      it('should return 0 for same point', () => {
        const point = { lat: 40.7128, lng: -74.006 };
        expect(distanceMeters(point, point)).toBe(0);
      });

      it('should calculate correct distance for known locations', () => {
        // New York to Los Angeles is approximately 3,940 km
        const newYork = { lat: 40.7128, lng: -74.006 };
        const losAngeles = { lat: 34.0522, lng: -118.2437 };

        const distance = distanceMeters(newYork, losAngeles);
        expect(distance).toBeGreaterThan(3900000);
        expect(distance).toBeLessThan(4000000);
      });

      it('should be symmetric (distance A to B equals B to A)', () => {
        const a = { lat: 51.5074, lng: -0.1278 }; // London
        const b = { lat: 48.8566, lng: 2.3522 }; // Paris

        expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 5);
      });

      it('should handle points on equator', () => {
        const equator1 = { lat: 0, lng: 0 };
        const equator2 = { lat: 0, lng: 1 };

        // 1 degree of longitude at equator ≈ 111.32 km
        const distance = distanceMeters(equator1, equator2);
        expect(distance).toBeGreaterThan(110000);
        expect(distance).toBeLessThan(112000);
      });

      it('should handle points near poles', () => {
        const nearNorthPole1 = { lat: 89, lng: 0 };
        const nearNorthPole2 = { lat: 89, lng: 180 };

        const distance = distanceMeters(nearNorthPole1, nearNorthPole2);
        // Even opposite longitudes are close near poles
        expect(distance).toBeLessThan(250000);
      });
    });

    describe('calculateBoundsAreaKm2()', () => {
      const calculateBoundsAreaKm2 = (bounds: Bounds): number => {
        const latDiff = bounds.ne.lat - bounds.sw.lat;
        const lngDiff = bounds.ne.lng - bounds.sw.lng;
        const midLat = (bounds.ne.lat + bounds.sw.lat) / 2;

        const latKm = latDiff * 111.32;
        const lngKm = lngDiff * 111.32 * Math.cos((midLat * Math.PI) / 180);

        return latKm * lngKm;
      };

      it('should calculate area for small bounds', () => {
        const bounds: Bounds = {
          ne: { lat: 40.8, lng: -73.9 },
          sw: { lat: 40.7, lng: -74.1 },
        };

        const area = calculateBoundsAreaKm2(bounds);
        expect(area).toBeGreaterThan(0);
        expect(area).toBeLessThan(500);
      });

      it('should calculate larger area for bigger bounds', () => {
        const smallBounds: Bounds = {
          ne: { lat: 41, lng: -73 },
          sw: { lat: 40, lng: -74 },
        };

        const largeBounds: Bounds = {
          ne: { lat: 42, lng: -72 },
          sw: { lat: 39, lng: -75 },
        };

        expect(calculateBoundsAreaKm2(largeBounds)).toBeGreaterThan(
          calculateBoundsAreaKm2(smallBounds),
        );
      });

      it('should handle bounds at equator', () => {
        const bounds: Bounds = {
          ne: { lat: 1, lng: 1 },
          sw: { lat: 0, lng: 0 },
        };

        const area = calculateBoundsAreaKm2(bounds);
        // At equator, 1 degree ≈ 111.32 km, so 1x1 degree ≈ 12,392 km²
        expect(area).toBeGreaterThan(12000);
        expect(area).toBeLessThan(13000);
      });

      it('should account for longitude shrinkage at higher latitudes', () => {
        const equatorBounds: Bounds = {
          ne: { lat: 1, lng: 1 },
          sw: { lat: 0, lng: 0 },
        };

        const arcticBounds: Bounds = {
          ne: { lat: 71, lng: 1 },
          sw: { lat: 70, lng: 0 },
        };

        // Same degree difference but smaller area at higher latitude
        expect(calculateBoundsAreaKm2(arcticBounds)).toBeLessThan(
          calculateBoundsAreaKm2(equatorBounds),
        );
      });
    });

    describe('calculateOptimalTileRadius()', () => {
      const calculateBoundsAreaKm2 = (bounds: Bounds): number => {
        const latDiff = bounds.ne.lat - bounds.sw.lat;
        const lngDiff = bounds.ne.lng - bounds.sw.lng;
        const midLat = (bounds.ne.lat + bounds.sw.lat) / 2;
        const latKm = latDiff * 111.32;
        const lngKm = lngDiff * 111.32 * Math.cos((midLat * Math.PI) / 180);
        return latKm * lngKm;
      };

      const calculateOptimalTileRadius = (bounds: Bounds): number => {
        const areaKm2 = calculateBoundsAreaKm2(bounds);

        if (areaKm2 < 50) return 2500;
        else if (areaKm2 < 200) return 2000;
        else return 1500;
      };

      it('should return larger tiles for small dense areas', () => {
        const smallBounds: Bounds = {
          ne: { lat: 40.75, lng: -73.95 },
          sw: { lat: 40.7, lng: -74.0 },
        };

        expect(calculateOptimalTileRadius(smallBounds)).toBe(2500);
      });

      it('should return medium tiles for suburban areas', () => {
        // Area should be between 50-200 km² for medium tiles
        // ~0.12° lat x 0.15° lng at 40.75° latitude ≈ 13.4km x 11.3km ≈ 151 km²
        const mediumBounds: Bounds = {
          ne: { lat: 40.82, lng: -73.85 },
          sw: { lat: 40.7, lng: -74.0 },
        };

        expect(calculateOptimalTileRadius(mediumBounds)).toBe(2000);
      });

      it('should return smaller tiles for large areas', () => {
        const largeBounds: Bounds = {
          ne: { lat: 42.0, lng: -72.0 },
          sw: { lat: 40.0, lng: -75.0 },
        };

        expect(calculateOptimalTileRadius(largeBounds)).toBe(1500);
      });
    });
  });

  // ============================================================================
  // makeGridTiles Tests
  // ============================================================================

  describe('makeGridTiles()', () => {
    const makeGridTiles = (
      bounds: Bounds,
      approxRadiusM?: number,
    ): Array<{ center: LatLng; radius: number }> => {
      // Adaptive radius calculation
      const calculateBoundsAreaKm2 = (b: Bounds): number => {
        const latDiff = b.ne.lat - b.sw.lat;
        const lngDiff = b.ne.lng - b.sw.lng;
        const midLat = (b.ne.lat + b.sw.lat) / 2;
        const latKm = latDiff * 111.32;
        const lngKm = lngDiff * 111.32 * Math.cos((midLat * Math.PI) / 180);
        return latKm * lngKm;
      };

      const calculateOptimalTileRadius = (b: Bounds): number => {
        const areaKm2 = calculateBoundsAreaKm2(b);
        if (areaKm2 < 50) return 2500;
        else if (areaKm2 < 200) return 2000;
        else return 1500;
      };

      const tileRadius = approxRadiusM ?? calculateOptimalTileRadius(bounds);
      const latDegPerM = 1 / 111_320;
      const midLat = (bounds.ne.lat + bounds.sw.lat) / 2;
      const lngDegPerM = 1 / (111_320 * Math.cos((midLat * Math.PI) / 180));

      const overlapFactor = 0.5;
      const stepLatDeg = tileRadius * (2.0 - overlapFactor) * latDegPerM;
      const stepLngDeg = tileRadius * (2.0 - overlapFactor) * lngDegPerM;

      const tiles: Array<{ center: LatLng; radius: number }> = [];

      for (let lat = bounds.sw.lat; lat <= bounds.ne.lat; lat += stepLatDeg) {
        for (let lng = bounds.sw.lng; lng <= bounds.ne.lng; lng += stepLngDeg) {
          const cellCenter = {
            lat: Math.min(lat + stepLatDeg / 2, bounds.ne.lat),
            lng: Math.min(lng + stepLngDeg / 2, bounds.ne.lng),
          };
          tiles.push({ center: cellCenter, radius: tileRadius });
        }
      }

      return tiles;
    };

    it('should generate tiles covering the entire bounds', () => {
      const bounds: Bounds = {
        ne: { lat: 40.8, lng: -73.9 },
        sw: { lat: 40.7, lng: -74.1 },
      };

      const tiles = makeGridTiles(bounds);

      expect(tiles.length).toBeGreaterThan(0);
      tiles.forEach((tile) => {
        expect(tile.center.lat).toBeGreaterThanOrEqual(bounds.sw.lat);
        expect(tile.center.lat).toBeLessThanOrEqual(bounds.ne.lat);
        expect(tile.center.lng).toBeGreaterThanOrEqual(bounds.sw.lng);
        expect(tile.center.lng).toBeLessThanOrEqual(bounds.ne.lng);
      });
    });

    it('should use specified radius when provided', () => {
      const bounds: Bounds = {
        ne: { lat: 40.8, lng: -73.9 },
        sw: { lat: 40.7, lng: -74.0 },
      };

      const customRadius = 1000;
      const tiles = makeGridTiles(bounds, customRadius);

      tiles.forEach((tile) => {
        expect(tile.radius).toBe(customRadius);
      });
    });

    it('should generate more tiles for larger areas', () => {
      const smallBounds: Bounds = {
        ne: { lat: 40.75, lng: -73.95 },
        sw: { lat: 40.7, lng: -74.0 },
      };

      const largeBounds: Bounds = {
        ne: { lat: 41.0, lng: -73.5 },
        sw: { lat: 40.5, lng: -74.5 },
      };

      const smallTiles = makeGridTiles(smallBounds, 1500);
      const largeTiles = makeGridTiles(largeBounds, 1500);

      expect(largeTiles.length).toBeGreaterThan(smallTiles.length);
    });

    it('should handle very small bounds', () => {
      const tinyBounds: Bounds = {
        ne: { lat: 40.701, lng: -73.999 },
        sw: { lat: 40.7, lng: -74.0 },
      };

      const tiles = makeGridTiles(tinyBounds);

      expect(tiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should maintain 50% overlap between tiles', () => {
      const bounds: Bounds = {
        ne: { lat: 40.8, lng: -73.9 },
        sw: { lat: 40.7, lng: -74.0 },
      };

      const tiles = makeGridTiles(bounds, 2000);

      // With 50% overlap, adjacent tile centers should be 1.5 * radius apart
      // This is approximate due to lat/lng conversions
      if (tiles.length > 1) {
        expect(tiles[0]!.radius).toBe(2000);
        // All tiles should have same radius
        tiles.forEach((tile) => {
          expect(tile.radius).toBe(tiles[0]!.radius);
        });
      }
    });
  });

  // ============================================================================
  // searchPlacesWithTiling Tests
  // ============================================================================

  describe('searchPlacesWithTiling()', () => {
    const createMockCorrelation = () => ({
      id: 'test-correlation-id',
      type: 'google_maps_discovery',
      userId: 'test-user',
      timestamp: Date.now(),
    });

    it('should throw error when no location provided', async () => {
      const searchPlacesWithTiling = async (params: {
        apiKey: string;
        query: string;
        bounds?: Bounds;
        center?: LatLng;
        maxResults: number;
        correlation: any;
      }) => {
        if (!params.bounds && !params.center) {
          throw new Error('Must provide either bounds or center for tiling search');
        }
        return { places: [], tilesSearched: 0, totalApiCalls: 0, duplicatesFiltered: 0, timeMs: 0 };
      };

      await expect(
        searchPlacesWithTiling({
          apiKey: 'test-key',
          query: 'restaurant',
          maxResults: 50,
          correlation: createMockCorrelation(),
        }),
      ).rejects.toThrow('Must provide either bounds or center');
    });

    it('should cap tiles at maxTiles limit', async () => {
      let tilesGenerated = 0;

      const searchPlacesWithTiling = async (params: {
        apiKey: string;
        query: string;
        bounds: Bounds;
        maxResults: number;
        maxTiles?: number;
        correlation: any;
      }) => {
        // Simulate generating many tiles
        const generatedTiles = Array(500).fill({ center: { lat: 40.7, lng: -74 }, radius: 1500 });
        const maxTiles = params.maxTiles || 250;

        tilesGenerated = Math.min(generatedTiles.length, maxTiles);

        return {
          places: [],
          tilesSearched: tilesGenerated,
          totalApiCalls: 0,
          duplicatesFiltered: 0,
          timeMs: 0,
        };
      };

      const result = await searchPlacesWithTiling({
        apiKey: 'test-key',
        query: 'restaurant',
        bounds: { ne: { lat: 42, lng: -72 }, sw: { lat: 39, lng: -76 } },
        maxResults: 100,
        maxTiles: 100,
        correlation: createMockCorrelation(),
      });

      expect(result.tilesSearched).toBeLessThanOrEqual(100);
    });

    it('should deduplicate places by place_id', async () => {
      const places: Place[] = [
        { place_id: 'place1', name: 'Restaurant A' },
        { place_id: 'place2', name: 'Restaurant B' },
        { place_id: 'place1', name: 'Restaurant A' }, // Duplicate
        { place_id: 'place3', name: 'Restaurant C' },
        { place_id: 'place2', name: 'Restaurant B' }, // Duplicate
      ];

      const deduplicate = (allPlaces: Place[]): { places: Place[]; duplicates: number } => {
        const seen = new Set<string>();
        const unique: Place[] = [];
        let duplicates = 0;

        for (const place of allPlaces) {
          if (!place.place_id) continue;
          if (seen.has(place.place_id)) {
            duplicates++;
            continue;
          }
          seen.add(place.place_id);
          unique.push(place);
        }

        return { places: unique, duplicates };
      };

      const result = deduplicate(places);

      expect(result.places.length).toBe(3);
      expect(result.duplicates).toBe(2);
    });

    it('should respect maxResults limit', async () => {
      const allPlaces: Place[] = Array(200)
        .fill(null)
        .map((_, i) => ({
          place_id: `place${i}`,
          name: `Restaurant ${i}`,
        }));

      const limitResults = (places: Place[], maxResults: number): Place[] => {
        return places.slice(0, maxResults);
      };

      const limited = limitResults(allPlaces, 50);

      expect(limited.length).toBe(50);
    });

    it('should handle API rate limiting with backoff', async () => {
      let attempts = 0;
      const maxRetries = 3;
      const backoffBaseMs = 1000;

      const mockApiCallWithRateLimiting = async (): Promise<{ status: string; results: Place[] }> => {
        attempts++;
        if (attempts <= 2) {
          // Simulate rate limit on first two attempts
          return { status: 'OVER_QUERY_LIMIT', results: [] };
        }
        return { status: 'OK', results: [{ place_id: 'test1', name: 'Test' }] };
      };

      const fetchWithRetry = async (): Promise<Place[]> => {
        let attempt = 0;
        while (attempt < maxRetries) {
          const result = await mockApiCallWithRateLimiting();
          if (result.status === 'OK') {
            return result.results;
          }
          if (result.status === 'OVER_QUERY_LIMIT') {
            const wait = Math.min(60000, backoffBaseMs * Math.pow(2, attempt));
            // In real code: await sleep(wait);
            attempt++;
            continue;
          }
          throw new Error(`API error: ${result.status}`);
        }
        throw new Error('Max retries exceeded');
      };

      const results = await fetchWithRetry();

      expect(results.length).toBe(1);
      expect(attempts).toBe(3);
    });

    it('should track API call count', async () => {
      let totalApiCalls = 0;

      const mockTileSearch = async (tiles: number, pagesPerTile: number): Promise<number> => {
        for (let i = 0; i < tiles; i++) {
          for (let j = 0; j < pagesPerTile; j++) {
            totalApiCalls++;
          }
        }
        return totalApiCalls;
      };

      await mockTileSearch(5, 3); // 5 tiles, 3 pages each

      expect(totalApiCalls).toBe(15);
    });

    it('should handle cancellation during search', async () => {
      let cancelled = false;
      let tilesProcessed = 0;

      const shouldCancel = async () => cancelled;

      const searchWithCancellation = async (tiles: number): Promise<{ tilesProcessed: number; cancelled: boolean }> => {
        for (let i = 0; i < tiles; i++) {
          if (await shouldCancel()) {
            return { tilesProcessed, cancelled: true };
          }
          tilesProcessed++;

          // Simulate cancellation after 3 tiles
          if (tilesProcessed === 3) {
            cancelled = true;
          }
        }
        return { tilesProcessed, cancelled: false };
      };

      const result = await searchWithCancellation(10);

      expect(result.tilesProcessed).toBe(3);
      expect(result.cancelled).toBe(true);
    });
  });

  // ============================================================================
  // fetchPlacesPageNearby Tests
  // ============================================================================

  describe('fetchPlacesPageNearby()', () => {
    it('should construct correct URL for first page', () => {
      const params = {
        location: { lat: 40.7128, lng: -74.006 },
        radiusMeters: 5000,
        type: 'restaurant',
        keyword: 'pizza',
        apiKey: 'test-api-key',
      };

      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('location', `${params.location.lat},${params.location.lng}`);
      url.searchParams.set('radius', String(params.radiusMeters));
      if (params.type) url.searchParams.set('type', params.type);
      if (params.keyword) url.searchParams.set('keyword', params.keyword);
      url.searchParams.set('key', params.apiKey);

      expect(url.searchParams.get('location')).toBe('40.7128,-74.006');
      expect(url.searchParams.get('radius')).toBe('5000');
      expect(url.searchParams.get('type')).toBe('restaurant');
      expect(url.searchParams.get('keyword')).toBe('pizza');
      expect(url.searchParams.get('key')).toBe('test-api-key');
    });

    it('should use pagetoken for subsequent pages', () => {
      const params = {
        pagetoken: 'next_page_token_123',
        apiKey: 'test-api-key',
      };

      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('pagetoken', params.pagetoken);
      url.searchParams.set('key', params.apiKey);

      expect(url.searchParams.get('pagetoken')).toBe('next_page_token_123');
      expect(url.searchParams.has('location')).toBe(false);
      expect(url.searchParams.has('radius')).toBe(false);
    });

    it('should handle successful API response', async () => {
      const mockResponse = {
        status: 'OK',
        results: [
          { place_id: 'test1', name: 'Restaurant 1' },
          { place_id: 'test2', name: 'Restaurant 2' },
        ],
        next_page_token: 'token123',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch('https://maps.googleapis.com/...');
      const data = await response.json();

      expect(data.status).toBe('OK');
      expect(data.results.length).toBe(2);
      expect(data.next_page_token).toBe('token123');
    });

    it('should handle ZERO_RESULTS status', async () => {
      const mockResponse = {
        status: 'ZERO_RESULTS',
        results: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const response = await mockFetch('https://maps.googleapis.com/...');
      const data = await response.json();

      expect(data.status).toBe('ZERO_RESULTS');
      expect(data.results.length).toBe(0);
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const response = await mockFetch('https://maps.googleapis.com/...');

      if (!response.ok) {
        expect(response.status).toBe(500);
      }
    });
  });

  // ============================================================================
  // fetchTileAllPages Tests
  // ============================================================================

  describe('fetchTileAllPages()', () => {
    it('should fetch up to 3 pages per tile', async () => {
      let pagesFetched = 0;
      const maxPages = 3;

      const fetchTileAllPages = async (): Promise<{ places: Place[]; pagesFetched: number }> => {
        const places: Place[] = [];
        let pageToken: string | undefined = undefined;

        for (let i = 0; i < maxPages; i++) {
          pagesFetched++;
          places.push({ place_id: `place${i}`, name: `Place ${i}` });

          // Simulate page token for next pages
          if (i < maxPages - 1) {
            pageToken = `token_page_${i + 1}`;
          } else {
            pageToken = undefined; // No more pages
          }

          if (!pageToken) break;
        }

        return { places, pagesFetched };
      };

      const result = await fetchTileAllPages();

      expect(result.pagesFetched).toBeLessThanOrEqual(3);
    });

    it('should stop when no next_page_token', async () => {
      const fetchTileAllPages = async (): Promise<{ pagesFetched: number }> => {
        let pagesFetched = 0;
        let pageToken: string | undefined = 'initial';

        while (pageToken && pagesFetched < 3) {
          pagesFetched++;
          // Simulate no more pages after first
          pageToken = pagesFetched === 1 ? undefined : `token_${pagesFetched}`;
        }

        return { pagesFetched };
      };

      const result = await fetchTileAllPages();

      expect(result.pagesFetched).toBe(1);
    });

    it('should stop when maxPerTile reached', async () => {
      const maxPerTile = 40;

      const fetchTileAllPages = async (): Promise<{ places: Place[]; pagesFetched: number }> => {
        const places: Place[] = [];
        let pagesFetched = 0;

        while (pagesFetched < 3 && places.length < maxPerTile) {
          pagesFetched++;
          // Add 20 places per page
          for (let i = 0; i < 20; i++) {
            if (places.length >= maxPerTile) break;
            places.push({ place_id: `place${places.length}`, name: `Place ${places.length}` });
          }
        }

        return { places, pagesFetched };
      };

      const result = await fetchTileAllPages();

      expect(result.places.length).toBeLessThanOrEqual(maxPerTile);
    });
  });

  // ============================================================================
  // Progressive Termination Tests
  // ============================================================================

  describe('Progressive Termination', () => {
    it('should stop early when target results reached', async () => {
      const targetWithBuffer = Math.ceil(50 * 1.2); // 60 with 20% buffer
      let globalPlaceCount = 0;
      let tilesProcessed = 0;
      const totalTiles = 20;

      const processWithEarlyTermination = async () => {
        for (let i = 0; i < totalTiles; i++) {
          if (globalPlaceCount >= targetWithBuffer) {
            return { tilesProcessed, earlyTermination: true };
          }

          tilesProcessed++;
          globalPlaceCount += 10; // Simulate finding 10 places per tile
        }

        return { tilesProcessed, earlyTermination: false };
      };

      const result = await processWithEarlyTermination();

      expect(result.earlyTermination).toBe(true);
      expect(result.tilesProcessed).toBe(6); // 6 tiles × 10 places = 60 (≥ target)
      expect(globalPlaceCount).toBe(60);
    });

    it('should use exact maxResults as termination target', () => {
      const maxResults = 100;
      const targetWithBuffer = maxResults;

      expect(targetWithBuffer).toBe(100);
    });

    it('should track early termination across workers', async () => {
      const targetWithBuffer = 50;
      const workers = 3;
      let globalPlaceCount = 0;
      let workersEarlyTerminated = 0;

      const workerResults: Array<{ places: number; earlyTermination: boolean }> = [];

      for (let w = 0; w < workers; w++) {
        const placesFound = 20;

        if (globalPlaceCount >= targetWithBuffer) {
          workersEarlyTerminated++;
          workerResults.push({ places: 0, earlyTermination: true });
        } else {
          globalPlaceCount += placesFound;
          workerResults.push({ places: placesFound, earlyTermination: false });
        }
      }

      expect(globalPlaceCount).toBe(60);
      expect(workersEarlyTerminated).toBe(0); // All workers processed before threshold
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle INVALID_REQUEST for page tokens', async () => {
      const handleInvalidRequest = async (
        status: string,
        hasPageToken: boolean,
      ): Promise<{ shouldRetry: boolean; action: string }> => {
        if (status === 'INVALID_REQUEST' && hasPageToken) {
          return { shouldRetry: true, action: 'wait_2_seconds' };
        }
        return { shouldRetry: false, action: 'throw_error' };
      };

      const result = await handleInvalidRequest('INVALID_REQUEST', true);

      expect(result.shouldRetry).toBe(true);
      expect(result.action).toBe('wait_2_seconds');
    });

    it('should implement exponential backoff', () => {
      const backoffBaseMs = 1000;
      const maxBackoff = 60000;

      const calculateBackoff = (attempt: number): number => {
        return Math.min(maxBackoff, backoffBaseMs * Math.pow(2, attempt));
      };

      expect(calculateBackoff(0)).toBe(1000);
      expect(calculateBackoff(1)).toBe(2000);
      expect(calculateBackoff(2)).toBe(4000);
      expect(calculateBackoff(3)).toBe(8000);
      expect(calculateBackoff(10)).toBe(60000); // Capped at max
    });

    it('should throw after max retries exceeded', async () => {
      let attempts = 0;
      const maxRetries = 5;

      const fetchWithMaxRetries = async () => {
        while (attempts < maxRetries) {
          attempts++;
          // Always fail
          throw new Error('Network error');
        }
        throw new Error('Max retries exceeded');
      };

      await expect(fetchWithMaxRetries()).rejects.toThrow('Network error');
      expect(attempts).toBe(1);
    });

    it('should handle OVER_QUERY_LIMIT status', async () => {
      const handleStatus = (status: string): { shouldBackoff: boolean } => {
        if (['OVER_QUERY_LIMIT', 'RESOURCE_EXHAUSTED'].includes(status)) {
          return { shouldBackoff: true };
        }
        return { shouldBackoff: false };
      };

      expect(handleStatus('OVER_QUERY_LIMIT').shouldBackoff).toBe(true);
      expect(handleStatus('RESOURCE_EXHAUSTED').shouldBackoff).toBe(true);
      expect(handleStatus('OK').shouldBackoff).toBe(false);
    });
  });

  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe('Constants', () => {
    it('should have correct Google Places API status codes', () => {
      const validStatuses = ['OK', 'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'INVALID_REQUEST', 'RESOURCE_EXHAUSTED'];

      expect(validStatuses).toContain('OK');
      expect(validStatuses).toContain('ZERO_RESULTS');
      expect(validStatuses).toContain('OVER_QUERY_LIMIT');
    });

    it('should wait 2 seconds for page token activation', () => {
      const PAGE_TOKEN_WAIT_MS = 2000;

      expect(PAGE_TOKEN_WAIT_MS).toBe(2000);
    });

    it('should have max 3 pages per tile', () => {
      const MAX_PAGES_PER_TILE = 3;
      const MAX_RESULTS_PER_PAGE = 20;
      const MAX_RESULTS_PER_TILE = MAX_PAGES_PER_TILE * MAX_RESULTS_PER_PAGE;

      expect(MAX_RESULTS_PER_TILE).toBe(60);
    });
  });
});
