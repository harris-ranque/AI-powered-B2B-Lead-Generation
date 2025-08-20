/**
 * Simple Google Maps API Test (No Authentication Required)
 * 
 * This function tests the Google Maps API without requiring user authentication,
 * making it suitable for running via Convex CLI for debugging purposes.
 */

import { internalAction } from "../_generated/server";
import { API_CONFIG } from "../lib/constants";
import { 
  createCorrelationContext, 
  logWithCorrelation, 
  OPERATION_TYPES,
  startPerformanceTracking,
  endPerformanceTracking,
  withTimeout
} from "../lib/correlation";

export const testGoogleMapsAPISimple = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'simple_test', test: 'api_connectivity' } }
    );
    
    logWithCorrelation('info', correlation, 'Starting simple Google Maps API test (no auth required)');
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not found in environment');
      return {
        success: false,
        error: 'Google Maps API key not configured',
        tests: {}
      };
    }
    
    logWithCorrelation('info', correlation, 'Google Maps API key found', {
      keyLength: apiKey.length,
      keyPrefix: apiKey.substring(0, 8) + '...'
    });
    
    const testResults = {
      success: false,
      apiKeyConfigured: true,
      apiKeyLength: apiKey.length,
      tests: {
        geocoding: { success: false, duration: 0, error: null as string | null, response: null as any },
        placesSearch: { success: false, duration: 0, error: null as string | null, response: null as any },
      },
      summary: {
        totalTests: 2,
        successfulTests: 0,
        successRate: 0,
      }
    };
    
    // Test 1: Simple Geocoding
    try {
      logWithCorrelation('info', correlation, 'Testing Geocoding API with New York, NY');
      const geocodingPerf = startPerformanceTracking();
      
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=New+York+NY&key=${apiKey}`;
      logWithCorrelation('debug', correlation, 'Geocoding request URL constructed', {
        url: geocodeUrl.replace(apiKey, '[REDACTED]')
      });
      
      const geocodeResponse = await withTimeout(
        fetch(geocodeUrl),
        15000,
        correlation,
        'geocoding test'
      );
      
      const geocodeData = await geocodeResponse.json() as any;
      const geocodingPerfData = endPerformanceTracking(geocodingPerf);
      
      testResults.tests.geocoding.duration = geocodingPerfData?.duration || 0;
      testResults.tests.geocoding.response = {
        status: geocodeData.status,
        resultsCount: geocodeData.results?.length || 0,
        errorMessage: geocodeData.error_message || null,
        responseStatus: geocodeResponse.status,
      };
      
      if (geocodeResponse.ok && geocodeData.status === "OK" && geocodeData.results?.length > 0) {
        testResults.tests.geocoding.success = true;
        logWithCorrelation('info', correlation, 'Geocoding test SUCCESSFUL', {
          status: geocodeData.status,
          resultsCount: geocodeData.results.length,
          firstResult: geocodeData.results[0].formatted_address,
          coordinates: geocodeData.results[0].geometry.location,
          duration: testResults.tests.geocoding.duration
        });
      } else {
        testResults.tests.geocoding.error = `HTTP ${geocodeResponse.status}: ${geocodeData.status} - ${geocodeData.error_message || 'No error message'}`;
        logWithCorrelation('error', correlation, 'Geocoding test FAILED', {
          httpStatus: geocodeResponse.status,
          apiStatus: geocodeData.status,
          errorMessage: geocodeData.error_message,
          resultsCount: geocodeData.results?.length || 0
        });
      }
    } catch (error) {
      testResults.tests.geocoding.error = error instanceof Error ? error.message : 'Unknown error';
      logWithCorrelation('error', correlation, 'Geocoding test ERROR', {}, error as Error);
    }

    // Test 2: Places Search (only if geocoding worked)
    if (testResults.tests.geocoding.success) {
      try {
        logWithCorrelation('info', correlation, 'Testing Places Search API in Manhattan');
        const placesPerf = startPerformanceTracking();
        
        // Manhattan coordinates: 40.7829, -73.9654
        const placesUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACES_SEARCH}?location=40.7829,-73.9654&radius=1000&keyword=restaurant&key=${apiKey}`;
        logWithCorrelation('debug', correlation, 'Places search request URL constructed', {
          url: placesUrl.replace(apiKey, '[REDACTED]')
        });
        
        const placesResponse = await withTimeout(
          fetch(placesUrl),
          20000,
          correlation,
          'places search test'
        );
        
        const placesData = await placesResponse.json() as any;
        const placesPerfData = endPerformanceTracking(placesPerf);
        
        testResults.tests.placesSearch.duration = placesPerfData?.duration || 0;
        testResults.tests.placesSearch.response = {
          status: placesData.status,
          resultsCount: placesData.results?.length || 0,
          errorMessage: placesData.error_message || null,
          responseStatus: placesResponse.status,
          nextPageToken: !!placesData.next_page_token,
        };
        
        if (placesResponse.ok && (placesData.status === "OK" || placesData.status === "ZERO_RESULTS")) {
          testResults.tests.placesSearch.success = true;
          logWithCorrelation('info', correlation, 'Places search test SUCCESSFUL', {
            status: placesData.status,
            resultsCount: placesData.results?.length || 0,
            hasNextPageToken: !!placesData.next_page_token,
            duration: testResults.tests.placesSearch.duration,
            samplePlaces: placesData.results?.slice(0, 3).map((p: any) => p.name) || []
          });
        } else {
          testResults.tests.placesSearch.error = `HTTP ${placesResponse.status}: ${placesData.status} - ${placesData.error_message || 'No error message'}`;
          logWithCorrelation('error', correlation, 'Places search test FAILED', {
            httpStatus: placesResponse.status,
            apiStatus: placesData.status,
            errorMessage: placesData.error_message
          });
        }
      } catch (error) {
        testResults.tests.placesSearch.error = error instanceof Error ? error.message : 'Unknown error';
        logWithCorrelation('error', correlation, 'Places search test ERROR', {}, error as Error);
      }
    } else {
      testResults.tests.placesSearch.error = 'Skipped due to geocoding failure';
      logWithCorrelation('warn', correlation, 'Skipping Places Search test due to geocoding failure');
    }
    
    // Calculate summary
    testResults.summary.successfulTests = Object.values(testResults.tests).filter(test => test.success).length;
    testResults.summary.successRate = Math.round((testResults.summary.successfulTests / testResults.summary.totalTests) * 100);
    testResults.success = testResults.summary.successfulTests === testResults.summary.totalTests;
    
    logWithCorrelation('info', correlation, 'Google Maps API test completed', {
      overallSuccess: testResults.success,
      successRate: testResults.summary.successRate,
      successfulTests: testResults.summary.successfulTests,
      totalTests: testResults.summary.totalTests,
      geocodingSuccess: testResults.tests.geocoding.success,
      placesSearchSuccess: testResults.tests.placesSearch.success
    });
    
    return testResults;
  },
});

