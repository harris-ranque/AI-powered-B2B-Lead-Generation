import { action } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../auth";
import { API_CONFIG, ERROR_CODES, BUSINESS_RULES } from "../lib/constants";
import { createError, retryApiCall } from "../lib/helpers";
import { internal } from "../_generated/api";
import { 
  createCorrelationContext, 
  createChildContext, 
  logWithCorrelation, 
  OPERATION_TYPES,
  startPerformanceTracking,
  endPerformanceTracking,
  withTimeout
} from "../lib/correlation";

// Google Maps Places API integration
export const searchGoogleMaps: any = action({
  args: {
    searchId: v.id("searches"),
    location: v.string(),
    radius: v.number(),
    keywords: v.array(v.string()),
    industries: v.optional(v.array(v.string())),
    maxResults: v.optional(v.number()),
    pageToken: v.optional(v.string()),
    // Optional userId for internal calls that don't have authentication context
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Create correlation context for this Google Maps search operation
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY, 
      "system", // Will be updated once we get the user
      { 
        searchId: args.searchId,
        metadata: { 
          location: args.location, 
          radius: args.radius, 
          keywordsCount: args.keywords.length,
          maxResults: args.maxResults || API_CONFIG.GOOGLE_MAPS.MAX_RESULTS_PER_REQUEST
        } 
      }
    );
    
    logWithCorrelation('info', correlation, 'Starting Google Maps search operation');
    const overallPerf = startPerformanceTracking();
    
    let user;
    
    // For internal calls, get user from search record; for external calls, get from auth context
    if (args.userId) {
      // Internal call - get search first and use its userId
      const search = await ctx.runQuery(internal.search.internal.getSearchById, {
        searchId: args.searchId,
      });
      
      if (!search) {
        logWithCorrelation('error', correlation, 'Search not found for internal call', { searchId: args.searchId });
        throw createError("Search not found", ERROR_CODES.FORBIDDEN, 403);
      }
      
      // Verify the provided userId matches the search owner
      if (args.userId !== search.userId) {
        logWithCorrelation('error', correlation, 'User ID mismatch for internal call', { providedUserId: args.userId, searchUserId: search.userId });
        throw createError("User ID mismatch", ERROR_CODES.FORBIDDEN, 403);
      }
      
      // For internal calls, create a minimal user object with the ID we need
      user = { _id: search.userId } as any;
      logWithCorrelation('debug', correlation, 'Internal call authenticated successfully', { userId: user._id });
    } else {
      // External call - get user from authentication context
      user = await getCurrentUser(ctx);
      
      if (!user) {
        logWithCorrelation('error', correlation, 'Authentication failed - no user found');
        throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
      }
      
      logWithCorrelation('debug', correlation, 'External call authenticated successfully', { userId: user._id });
    }
    
    // Update correlation context with actual user ID
    correlation.userId = user._id;

    // Verify search exists and user owns it
    const search = await ctx.runQuery(internal.search.internal.getSearchForProcessing, {
      searchId: args.searchId,
      userId: user._id,
    });

    if (!search) {
      logWithCorrelation('error', correlation, 'Search not found or access denied', { searchId: args.searchId, userId: user._id });
      throw createError("Search not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }
    
    logWithCorrelation('debug', correlation, 'Search validation successful', { searchStatus: search.status });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not configured in environment');
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }
    
    logWithCorrelation('debug', correlation, 'Google Maps API key validation successful');

    try {
      // First, geocode the location to get coordinates
      const geocodeCorrelation = createChildContext(correlation, OPERATION_TYPES.GOOGLE_MAPS_API, {
        metadata: { operation: 'geocoding', address: args.location }
      });
      
      logWithCorrelation('info', geocodeCorrelation, 'Starting geocoding operation');
      const geocodePerf = startPerformanceTracking();
      
      let lat: number, lng: number;
      
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=${encodeURIComponent(args.location)}&key=${apiKey}`;
      logWithCorrelation('debug', geocodeCorrelation, 'Geocoding API URL constructed', { url: geocodeUrl.replace(apiKey, '[REDACTED]') });
      
      const geocodeResponse = await withTimeout(
        fetch(geocodeUrl),
        15000, // 15 second timeout
        geocodeCorrelation,
        'geocoding API call'
      );
      
      const geocodePerfData = endPerformanceTracking(geocodePerf);
      logWithCorrelation('debug', geocodeCorrelation, 'Geocoding API response received', { 
        status: geocodeResponse.status,
        statusText: geocodeResponse.statusText,
        duration: geocodePerfData?.duration || 0 
      });
      
      const geocodeData = await geocodeResponse.json() as any;
      logWithCorrelation('debug', geocodeCorrelation, 'Geocoding response parsed', { 
        status: geocodeData.status,
        resultsCount: geocodeData.results?.length || 0 
      });
      
      if (geocodeData.status !== "OK" || !geocodeData.results.length) {
        logWithCorrelation('error', geocodeCorrelation, 'Geocoding failed', { 
          status: geocodeData.status,
          errorMessage: geocodeData.error_message,
          location: args.location 
        });
        throw createError(
          `Location "${args.location}" not found`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }
      
      const locationData = geocodeData.results[0] as any;
      lat = locationData.geometry.location.lat;
      lng = locationData.geometry.location.lng;
      
      logWithCorrelation('info', geocodeCorrelation, 'Geocoding completed successfully', { 
        coordinates: { lat, lng },
        formattedAddress: locationData.formatted_address,
        duration: geocodePerfData?.duration || 0 
      });

      // Search for places using the first keyword as the primary type
      const placesCorrelation = createChildContext(correlation, OPERATION_TYPES.GOOGLE_MAPS_API, {
        metadata: { operation: 'places_search', keywords: args.keywords, radius: args.radius }
      });
      
      logWithCorrelation('info', placesCorrelation, 'Starting places search operation');
      const placesPerf = startPerformanceTracking();
      
      const keyword = args.keywords[0];
      let searchUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACES_SEARCH}`;
      
      const baseParams: Record<string, string> = {
        location: `${lat},${lng}`,
        radius: args.radius.toString(),
        key: apiKey,
      };
      
      if (keyword) {
        baseParams.keyword = keyword;
        logWithCorrelation('debug', placesCorrelation, 'Primary keyword set', { keyword });
      }
      
      const params = new URLSearchParams(baseParams);

      if (args.pageToken) {
        params.append("pagetoken", args.pageToken);
        logWithCorrelation('debug', placesCorrelation, 'Page token included for pagination', { pageToken: args.pageToken });
      }

      searchUrl += "?" + params.toString();
      logWithCorrelation('debug', placesCorrelation, 'Places search URL constructed', { 
        url: searchUrl.replace(apiKey, '[REDACTED]'),
        coordinates: { lat, lng },
        radius: args.radius
      });

      const placesResponse = await retryApiCall(async () => {
        logWithCorrelation('debug', placesCorrelation, 'Making places search API call');
        const response = await withTimeout(
          fetch(searchUrl),
          30000, // 30 second timeout for places search
          placesCorrelation,
          'places search API call'
        );
        
        if (!response.ok) {
          logWithCorrelation('error', placesCorrelation, 'Places search API call failed', { 
            status: response.status,
            statusText: response.statusText 
          });
          throw new Error(`Google Maps API error: ${response.status}`);
        }
        
        const responseData = await response.json() as any;
        logWithCorrelation('debug', placesCorrelation, 'Places search API response received', { 
          status: responseData.status,
          resultsCount: responseData.results?.length || 0,
          hasNextPageToken: !!responseData.next_page_token 
        });
        
        return responseData;
      });
      
      const placesPerfData = endPerformanceTracking(placesPerf);
      logWithCorrelation('info', placesCorrelation, 'Places search API call completed', { 
        duration: placesPerfData?.duration || 0,
        status: placesResponse.status 
      });

      if (placesResponse.status === "ZERO_RESULTS") {
        logWithCorrelation('info', placesCorrelation, 'Places search returned zero results', { 
          location: args.location,
          keywords: args.keywords,
          radius: args.radius 
        });
        
        // Update search progress to indicate no results found
        logWithCorrelation('debug', correlation, 'Updating search progress for zero results');
        await ctx.runMutation(internal.search.internal.updateSearchProgress, {
          searchId: args.searchId,
          discovered: search.progress.discovered,
          totalFound: search.results.totalFound,
        });
        
        // Complete search with zero results using dedicated function
        logWithCorrelation('info', correlation, 'Completing search using dedicated zero results handler');
        await ctx.runMutation(internal.search.orchestrator.completeSearchWithZeroResults, {
          searchId: args.searchId,
          location: args.location,
          keywords: args.keywords,
          radius: args.radius,
        });
        
        const overallPerfData = endPerformanceTracking(overallPerf);
        const result = {
          results: [],
          nextPageToken: null,
          totalResults: 0,
          location: {
            lat,
            lng,
            formattedAddress: locationData.formatted_address,
          },
        };
        
        logWithCorrelation('info', correlation, 'Google Maps search operation completed with zero results', {
          totalResults: 0,
          hasNextPageToken: false,
          location: result.location,
          totalDuration: overallPerfData?.duration || 0
        });
        
        return result;
      }

      if (placesResponse.status !== "OK") {
        logWithCorrelation('error', placesCorrelation, 'Places search failed with API error', { 
          status: placesResponse.status,
          errorMessage: placesResponse.error_message 
        });
        throw createError(
          `Google Maps API error: ${placesResponse.status}`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }

      const places = (placesResponse.results || []) as any[];
      logWithCorrelation('debug', correlation, 'Raw places results received', { 
        totalPlaces: places.length,
        firstPlaceName: places[0]?.name,
        placeTypes: places.slice(0, 3).map(p => p.types?.[0]).filter(Boolean) 
      });
      
      // Filter results based on additional keywords
      const filteredPlaces = places.filter((place: any) => {
        if (args.keywords.length <= 1) return true;
        
        const searchText = `${place.name} ${place.types?.join(" ")} ${place.vicinity || ""}`.toLowerCase();
        
        return args.keywords.slice(1).some(keyword => 
          searchText.includes(keyword.toLowerCase())
        );
      });
      
      logWithCorrelation('info', correlation, 'Places filtering completed', { 
        originalCount: places.length,
        filteredCount: filteredPlaces.length,
        filtersApplied: args.keywords.length > 1,
        additionalKeywords: args.keywords.slice(1) 
      });

      // Process each place and store as leads
      const processedLeads = [];
      logWithCorrelation('info', correlation, 'Starting place details processing');
      
      for (const [index, place] of filteredPlaces.entries()) {
        const placeDetailCorrelation = createChildContext(correlation, OPERATION_TYPES.GOOGLE_MAPS_API, {
          metadata: { 
            operation: 'place_details', 
            placeId: place.place_id,
            placeName: place.name,
            placeIndex: index + 1,
            totalPlaces: filteredPlaces.length 
          }
        });
        
        logWithCorrelation('debug', placeDetailCorrelation, 'Processing place details', { 
          placeName: place.name,
          placeId: place.place_id,
          progress: `${index + 1}/${filteredPlaces.length}` 
        });
        
        try {
          const detailsPerf = startPerformanceTracking();
          
          // Get additional place details
          const detailsUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACE_DETAILS}?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,types,geometry&key=${apiKey}`;
          
          const detailsResponse = await withTimeout(
            fetch(detailsUrl),
            10000, // 10 second timeout for place details
            placeDetailCorrelation,
            'place details API call'
          );
          
          const detailsData = await detailsResponse.json() as any;
          const detailsPerfData = endPerformanceTracking(detailsPerf);
          
          logWithCorrelation('debug', placeDetailCorrelation, 'Place details API response received', { 
            status: detailsData.status,
            hasResult: !!detailsData.result,
            duration: detailsPerfData?.duration || 0 
          });
          
          if (detailsData.status === "OK" && detailsData.result) {
            const details = detailsData.result as any;
            
            logWithCorrelation('debug', placeDetailCorrelation, 'Place details successfully retrieved', { 
              hasPhone: !!details.formatted_phone_number,
              hasWebsite: !!details.website,
              hasRating: !!details.rating,
              reviewCount: details.user_ratings_total || 0,
              primaryType: details.types?.[0] 
            });
            
            // Create lead data
            const leadData = {
              searchId: args.searchId,
              businessName: details.name,
              address: details.formatted_address,
              phone: details.formatted_phone_number,
              website: details.website,
              rating: details.rating,
              reviewCount: details.user_ratings_total,
              category: details.types?.[0],
              placeId: place.place_id,
              location: {
                lat: details.geometry.location.lat,
                lng: details.geometry.location.lng,
                formattedAddress: details.formatted_address,
                city: "", // Will be parsed from address
                state: "", // Will be parsed from address
                country: "", // Will be parsed from address
                postalCode: "", // Will be parsed from address
              },
            };

            // Parse address components
            if (place.address_components) {
              for (const component of place.address_components) {
                if (component.types.includes("locality")) {
                  leadData.location.city = component.long_name;
                }
                if (component.types.includes("administrative_area_level_1")) {
                  leadData.location.state = component.short_name;
                }
                if (component.types.includes("country")) {
                  leadData.location.country = component.short_name;
                }
                if (component.types.includes("postal_code")) {
                  leadData.location.postalCode = component.long_name;
                }
              }
            }

            // Store lead in database
            logWithCorrelation('debug', placeDetailCorrelation, 'Storing lead in database');
            const leadCreatePerf = startPerformanceTracking();
            
            const leadId: any = await ctx.runMutation(internal.leads.internal.createLeadFromSearch, {
              userId: user._id,
              ...leadData,
            });
            
            const leadCreatePerfData = endPerformanceTracking(leadCreatePerf);
            logWithCorrelation('info', placeDetailCorrelation, 'Lead successfully created', { 
              leadId,
              businessName: leadData.businessName,
              duration: leadCreatePerfData?.duration || 0 
            });

            processedLeads.push({
              leadId,
              businessName: leadData.businessName,
              placeId: leadData.placeId,
            });

          } else {
            logWithCorrelation('warn', placeDetailCorrelation, 'Place details API returned non-OK status', { 
              status: detailsData.status,
              errorMessage: detailsData.error_message 
            });

          }
        } catch (error) {
          logWithCorrelation('error', placeDetailCorrelation, 'Failed to process place details', {
            placeId: place.place_id,
            placeName: place.name
          }, error as Error);
          // Continue with other places even if one fails
        }
      }

      logWithCorrelation('info', correlation, 'Place processing completed', { 
        totalProcessed: processedLeads.length,
        successfulLeads: processedLeads.length,
        failedPlaces: filteredPlaces.length - processedLeads.length 
      });
      
      // Update search progress
      logWithCorrelation('debug', correlation, 'Updating search progress in database');
      await ctx.runMutation(internal.search.internal.updateSearchProgress, {
        searchId: args.searchId,
        discovered: search.progress.discovered + processedLeads.length,
        totalFound: search.results.totalFound + processedLeads.length,
      });

      // Trigger orchestrator to continue pipeline
      if (processedLeads.length > 0) {
        logWithCorrelation('info', correlation, 'Triggering search orchestrator to continue pipeline');
        await ctx.runMutation(internal.search.orchestrator.orchestrateSearchPipeline, {
          searchId: args.searchId,
        });
      } else {
        logWithCorrelation('warn', correlation, 'No leads processed, pipeline orchestrator not triggered');
      }

      const overallPerfData = endPerformanceTracking(overallPerf);
      const result = {
        results: processedLeads,
        nextPageToken: placesResponse.next_page_token || null,
        totalResults: processedLeads.length,
        location: {
          lat,
          lng,
          formattedAddress: locationData.formatted_address,
        },
      };
      
      logWithCorrelation('info', correlation, 'Google Maps search operation completed successfully', {
        totalResults: processedLeads.length,
        hasNextPageToken: !!result.nextPageToken,
        location: result.location,
        totalDuration: overallPerfData?.duration || 0
      });
      
      return result;

    } catch (error) {
      const overallPerfData = endPerformanceTracking(overallPerf);
      logWithCorrelation('error', correlation, 'Google Maps search operation failed', {
        duration: overallPerfData?.duration || 0,
        searchId: args.searchId
      }, error as Error);
      
      // Update search status to failed
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw createError(
        "Failed to search Google Maps",
        ERROR_CODES.GOOGLE_MAPS_ERROR,
        500
      );
    }
  },
});

// Geocode address to coordinates
export const geocodeAddress = action({
  args: { 
    address: v.string(),
    userId: v.optional(v.id("users")), // Optional userId for internal calls
  },
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'geocoding', address: args.address } }
    );
    
    logWithCorrelation('info', correlation, 'Starting standalone geocoding operation');
    const perf = startPerformanceTracking();
    
    let user;
    
    // Handle internal vs external calls
    if (args.userId) {
      // Internal call - create minimal user object
      user = { _id: args.userId } as any;
      logWithCorrelation('debug', correlation, 'Internal call authenticated for geocoding', { userId: user._id });
    } else {
      // External call - get user from authentication context
      user = await getCurrentUser(ctx);

      if (!user) {
        logWithCorrelation('error', correlation, 'Authentication failed for geocoding operation');
        throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
      }
      
      logWithCorrelation('debug', correlation, 'External call authenticated for geocoding', { userId: user._id });
    }
    
    correlation.userId = user._id;

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not configured');
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=${encodeURIComponent(args.address)}&key=${apiKey}`;
      logWithCorrelation('debug', correlation, 'Geocoding URL constructed', { 
        url: geocodeUrl.replace(apiKey, '[REDACTED]') 
      });
      
      const response = await withTimeout(
        fetch(geocodeUrl),
        15000, // 15 second timeout
        correlation,
        'geocoding API call'
      );
      
      logWithCorrelation('debug', correlation, 'Geocoding API response received', { 
        status: response.status,
        statusText: response.statusText 
      });
      
      const data = await response.json() as any;
      logWithCorrelation('debug', correlation, 'Geocoding response parsed', { 
        status: data.status,
        resultsCount: data.results?.length || 0 
      });
      
      if (data.status !== "OK" || !data.results.length) {
        logWithCorrelation('error', correlation, 'Geocoding failed', { 
          status: data.status,
          errorMessage: data.error_message,
          address: args.address 
        });
        throw createError(
          `Address "${args.address}" not found`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }
      
      const result = data.results[0] as any;
      const perfData = endPerformanceTracking(perf);
      
      const returnData = {
        formattedAddress: result.formatted_address,
        location: {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
        },
        addressComponents: result.address_components,
        placeId: result.place_id,
      };
      
      logWithCorrelation('info', correlation, 'Geocoding completed successfully', {
        formattedAddress: result.formatted_address,
        coordinates: returnData.location,
        duration: perfData?.duration || 0
      });
      
      return returnData;

    } catch (error) {
      const perfData = endPerformanceTracking(perf);
      logWithCorrelation('error', correlation, 'Geocoding operation failed', {
        duration: perfData?.duration || 0
      }, error as Error);
      throw createError(
        "Failed to geocode address",
        ERROR_CODES.GOOGLE_MAPS_ERROR,
        500
      );
    }
  },
});

// Get place suggestions for autocomplete
export const getPlaceSuggestions = action({
  args: {
    input: v.string(),
    types: v.optional(v.string()), // e.g., "geocode", "establishment"
    userId: v.optional(v.id("users")), // Optional userId for internal calls
  },
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'autocomplete', input: args.input, types: args.types } }
    );
    
    logWithCorrelation('info', correlation, 'Starting place autocomplete operation');
    const perf = startPerformanceTracking();
    
    let user;
    
    // Handle internal vs external calls
    if (args.userId) {
      // Internal call - create minimal user object
      user = { _id: args.userId } as any;
      logWithCorrelation('debug', correlation, 'Internal call authenticated for autocomplete', { userId: user._id });
    } else {
      // External call - get user from authentication context
      user = await getCurrentUser(ctx);

      if (!user) {
        logWithCorrelation('error', correlation, 'Authentication failed for autocomplete operation');
        throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
      }
      
      logWithCorrelation('debug', correlation, 'External call authenticated for autocomplete', { userId: user._id });
    }
    
    correlation.userId = user._id;

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      logWithCorrelation('error', correlation, 'Google Maps API key not configured');
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      const params = new URLSearchParams({
        input: args.input,
        key: apiKey,
      });

      if (args.types) {
        params.append("types", args.types);
        logWithCorrelation('debug', correlation, 'Autocomplete types filter applied', { types: args.types });
      }

      const autocompleteUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}/place/autocomplete/json?${params.toString()}`;
      logWithCorrelation('debug', correlation, 'Autocomplete URL constructed', { 
        url: autocompleteUrl.replace(apiKey, '[REDACTED]'),
        inputLength: args.input.length 
      });
      
      const response = await withTimeout(
        fetch(autocompleteUrl),
        10000, // 10 second timeout
        correlation,
        'autocomplete API call'
      );
      
      logWithCorrelation('debug', correlation, 'Autocomplete API response received', { 
        status: response.status,
        statusText: response.statusText 
      });
      
      const data = await response.json() as any;
      logWithCorrelation('debug', correlation, 'Autocomplete response parsed', { 
        status: data.status,
        predictionsCount: data.predictions?.length || 0 
      });
      
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        logWithCorrelation('error', correlation, 'Autocomplete API failed', { 
          status: data.status,
          errorMessage: data.error_message 
        });
        throw createError(
          `Autocomplete API error: ${data.status}`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }
      
      const perfData = endPerformanceTracking(perf);
      const result = {
        predictions: data.predictions || [],
        status: data.status,
      };
      
      logWithCorrelation('info', correlation, 'Autocomplete completed successfully', {
        predictionsCount: result.predictions.length,
        status: result.status,
        duration: perfData?.duration || 0
      });
      
      return result;

    } catch (error) {
      const perfData = endPerformanceTracking(perf);
      logWithCorrelation('error', correlation, 'Autocomplete operation failed', {
        duration: perfData?.duration || 0
      }, error as Error);
      throw createError(
        "Failed to get place suggestions",
        ERROR_CODES.GOOGLE_MAPS_ERROR,
        500
      );
    }
  },
});

// Validate location exists
export const validateLocation: any = action({
  args: { 
    location: v.string(),
    userId: v.optional(v.id("users")), // Optional userId for internal calls
  },
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.GOOGLE_MAPS_API,
      "system",
      { metadata: { operation: 'location_validation', location: args.location } }
    );
    
    logWithCorrelation('info', correlation, 'Starting location validation');
    const perf = startPerformanceTracking();
    
    let user;
    
    // Handle internal vs external calls
    if (args.userId) {
      // Internal call - create minimal user object
      user = { _id: args.userId } as any;
      logWithCorrelation('debug', correlation, 'Internal call authenticated for location validation', { userId: user._id });
    } else {
      // External call - get user from authentication context
      user = await getCurrentUser(ctx);

      if (!user) {
        logWithCorrelation('error', correlation, 'Authentication failed for location validation');
        throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
      }
      
      logWithCorrelation('debug', correlation, 'External call authenticated for location validation', { userId: user._id });
    }
    
    correlation.userId = user._id;

    try {
      logWithCorrelation('debug', correlation, 'Calling geocodeAddress for validation');
      const geocodeResult: any = await ctx.runAction(internal.search.actions.geocodeAddress, {
        address: args.location,
        userId: args.userId, // Pass through userId for internal calls
      });
      
      const perfData = endPerformanceTracking(perf);
      const result = {
        isValid: true,
        formattedAddress: geocodeResult.formattedAddress,
        location: geocodeResult.location,
      };
      
      logWithCorrelation('info', correlation, 'Location validation successful', {
        isValid: result.isValid,
        formattedAddress: result.formattedAddress,
        duration: perfData?.duration || 0
      });

      return result;

    } catch (error) {
      const perfData = endPerformanceTracking(perf);
      const result = {
        isValid: false,
        error: error instanceof Error ? error.message : "Invalid location",
      };
      
      logWithCorrelation('warn', correlation, 'Location validation failed', {
        isValid: result.isValid,
        error: result.error,
        duration: perfData?.duration || 0
      });
      
      return result;
    }
  },
});