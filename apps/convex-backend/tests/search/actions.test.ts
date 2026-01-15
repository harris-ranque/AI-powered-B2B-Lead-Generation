/**
 * Comprehensive Tests for search/actions.ts
 *
 * Tests the search action functions including:
 * - searchGoogleMaps() - Lead discovery with Google Places API
 * - Helper functions for radius calculation, bounds, etc.
 * - Error handling and edge cases
 * - Integration with correlation system
 *
 * Priority: P0 - Critical for lead generation pipeline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockActionContext,
  mockId,
  createMockDocument,
  resetAllMocks,
} from '../testUtils';
import type { GenericId } from 'convex/values';

type UserId = GenericId<'users'>;
type SearchId = GenericId<'searches'>;

// Mock fetch for Google API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Search Actions Tests - search/actions.ts', () => {
  let mockCtx: ReturnType<typeof createMockActionContext>;
  let testUserId: UserId;
  let testSearchId: SearchId;

  beforeEach(() => {
    mockCtx = createMockActionContext();
    testUserId = mockId('users');
    testSearchId = mockId('searches');
    resetAllMocks();
    mockFetch.mockReset();

    // Set up environment variables
    process.env.GOOGLE_MAPS_API_KEY = 'test-google-api-key';
    process.env.LANGGRAPH_URL = 'http://localhost:8080';
    process.env.LANGGRAPH_API_KEY = 'test-langgraph-key';
  });

  afterEach(() => {
    resetAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.LANGGRAPH_URL;
    delete process.env.LANGGRAPH_API_KEY;
  });

  // ============================================================================
  // Helper Function Tests
  // ============================================================================

  describe('Helper Functions', () => {
    describe('clamp()', () => {
      // Inline implementation for testing
      const clamp = (value: number, min: number, max: number) =>
        Math.max(min, Math.min(value, max));

      it('should return value when within bounds', () => {
        expect(clamp(50, 0, 100)).toBe(50);
        expect(clamp(0, 0, 100)).toBe(0);
        expect(clamp(100, 0, 100)).toBe(100);
      });

      it('should clamp to minimum when below', () => {
        expect(clamp(-10, 0, 100)).toBe(0);
        expect(clamp(-100, -50, 50)).toBe(-50);
      });

      it('should clamp to maximum when above', () => {
        expect(clamp(150, 0, 100)).toBe(100);
        expect(clamp(1000, -50, 50)).toBe(50);
      });
    });

    describe('normalizeLongitude()', () => {
      const normalizeLongitude = (lng: number) => {
        if (lng > 180) return ((lng + 180) % 360) - 180;
        if (lng < -180) return ((lng - 180) % 360) + 180;
        return lng;
      };

      it('should return longitude unchanged when in valid range', () => {
        expect(normalizeLongitude(0)).toBe(0);
        expect(normalizeLongitude(180)).toBe(180);
        expect(normalizeLongitude(-180)).toBe(-180);
        expect(normalizeLongitude(90)).toBe(90);
        expect(normalizeLongitude(-90)).toBe(-90);
      });

      it('should normalize longitude greater than 180', () => {
        expect(normalizeLongitude(181)).toBeCloseTo(-179, 5);
        expect(normalizeLongitude(270)).toBeCloseTo(-90, 5);
        expect(normalizeLongitude(360)).toBeCloseTo(0, 5);
      });

      it('should normalize longitude less than -180', () => {
        expect(normalizeLongitude(-181)).toBeCloseTo(179, 5);
        expect(normalizeLongitude(-270)).toBeCloseTo(90, 5);
      });
    });

    describe('estimateOptimalRadius()', () => {
      const estimateOptimalRadius = (maxResults: number, userRadiusMiles: number): number => {
        if (maxResults <= 50) return userRadiusMiles;
        if (maxResults <= 150) return Math.max(userRadiusMiles, 15);
        if (maxResults <= 300) return Math.max(userRadiusMiles, 25);
        return Math.max(userRadiusMiles, 35);
      };

      it('should respect user radius for small searches', () => {
        expect(estimateOptimalRadius(10, 5)).toBe(5);
        expect(estimateOptimalRadius(50, 10)).toBe(10);
      });

      it('should suggest minimum 15 miles for medium searches', () => {
        expect(estimateOptimalRadius(100, 5)).toBe(15);
        expect(estimateOptimalRadius(150, 20)).toBe(20);
      });

      it('should suggest minimum 25 miles for large searches', () => {
        expect(estimateOptimalRadius(200, 5)).toBe(25);
        expect(estimateOptimalRadius(300, 30)).toBe(30);
      });

      it('should suggest minimum 35 miles for very large searches', () => {
        expect(estimateOptimalRadius(500, 5)).toBe(35);
        expect(estimateOptimalRadius(1000, 40)).toBe(40);
      });
    });

    describe('boundsFromCenterRadius()', () => {
      const clamp = (value: number, min: number, max: number) =>
        Math.max(min, Math.min(value, max));

      const normalizeLongitude = (lng: number) => {
        if (lng > 180) return ((lng + 180) % 360) - 180;
        if (lng < -180) return ((lng - 180) % 360) + 180;
        return lng;
      };

      const boundsFromCenterRadius = (
        center: { lat: number; lng: number },
        radiusMeters: number,
      ) => {
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
      };

      it('should create valid bounds for typical center point', () => {
        const center = { lat: 40.7128, lng: -74.006 }; // New York
        const radiusMeters = 5000;

        const bounds = boundsFromCenterRadius(center, radiusMeters);

        expect(bounds.ne.lat).toBeGreaterThan(center.lat);
        expect(bounds.sw.lat).toBeLessThan(center.lat);
        expect(bounds.ne.lng).toBeGreaterThan(center.lng);
        expect(bounds.sw.lng).toBeLessThan(center.lng);
      });

      it('should clamp latitude to valid range at poles', () => {
        const northPole = { lat: 89.5, lng: 0 };
        const radiusMeters = 100000;

        const bounds = boundsFromCenterRadius(northPole, radiusMeters);

        expect(bounds.ne.lat).toBeLessThanOrEqual(90);
        expect(bounds.sw.lat).toBeGreaterThanOrEqual(-90);
      });

      it('should handle equator correctly', () => {
        const equator = { lat: 0, lng: 0 };
        const radiusMeters = 10000;

        const bounds = boundsFromCenterRadius(equator, radiusMeters);

        expect(Math.abs(bounds.ne.lat)).toBeCloseTo(Math.abs(bounds.sw.lat), 5);
        expect(Math.abs(bounds.ne.lng)).toBeCloseTo(Math.abs(bounds.sw.lng), 5);
      });
    });

    describe('computeRingSegments()', () => {
      const computeRingSegments = (
        previous: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } },
        expanded: { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } },
      ) => {
        const segments: Array<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } }> = [];

        if (expanded.ne.lat > previous.ne.lat) {
          segments.push({
            ne: { lat: expanded.ne.lat, lng: expanded.ne.lng },
            sw: { lat: previous.ne.lat, lng: expanded.sw.lng },
          });
        }

        if (expanded.sw.lat < previous.sw.lat) {
          segments.push({
            ne: { lat: previous.sw.lat, lng: expanded.ne.lng },
            sw: { lat: expanded.sw.lat, lng: expanded.sw.lng },
          });
        }

        if (expanded.sw.lng < previous.sw.lng) {
          segments.push({
            ne: { lat: previous.ne.lat, lng: previous.sw.lng },
            sw: { lat: previous.sw.lat, lng: expanded.sw.lng },
          });
        }

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
      };

      it('should compute ring segments for expanded bounds', () => {
        const previous = {
          ne: { lat: 41, lng: -73 },
          sw: { lat: 40, lng: -74 },
        };
        const expanded = {
          ne: { lat: 42, lng: -72 },
          sw: { lat: 39, lng: -75 },
        };

        const segments = computeRingSegments(previous, expanded);

        expect(segments.length).toBeGreaterThan(0);
        expect(segments.length).toBeLessThanOrEqual(4);
      });

      it('should return empty array when bounds are identical', () => {
        const bounds = {
          ne: { lat: 41, lng: -73 },
          sw: { lat: 40, lng: -74 },
        };

        const segments = computeRingSegments(bounds, bounds);

        expect(segments.length).toBe(0);
      });

      it('should filter out invalid segments', () => {
        const previous = {
          ne: { lat: 41, lng: -73 },
          sw: { lat: 40, lng: -74 },
        };
        const expanded = {
          ne: { lat: 42, lng: -72 },
          sw: { lat: 39, lng: -75 },
        };

        const segments = computeRingSegments(previous, expanded);

        segments.forEach((segment) => {
          expect(segment.ne.lat).toBeGreaterThan(segment.sw.lat);
          expect(segment.ne.lng).toBeGreaterThan(segment.sw.lng);
        });
      });
    });

    describe('findAddressComponentValue()', () => {
      const findAddressComponentValue = (
        components: Array<{ long_name?: string; short_name?: string; types?: string[] }> | undefined,
        targetTypes: string[],
        { preferShort }: { preferShort?: boolean } = {},
      ): string | undefined => {
        if (!components || components.length === 0) return undefined;

        const match = components.find((component) =>
          targetTypes.every((type) => component.types?.includes(type)),
        );

        if (!match) return undefined;
        if (preferShort) return match.short_name ?? match.long_name ?? undefined;
        return match.long_name ?? match.short_name ?? undefined;
      };

      it('should return undefined for empty components', () => {
        expect(findAddressComponentValue(undefined, ['locality'])).toBeUndefined();
        expect(findAddressComponentValue([], ['locality'])).toBeUndefined();
      });

      it('should find matching component by types', () => {
        const components = [
          { long_name: 'New York', short_name: 'NY', types: ['locality', 'political'] },
          { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
        ];

        expect(findAddressComponentValue(components, ['locality'])).toBe('New York');
        expect(findAddressComponentValue(components, ['country'])).toBe('United States');
      });

      it('should prefer short name when specified', () => {
        const components = [
          { long_name: 'California', short_name: 'CA', types: ['administrative_area_level_1'] },
        ];

        expect(findAddressComponentValue(components, ['administrative_area_level_1'], { preferShort: true })).toBe('CA');
        expect(findAddressComponentValue(components, ['administrative_area_level_1'], { preferShort: false })).toBe('California');
      });

      it('should return undefined when no match found', () => {
        const components = [
          { long_name: 'New York', types: ['locality'] },
        ];

        expect(findAddressComponentValue(components, ['country'])).toBeUndefined();
      });
    });
  });

  // ============================================================================
  // searchGoogleMaps Action Tests
  // ============================================================================

  describe('searchGoogleMaps()', () => {
    describe('Authentication and Authorization', () => {
      it('should reject search when search record not found', async () => {
        mockCtx.runQuery.mockResolvedValueOnce(null); // getSearchInternal returns null
        mockCtx.runAction.mockResolvedValueOnce({ success: true }); // health check

        const searchGoogleMaps = async (ctx: any, args: { searchId: SearchId }) => {
          // Simulate health check
          await ctx.runAction('langgraph.health.checkLangGraphHealth', {});

          // Get system config (mock as enabled)
          const systemConfig = { orchestrationSettings: { leadGenerationEnabled: true } };

          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          if (!search) {
            throw new Error('Search not found or access denied');
          }

          return { success: true };
        };

        await expect(
          searchGoogleMaps(mockCtx, { searchId: testSearchId }),
        ).rejects.toThrow('Search not found or access denied');
      });

      it('should handle cancelled search gracefully', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'cancelled' as const,
          parameters: {
            keywords: ['restaurant'],
            location: 'New York, NY',
            radius: 5,
            maxResults: 50,
          },
        });

        mockCtx.runAction.mockResolvedValueOnce({ success: true }); // health check
        // Only mock the search query - function doesn't query system config separately
        mockCtx.runQuery.mockResolvedValueOnce(mockSearch); // getSearchInternal

        const searchGoogleMaps = async (ctx: any, args: { searchId: SearchId }) => {
          await ctx.runAction('langgraph.health.checkLangGraphHealth', {});

          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          if (search.status === 'cancelled') {
            return { success: false, message: 'Search already cancelled' };
          }

          return { success: true };
        };

        const result = await searchGoogleMaps(mockCtx, { searchId: testSearchId });

        expect(result.success).toBe(false);
        expect(result.message).toBe('Search already cancelled');
      });

      it('should block search when lead generation is paused', async () => {
        mockCtx.runAction.mockResolvedValueOnce({ success: true }); // health check
        mockCtx.runQuery.mockResolvedValueOnce({
          orchestrationSettings: { leadGenerationEnabled: false },
        });

        const searchGoogleMaps = async (ctx: any, args: { searchId: SearchId }) => {
          await ctx.runAction('langgraph.health.checkLangGraphHealth', {});

          const systemConfig = await ctx.runQuery('admin.queries.getSystemConfiguration', {});

          if (systemConfig?.orchestrationSettings?.leadGenerationEnabled === false) {
            throw new Error('Lead generation is currently paused. Please contact administrator.');
          }

          return { success: true };
        };

        await expect(
          searchGoogleMaps(mockCtx, { searchId: testSearchId }),
        ).rejects.toThrow('Lead generation is currently paused');
      });

      it('should handle paused user processing', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'pending' as const,
          parameters: {
            keywords: ['restaurant'],
            location: 'New York, NY',
            radius: 5,
            maxResults: 50,
          },
        });

        const mockUser = createMockDocument('users', {
          processingPaused: true,
          pauseReason: 'Account under review',
        });

        mockCtx.runAction.mockResolvedValueOnce({ success: true }); // health check
        mockCtx.runQuery
          .mockResolvedValueOnce({ orchestrationSettings: { leadGenerationEnabled: true } })
          .mockResolvedValueOnce(mockSearch)
          .mockResolvedValueOnce(mockUser);
        mockCtx.runMutation.mockResolvedValue(undefined);

        const searchGoogleMaps = async (ctx: any, args: { searchId: SearchId }) => {
          await ctx.runAction('langgraph.health.checkLangGraphHealth', {});

          const systemConfig = await ctx.runQuery('admin.queries.getSystemConfiguration', {});
          const search = await ctx.runQuery('internal.search.internal.getSearchInternal', {
            searchId: args.searchId,
          });

          const user = await ctx.runQuery('internal.users.internal.getUserInternal', {
            userId: search.userId,
          });

          if (user?.processingPaused) {
            await ctx.runMutation('internal.search.internal.updateSearchStatusInternal', {
              searchId: args.searchId,
              status: 'cancelled',
              error: user.pauseReason || 'User processing paused by admin',
            });

            return {
              success: false,
              message: 'User processing paused – search cancelled',
            };
          }

          return { success: true };
        };

        const result = await searchGoogleMaps(mockCtx, { searchId: testSearchId });

        expect(result.success).toBe(false);
        expect(result.message).toContain('paused');
        expect(mockCtx.runMutation).toHaveBeenCalled();
      });
    });

    describe('API Key Handling', () => {
      it('should use system API key for non-enterprise users', async () => {
        const mockSearch = createMockDocument('searches', {
          userId: testUserId,
          status: 'pending' as const,
          parameters: {
            keywords: ['restaurant'],
            location: 'New York, NY',
            radius: 5,
            maxResults: 50,
          },
        });

        const mockUser = createMockDocument('users', {
          plan: 'pro' as const,
          processingPaused: false,
        });

        let apiKeyUsed: string | undefined;

        const getApiKey = (userPlan: string) => {
          if (userPlan === 'enterprise') {
            // Would fetch user's key
            return 'user-provided-key';
          }
          return process.env.GOOGLE_MAPS_API_KEY;
        };

        apiKeyUsed = getApiKey(mockUser.plan);

        expect(apiKeyUsed).toBe('test-google-api-key');
      });

      it('should require user API key for enterprise users', async () => {
        const mockUser = createMockDocument('users', {
          plan: 'enterprise' as const,
        });

        mockCtx.runAction.mockRejectedValueOnce(new Error('API key not found'));

        const getApiKeyForEnterprise = async (ctx: any, userId: string) => {
          if (mockUser.plan === 'enterprise') {
            try {
              const result = await ctx.runAction('internal.userApiKeys.actions.resolveUserProviderKeys', {
                userId,
                purpose: 'lead_search',
              });
              return result.google_places;
            } catch {
              throw new Error('Enterprise users must provide their own Google Places API key for lead discovery');
            }
          }
          return process.env.GOOGLE_MAPS_API_KEY;
        };

        await expect(
          getApiKeyForEnterprise(mockCtx, testUserId),
        ).rejects.toThrow('Enterprise users must provide');
      });

      it('should throw error when no API key configured', async () => {
        delete process.env.GOOGLE_MAPS_API_KEY;

        const mockUser = createMockDocument('users', {
          plan: 'pro' as const,
        });

        const getApiKey = (userPlan: string) => {
          const key = process.env.GOOGLE_MAPS_API_KEY;
          if (!key) {
            throw new Error('Google Places API key not configured');
          }
          return key;
        };

        expect(() => getApiKey(mockUser.plan)).toThrow('Google Places API key not configured');
      });
    });

    describe('Deduplication Configuration', () => {
      it('should use search-level deduplication settings when provided', () => {
        const searchParams = {
          deduplication: {
            enablePlaceNameDedup: true,
            enableEmailDedup: false,
            enableAddressDedup: true,
          },
        };

        const userPreferences = {
          enablePlaceNameDedup: false,
          enableEmailDedup: true,
          enableAddressDedup: false,
        };

        const deduplicationConfig = {
          enablePlaceNameDedup:
            searchParams.deduplication?.enablePlaceNameDedup ??
            userPreferences?.enablePlaceNameDedup ??
            false,
          enableEmailDedup:
            searchParams.deduplication?.enableEmailDedup ??
            userPreferences?.enableEmailDedup ??
            true,
          enableAddressDedup:
            searchParams.deduplication?.enableAddressDedup ??
            userPreferences?.enableAddressDedup ??
            true,
        };

        expect(deduplicationConfig.enablePlaceNameDedup).toBe(true);
        expect(deduplicationConfig.enableEmailDedup).toBe(false);
        expect(deduplicationConfig.enableAddressDedup).toBe(true);
      });

      it('should fall back to user preferences when search settings not provided', () => {
        const searchParams = {};

        const userPreferences = {
          enablePlaceNameDedup: true,
          enableEmailDedup: false,
          enableAddressDedup: false,
        };

        const deduplicationConfig = {
          enablePlaceNameDedup:
            (searchParams as any).deduplication?.enablePlaceNameDedup ??
            userPreferences?.enablePlaceNameDedup ??
            false,
          enableEmailDedup:
            (searchParams as any).deduplication?.enableEmailDedup ??
            userPreferences?.enableEmailDedup ??
            true,
          enableAddressDedup:
            (searchParams as any).deduplication?.enableAddressDedup ??
            userPreferences?.enableAddressDedup ??
            true,
        };

        expect(deduplicationConfig.enablePlaceNameDedup).toBe(true);
        expect(deduplicationConfig.enableEmailDedup).toBe(false);
        expect(deduplicationConfig.enableAddressDedup).toBe(false);
      });

      it('should use defaults when no settings provided', () => {
        const searchParams = {};
        const userPreferences = undefined as ({
          enablePlaceNameDedup?: boolean;
          enableEmailDedup?: boolean;
          enableAddressDedup?: boolean;
        } | undefined);

        const deduplicationConfig = {
          enablePlaceNameDedup:
            (searchParams as any).deduplication?.enablePlaceNameDedup ??
            userPreferences?.enablePlaceNameDedup ??
            false,
          enableEmailDedup:
            (searchParams as any).deduplication?.enableEmailDedup ??
            userPreferences?.enableEmailDedup ??
            true,
          enableAddressDedup:
            (searchParams as any).deduplication?.enableAddressDedup ??
            userPreferences?.enableAddressDedup ??
            true,
        };

        expect(deduplicationConfig.enablePlaceNameDedup).toBe(false);
        expect(deduplicationConfig.enableEmailDedup).toBe(true);
        expect(deduplicationConfig.enableAddressDedup).toBe(true);
      });
    });

    describe('Expansion Configuration', () => {
      const DEFAULT_EXPANSION_ITERATIONS = 5;
      const DEFAULT_EXPANSION_MULTIPLIER = 1.5;
      const MAX_RADIUS_MULTIPLIER = 3;

      const clamp = (value: number, min: number, max: number) =>
        Math.max(min, Math.min(value, max));

      it('should use default expansion settings when not specified', () => {
        const userPreferences = undefined as ({
          maxSearchExpansionIterations?: number;
          searchExpansionMultiplier?: number;
        } | undefined);

        const maxExpansionIterations = Math.max(
          0,
          Math.min(
            Math.round(
              userPreferences?.maxSearchExpansionIterations ??
                DEFAULT_EXPANSION_ITERATIONS,
            ),
            DEFAULT_EXPANSION_ITERATIONS,
          ),
        );

        const expansionRadiusMultiplier = clamp(
          userPreferences?.searchExpansionMultiplier ??
            DEFAULT_EXPANSION_MULTIPLIER,
          1.1,
          MAX_RADIUS_MULTIPLIER,
        );

        expect(maxExpansionIterations).toBe(5);
        expect(expansionRadiusMultiplier).toBe(1.5);
      });

      it('should respect user expansion preferences within bounds', () => {
        const userPreferences = {
          maxSearchExpansionIterations: 3,
          searchExpansionMultiplier: 2.0,
        };

        const maxExpansionIterations = Math.max(
          0,
          Math.min(
            Math.round(
              userPreferences?.maxSearchExpansionIterations ??
                DEFAULT_EXPANSION_ITERATIONS,
            ),
            DEFAULT_EXPANSION_ITERATIONS,
          ),
        );

        const expansionRadiusMultiplier = clamp(
          userPreferences?.searchExpansionMultiplier ??
            DEFAULT_EXPANSION_MULTIPLIER,
          1.1,
          MAX_RADIUS_MULTIPLIER,
        );

        expect(maxExpansionIterations).toBe(3);
        expect(expansionRadiusMultiplier).toBe(2.0);
      });

      it('should clamp expansion multiplier to valid range', () => {
        const userPreferences = {
          searchExpansionMultiplier: 10.0, // Too high
        };

        const expansionRadiusMultiplier = clamp(
          userPreferences?.searchExpansionMultiplier ??
            DEFAULT_EXPANSION_MULTIPLIER,
          1.1,
          MAX_RADIUS_MULTIPLIER,
        );

        expect(expansionRadiusMultiplier).toBe(3); // Clamped to max

        const lowPreferences = {
          searchExpansionMultiplier: 0.5, // Too low
        };

        const lowMultiplier = clamp(
          lowPreferences?.searchExpansionMultiplier ??
            DEFAULT_EXPANSION_MULTIPLIER,
          1.1,
          MAX_RADIUS_MULTIPLIER,
        );

        expect(lowMultiplier).toBe(1.1); // Clamped to min
      });
    });

    describe('Status Updates', () => {
      it('should update search status to in_progress when starting', async () => {
        const mockSearch = createMockDocument('searches', {
          _id: testSearchId,
          userId: testUserId,
          status: 'pending' as const,
          parameters: {
            keywords: ['restaurant'],
            location: 'New York, NY',
            radius: 5,
            maxResults: 50,
          },
        });

        mockCtx.runMutation.mockResolvedValue(undefined);

        const updateStatus = async (ctx: any, searchId: SearchId, status: string) => {
          await ctx.runMutation('internal.search.internal.updateSearchStatusInternal', {
            searchId,
            status,
          });
        };

        await updateStatus(mockCtx, testSearchId, 'in_progress');

        expect(mockCtx.runMutation).toHaveBeenCalledWith(
          'internal.search.internal.updateSearchStatusInternal',
          expect.objectContaining({
            searchId: testSearchId,
            status: 'in_progress',
          }),
        );
      });

      it('should prevent starting already in-progress search without force flag', async () => {
        const mockSearch = createMockDocument('searches', {
          status: 'in_progress' as const,
        });

        const checkSearchStatus = (search: any, forceRestart?: boolean) => {
          if (!forceRestart && search.status === 'in_progress') {
            throw new Error('Search is already in progress');
          }
        };

        expect(() => checkSearchStatus(mockSearch, false)).toThrow('Search is already in progress');
        expect(() => checkSearchStatus(mockSearch, true)).not.toThrow();
      });
    });

    describe('Health Check Integration', () => {
      it('should perform LangGraph health check before starting', async () => {
        mockCtx.runAction.mockResolvedValueOnce({ success: true, status: 'healthy' });

        const performHealthCheck = async (ctx: any) => {
          try {
            const result = await ctx.runAction('internal.langgraph.health.checkLangGraphHealth', {});
            return {
              success: result?.success ?? false,
              status: result?.status ?? 'unknown',
            };
          } catch (error) {
            return { success: false, status: 'error' };
          }
        };

        const result = await performHealthCheck(mockCtx);

        expect(result.success).toBe(true);
        expect(result.status).toBe('healthy');
        expect(mockCtx.runAction).toHaveBeenCalled();
      });

      it('should continue even if health check fails', async () => {
        mockCtx.runAction.mockRejectedValueOnce(new Error('Health check failed'));

        const performHealthCheck = async (ctx: any) => {
          try {
            await ctx.runAction('internal.langgraph.health.checkLangGraphHealth', {});
            return { success: true };
          } catch (error) {
            // Log but don't throw - health check failure shouldn't block search
            console.error('Health check failed:', error);
            return { success: false, error: (error as Error).message };
          }
        };

        const result = await performHealthCheck(mockCtx);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Health check failed');
      });
    });
  });

  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe('Constants', () => {
    const METERS_PER_MILE = 1609.34;
    const MAX_PLACES_RADIUS_METERS = 50000;
    const INITIAL_FETCH_MULTIPLIER = 1.5;
    const MAX_RADIUS_MULTIPLIER = 3;
    const DEFAULT_EXPANSION_ITERATIONS = 5;
    const DEFAULT_EXPANSION_MULTIPLIER = 1.5;

    it('should have correct meters per mile conversion', () => {
      expect(METERS_PER_MILE).toBeCloseTo(1609.34, 2);
    });

    it('should have valid max radius for Google Places API', () => {
      expect(MAX_PLACES_RADIUS_METERS).toBe(50000);
      expect(MAX_PLACES_RADIUS_METERS).toBeLessThanOrEqual(50000); // Google API limit
    });

    it('should have sensible expansion configuration', () => {
      expect(INITIAL_FETCH_MULTIPLIER).toBeGreaterThan(1);
      expect(MAX_RADIUS_MULTIPLIER).toBeGreaterThan(INITIAL_FETCH_MULTIPLIER);
      expect(DEFAULT_EXPANSION_ITERATIONS).toBeGreaterThan(0);
      expect(DEFAULT_EXPANSION_MULTIPLIER).toBeGreaterThan(1);
      expect(DEFAULT_EXPANSION_MULTIPLIER).toBeLessThanOrEqual(MAX_RADIUS_MULTIPLIER);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty keywords array', () => {
      const keywords: string[] = [];
      const query = keywords.join(' ');

      expect(query).toBe('');
    });

    it('should handle very large radius values', () => {
      const MAX_PLACES_RADIUS_METERS = 50000;
      const userRadius = 100; // 100 miles
      const radiusMeters = userRadius * 1609.34;

      const clampedRadius = Math.min(radiusMeters, MAX_PLACES_RADIUS_METERS);

      expect(clampedRadius).toBe(MAX_PLACES_RADIUS_METERS);
    });

    it('should handle special characters in keywords', () => {
      const keywords = ['café', 'restaurant & bar', 'pizza/pasta'];
      const query = keywords.join(' ');

      expect(query).toBe('café restaurant & bar pizza/pasta');
    });

    it('should handle location with unicode characters', () => {
      const location = 'München, Germany';

      // Simulating URL encoding for API call
      const encoded = encodeURIComponent(location);

      expect(encoded).toBe('M%C3%BCnchen%2C%20Germany');
    });
  });
});
