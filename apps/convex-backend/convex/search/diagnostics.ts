/**
 * Google Maps API Diagnostics and Testing
 * 
 * Provides diagnostic functions to test Google Maps API connectivity,
 * validate API keys, and troubleshoot common issues.
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { API_CONFIG, ERROR_CODES } from "../lib/constants";
import { createError } from "../lib/helpers";
import { 
  createCorrelationContext, 
  logWithCorrelation, 
  OPERATION_TYPES,
  startPerformanceTracking,
  endPerformanceTracking,
  withTimeout
} from "../lib/correlation";

// Test Google Maps API connectivity and key validity
export const testGoogleMapsAPI = action({
  args: {},
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'diagnostics', test: 'api_connectivity' } }
    );
    
    logWithCorrelation('info', correlation, 'Starting Google Maps API diagnostics');
    
    const user = await getCurrentUser(ctx);
    if (!user) {
      logWithCorrelation('error', correlation, 'Authentication required for diagnostics');
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }
    
    correlation.userId = user._id;
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not found in environment');
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }
    
    const diagnostics = {
      apiKeyConfigured: !!apiKey,
      apiKeyFormat: apiKey.length > 0 ? `${apiKey.substring(0, 8)}...` : 'N/A',
      apiKeyLength: apiKey.length,
      tests: {
        geocoding: { success: false, duration: 0, error: null as string | null },
        placesSearch: { success: false, duration: 0, error: null as string | null },
        placeDetails: { success: false, duration: 0, error: null as string | null },
        autocomplete: { success: false, duration: 0, error: null as string | null },
      },
    };
    
    logWithCorrelation('debug', correlation, 'API key validation', {
      configured: diagnostics.apiKeyConfigured,
      length: diagnostics.apiKeyLength,
      format: diagnostics.apiKeyFormat
    });

    // Test 1: Geocoding API
    try {
      logWithCorrelation('info', correlation, 'Testing Geocoding API');
      const geocodingPerf = startPerformanceTracking();
      
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=New+York+NY&key=${apiKey}`;
      
      const geocodeResponse = await withTimeout(
        fetch(geocodeUrl),
        15000,
        correlation,
        'geocoding test'
      );
      
      const geocodeData = await geocodeResponse.json() as any;
      const geocodingPerfData = endPerformanceTracking(geocodingPerf);
      
      if (geocodeData.status === "OK" && geocodeData.results?.length > 0) {
        diagnostics.tests.geocoding.success = true;
        logWithCorrelation('info', correlation, 'Geocoding API test successful', {
          status: geocodeData.status,
          resultsCount: geocodeData.results.length,
          duration: geocodingPerfData?.duration || 0
        });
      } else {
        diagnostics.tests.geocoding.error = `API returned status: ${geocodeData.status}`;
        logWithCorrelation('error', correlation, 'Geocoding API test failed', {
          status: geocodeData.status,
          errorMessage: geocodeData.error_message
        });
      }
      
      diagnostics.tests.geocoding.duration = geocodingPerfData.duration || 0;
    } catch (error) {
      diagnostics.tests.geocoding.error = error instanceof Error ? error.message : 'Unknown error';
      logWithCorrelation('error', correlation, 'Geocoding API test error', {}, error as Error);
    }

    // Test 2: Places Search API (only if geocoding worked)
    if (diagnostics.tests.geocoding.success) {
      try {
        logWithCorrelation('info', correlation, 'Testing Places Search API');
        const placesPerf = startPerformanceTracking();
        
        const placesUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACES_SEARCH}?location=40.7128,-74.0060&radius=1000&keyword=restaurant&key=${apiKey}`;
        
        const placesResponse = await withTimeout(
          fetch(placesUrl),
          20000,
          correlation,
          'places search test'
        );
        
        const placesData = await placesResponse.json() as any;
        const placesPerfData = endPerformanceTracking(placesPerf);
        
        if (placesData.status === "OK" || placesData.status === "ZERO_RESULTS") {
          diagnostics.tests.placesSearch.success = true;
          logWithCorrelation('info', correlation, 'Places Search API test successful', {
            status: placesData.status,
            resultsCount: placesData.results?.length || 0,
            duration: placesPerfData?.duration || 0
          });
        } else {
          diagnostics.tests.placesSearch.error = `API returned status: ${placesData.status}`;
          logWithCorrelation('error', correlation, 'Places Search API test failed', {
            status: placesData.status,
            errorMessage: placesData.error_message
          });
        }
        
        diagnostics.tests.placesSearch.duration = placesPerfData?.duration || 0;
      } catch (error) {
        diagnostics.tests.placesSearch.error = error instanceof Error ? error.message : 'Unknown error';
        logWithCorrelation('error', correlation, 'Places Search API test error', {}, error as Error);
      }
    } else {
      diagnostics.tests.placesSearch.error = 'Skipped due to geocoding failure';
      logWithCorrelation('warn', correlation, 'Skipping Places Search test due to geocoding failure');
    }

    // Test 3: Place Details API (only if places search worked and returned results)
    if (diagnostics.tests.placesSearch.success) {
      try {
        logWithCorrelation('info', correlation, 'Testing Place Details API');
        const detailsPerf = startPerformanceTracking();
        
        // Use a well-known place ID for testing
        const testPlaceId = "ChIJN1t_tDeuEmsRUsoyG83frY4"; // Google Sydney Office
        const detailsUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACE_DETAILS}?place_id=${testPlaceId}&fields=name,formatted_address&key=${apiKey}`;
        
        const detailsResponse = await withTimeout(
          fetch(detailsUrl),
          15000,
          correlation,
          'place details test'
        );
        
        const detailsData = await detailsResponse.json() as any;
        const detailsPerfData = endPerformanceTracking(detailsPerf);
        
        if (detailsData.status === "OK" && detailsData.result) {
          diagnostics.tests.placeDetails.success = true;
          logWithCorrelation('info', correlation, 'Place Details API test successful', {
            status: detailsData.status,
            placeName: detailsData.result?.name,
            duration: detailsPerfData?.duration || 0
          });
        } else {
          diagnostics.tests.placeDetails.error = `API returned status: ${detailsData.status}`;
          logWithCorrelation('error', correlation, 'Place Details API test failed', {
            status: detailsData.status,
            errorMessage: detailsData.error_message
          });
        }
        
        diagnostics.tests.placeDetails.duration = detailsPerfData?.duration || 0;
      } catch (error) {
        diagnostics.tests.placeDetails.error = error instanceof Error ? error.message : 'Unknown error';
        logWithCorrelation('error', correlation, 'Place Details API test error', {}, error as Error);
      }
    } else {
      diagnostics.tests.placeDetails.error = 'Skipped due to places search failure';
      logWithCorrelation('warn', correlation, 'Skipping Place Details test due to places search failure');
    }

    // Test 4: Autocomplete API
    try {
      logWithCorrelation('info', correlation, 'Testing Autocomplete API');
      const autocompletePerf = startPerformanceTracking();
      
      const autocompleteUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}/place/autocomplete/json?input=New+York&key=${apiKey}`;
      
      const autocompleteResponse = await withTimeout(
        fetch(autocompleteUrl),
        15000,
        correlation,
        'autocomplete test'
      );
      
      const autocompleteData = await autocompleteResponse.json() as any;
      const autocompletePerfData = endPerformanceTracking(autocompletePerf);
      
      if (autocompleteData.status === "OK" || autocompleteData.status === "ZERO_RESULTS") {
        diagnostics.tests.autocomplete.success = true;
        logWithCorrelation('info', correlation, 'Autocomplete API test successful', {
          status: autocompleteData.status,
          predictionsCount: autocompleteData.predictions?.length || 0,
          duration: autocompletePerfData?.duration || 0
        });
      } else {
        diagnostics.tests.autocomplete.error = `API returned status: ${autocompleteData.status}`;
        logWithCorrelation('error', correlation, 'Autocomplete API test failed', {
          status: autocompleteData.status,
          errorMessage: autocompleteData.error_message
        });
      }
      
      diagnostics.tests.autocomplete.duration = autocompletePerfData?.duration || 0;
    } catch (error) {
      diagnostics.tests.autocomplete.error = error instanceof Error ? error.message : 'Unknown error';
      logWithCorrelation('error', correlation, 'Autocomplete API test error', {}, error as Error);
    }

    // Calculate overall success
    const successfulTests = Object.values(diagnostics.tests).filter(test => test.success).length;
    const totalTests = Object.keys(diagnostics.tests).length;
    const overallSuccess = successfulTests === totalTests;
    
    const summary = {
      ...diagnostics,
      overallSuccess,
      successfulTests,
      totalTests,
      successRate: Math.round((successfulTests / totalTests) * 100),
    };
    
    logWithCorrelation('info', correlation, 'Google Maps API diagnostics completed', {
      overallSuccess,
      successRate: summary.successRate,
      successfulTests,
      totalTests
    });
    
    return summary;
  },
});

// Test a specific location for search functionality
export const testLocationSearch = action({
  args: {
    location: v.string(),
    radius: v.optional(v.number()),
    keyword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'diagnostics', test: 'location_search', location: args.location } }
    );
    
    logWithCorrelation('info', correlation, 'Starting location search diagnostics', {
      location: args.location,
      radius: args.radius || 5000,
      keyword: args.keyword || 'business'
    });
    
    const user = await getCurrentUser(ctx);
    if (!user) {
      logWithCorrelation('error', correlation, 'Authentication required for location search test');
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }
    
    correlation.userId = user._id;
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not configured');
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }
    
    const testResults = {
      location: args.location,
      geocoding: { success: false, coordinates: null as { lat: number; lng: number } | null, error: null as string | null },
      placesSearch: { success: false, resultsCount: 0, sampleResults: [] as any[], error: null as string | null },
      performance: { geocodingTime: 0, placesSearchTime: 0, totalTime: 0 },
    };
    
    const overallPerf = startPerformanceTracking();
    
    try {
      // Step 1: Geocode the location
      logWithCorrelation('info', correlation, 'Testing geocoding for location');
      const geocodingPerf = startPerformanceTracking();
      
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=${encodeURIComponent(args.location)}&key=${apiKey}`;
      const geocodeResponse = await withTimeout(
        fetch(geocodeUrl),
        15000,
        correlation,
        'location geocoding test'
      );
      
      const geocodeData = await geocodeResponse.json() as any;
      const geocodingPerfData = endPerformanceTracking(geocodingPerf);
      testResults.performance.geocodingTime = geocodingPerfData?.duration || 0;
      
      if (geocodeData.status === "OK" && geocodeData.results?.length > 0) {
        const location = geocodeData.results[0].geometry.location;
        testResults.geocoding.success = true;
        testResults.geocoding.coordinates = { lat: location.lat, lng: location.lng };
        
        logWithCorrelation('info', correlation, 'Location geocoding successful', {
          coordinates: testResults.geocoding.coordinates,
          formattedAddress: geocodeData.results[0].formatted_address,
          duration: testResults.performance.geocodingTime
        });
        
        // Step 2: Search for places near the location
        logWithCorrelation('info', correlation, 'Testing places search near location');
        const placesPerf = startPerformanceTracking();
        
        const radius = args.radius || 5000;
        const keyword = args.keyword || 'business';
        const placesUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACES_SEARCH}?location=${location.lat},${location.lng}&radius=${radius}&keyword=${keyword}&key=${apiKey}`;
        
        const placesResponse = await withTimeout(
          fetch(placesUrl),
          30000,
          correlation,
          'location places search test'
        );
        
        const placesData = await placesResponse.json() as any;
        const placesPerfData = endPerformanceTracking(placesPerf);
        testResults.performance.placesSearchTime = placesPerfData?.duration || 0;
        
        if (placesData.status === "OK" && placesData.results) {
          testResults.placesSearch.success = true;
          testResults.placesSearch.resultsCount = placesData.results.length;
          testResults.placesSearch.sampleResults = placesData.results.slice(0, 5).map((place: any) => ({
            name: place.name,
            types: place.types,
            rating: place.rating,
            vicinity: place.vicinity,
          }));
          
          logWithCorrelation('info', correlation, 'Places search successful', {
            resultsCount: testResults.placesSearch.resultsCount,
            samplePlaces: testResults.placesSearch.sampleResults.map(p => p.name),
            duration: testResults.performance.placesSearchTime
          });
        } else if (placesData.status === "ZERO_RESULTS") {
          testResults.placesSearch.success = true;
          testResults.placesSearch.resultsCount = 0;
          logWithCorrelation('info', correlation, 'Places search completed with zero results', {
            status: placesData.status
          });
        } else {
          testResults.placesSearch.error = `Places API returned status: ${placesData.status}`;
          logWithCorrelation('error', correlation, 'Places search failed', {
            status: placesData.status,
            errorMessage: placesData.error_message
          });
        }
      } else {
        testResults.geocoding.error = `Geocoding API returned status: ${geocodeData.status}`;
        logWithCorrelation('error', correlation, 'Location geocoding failed', {
          status: geocodeData.status,
          errorMessage: geocodeData.error_message
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (!testResults.geocoding.success) {
        testResults.geocoding.error = errorMessage;
      } else {
        testResults.placesSearch.error = errorMessage;
      }
      logWithCorrelation('error', correlation, 'Location search test failed', {}, error as Error);
    }
    
    const overallPerfData = endPerformanceTracking(overallPerf);
    testResults.performance.totalTime = overallPerfData?.duration || 0;
    
    const success = testResults.geocoding.success && testResults.placesSearch.success;
    
    logWithCorrelation('info', correlation, 'Location search diagnostics completed', {
      success,
      geocodingSuccess: testResults.geocoding.success,
      placesSearchSuccess: testResults.placesSearch.success,
      totalResults: testResults.placesSearch.resultsCount,
      totalDuration: testResults.performance.totalTime
    });
    
    return testResults;
  },
});

// Get Google Maps API quota and usage information
export const getAPIQuotaInfo = action({
  args: {},
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'diagnostics', test: 'quota_check' } }
    );
    
    logWithCorrelation('info', correlation, 'Checking Google Maps API quota information');
    
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }
    
    correlation.userId = user._id;
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }
    
    // Note: Google Maps API doesn't provide a direct quota endpoint,
    // but we can make a test call and check response headers
    try {
      const testUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=test&key=${apiKey}`;
      const response = await fetch(testUrl);
      
      // Extract useful headers if available
      const quotaInfo = {
        responseStatus: response.status,
        responseStatusText: response.statusText,
        headers: {
          // Common quota-related headers (may not always be present)
          rateLimitRemaining: response.headers.get('X-RateLimit-Remaining'),
          rateLimitReset: response.headers.get('X-RateLimit-Reset'),
          quotaUser: response.headers.get('X-Quota-User'),
        },
        recommendations: [
          'Monitor API usage in Google Cloud Console',
          'Set up billing alerts for quota monitoring',
          'Consider implementing request caching for frequently accessed data',
          'Use appropriate API methods for your use case (e.g., Places API vs Geocoding API)',
        ],
        googleCloudConsoleUrl: 'https://console.cloud.google.com/apis/api/maps-platform.googleapis.com',
      };
      
      logWithCorrelation('info', correlation, 'API quota check completed', {
        responseStatus: quotaInfo.responseStatus,
        hasRateLimitHeaders: !!(quotaInfo.headers.rateLimitRemaining || quotaInfo.headers.rateLimitReset)
      });
      
      return quotaInfo;
    } catch (error) {
      logWithCorrelation('error', correlation, 'API quota check failed', {}, error as Error);
      throw createError(
        "Failed to check API quota information",
        ERROR_CODES.GOOGLE_MAPS_ERROR,
        500
      );
    }
  },
});