export const testSpecificLocation = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'location_test', location: 'San Francisco, CA' } }
    );
    
    logWithCorrelation('info', correlation, 'Testing specific location: San Francisco, CA');
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not configured');
      return { success: false, error: 'API key not configured' };
    }
    
    const testLocation = "San Francisco, CA";
    const testKeyword = "coffee shop";
    const testRadius = 5000;
    
    const results = {
      location: testLocation,
      keyword: testKeyword,
      radius: testRadius,
      geocoding: { success: false, coordinates: null as any, duration: 0, error: null as string | null },
      placesSearch: { success: false, resultsCount: 0, sampleResults: [] as any[], duration: 0, error: null as string | null },
      overallSuccess: false,
    };
    
    try {
      // Step 1: Geocode San Francisco
      logWithCorrelation('info', correlation, 'Geocoding San Francisco, CA');
      const geocodingPerf = startPerformanceTracking();
      
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=${encodeURIComponent(testLocation)}&key=${apiKey}`;
      const geocodeResponse = await fetch(geocodeUrl);
      const geocodeData = await geocodeResponse.json() as any;
      
      const geocodingPerfData = endPerformanceTracking(geocodingPerf);
      results.geocoding.duration = geocodingPerfData?.duration || 0;
      
      if (geocodeData.status === "OK" && geocodeData.results?.length > 0) {
        const location = geocodeData.results[0].geometry.location;
        results.geocoding.success = true;
        results.geocoding.coordinates = { lat: location.lat, lng: location.lng };
        
        logWithCorrelation('info', correlation, 'Geocoding successful', {
          formattedAddress: geocodeData.results[0].formatted_address,
          coordinates: results.geocoding.coordinates
        });
        
        // Step 2: Search for coffee shops
        logWithCorrelation('info', correlation, 'Searching for coffee shops in San Francisco');
        const placesPerf = startPerformanceTracking();
        
        const placesUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACES_SEARCH}?location=${location.lat},${location.lng}&radius=${testRadius}&keyword=${encodeURIComponent(testKeyword)}&key=${apiKey}`;
        const placesResponse = await fetch(placesUrl);
        const placesData = await placesResponse.json() as any;
        
        const placesPerfData = endPerformanceTracking(placesPerf);
        results.placesSearch.duration = placesPerfData?.duration || 0;
        
        if (placesData.status === "OK" && placesData.results) {
          results.placesSearch.success = true;
          results.placesSearch.resultsCount = placesData.results.length;
          results.placesSearch.sampleResults = placesData.results.slice(0, 5).map((place: any) => ({
            name: place.name,
            rating: place.rating,
            vicinity: place.vicinity,
            types: place.types,
          }));
          
          logWithCorrelation('info', correlation, 'Places search successful', {
            resultsFound: results.placesSearch.resultsCount,
            topPlaces: results.placesSearch.sampleResults.map(p => `${p.name} (${p.rating}★)`)
          });
        } else if (placesData.status === "ZERO_RESULTS") {
          results.placesSearch.success = true;
          results.placesSearch.resultsCount = 0;
          logWithCorrelation('info', correlation, 'Places search returned zero results');
        } else {
          results.placesSearch.error = `Places API error: ${placesData.status}`;
          logWithCorrelation('error', correlation, 'Places search failed', {
            status: placesData.status,
            errorMessage: placesData.error_message
          });
        }
      } else {
        results.geocoding.error = `Geocoding failed: ${geocodeData.status}`;
        logWithCorrelation('error', correlation, 'Geocoding failed', {
          status: geocodeData.status,
          errorMessage: geocodeData.error_message
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (!results.geocoding.success) {
        results.geocoding.error = errorMessage;
      } else {
        results.placesSearch.error = errorMessage;
      }
      logWithCorrelation('error', correlation, 'Location test failed', {}, error as Error);
    }
    
    results.overallSuccess = results.geocoding.success && results.placesSearch.success;
    
    logWithCorrelation('info', correlation, 'Location test completed', {
      overallSuccess: results.overallSuccess,
      geocodingSuccess: results.geocoding.success,
      placesFound: results.placesSearch.resultsCount
    });
    
    return results;
  },
});