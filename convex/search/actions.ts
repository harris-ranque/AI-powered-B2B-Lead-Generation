import { action } from "../_generated/server";
import { v } from "convex/values";
import { auth } from "../auth.config";
import { API_CONFIG, ERROR_CODES, BUSINESS_RULES } from "../lib/constants";
import { createError, retry } from "../lib/helpers";
import { internal } from "../_generated/api";

// Google Maps Places API integration
export const searchGoogleMaps = action({
  args: {
    searchId: v.id("searches"),
    location: v.string(),
    radius: v.number(),
    keywords: v.array(v.string()),
    pageToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    // Verify search exists and user owns it
    const search = await ctx.runQuery(internal.search.internal.getSearchForProcessing, {
      searchId: args.searchId,
      userId,
    });

    if (!search) {
      throw createError("Search not found or access denied", ERROR_CODES.FORBIDDEN, 403);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      // First, geocode the location to get coordinates
      let lat: number, lng: number;
      
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=${encodeURIComponent(args.location)}&key=${apiKey}`;
      
      const geocodeResponse = await fetch(geocodeUrl);
      const geocodeData = await geocodeResponse.json();
      
      if (geocodeData.status !== "OK" || !geocodeData.results.length) {
        throw createError(
          `Location "${args.location}" not found`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }
      
      const locationData = geocodeData.results[0];
      lat = locationData.geometry.location.lat;
      lng = locationData.geometry.location.lng;

      // Search for places using the first keyword as the primary type
      const keyword = args.keywords[0];
      let searchUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACES_SEARCH}`;
      
      const params = new URLSearchParams({
        location: `${lat},${lng}`,
        radius: args.radius.toString(),
        keyword: keyword,
        key: apiKey,
      });

      if (args.pageToken) {
        params.append("pagetoken", args.pageToken);
      }

      searchUrl += "?" + params.toString();

      const placesResponse = await retry(async () => {
        const response = await fetch(searchUrl);
        if (!response.ok) {
          throw new Error(`Google Maps API error: ${response.status}`);
        }
        return response.json();
      }, 3, 2000);

      if (placesResponse.status === "ZERO_RESULTS") {
        return {
          results: [],
          nextPageToken: null,
          totalResults: 0,
        };
      }

      if (placesResponse.status !== "OK") {
        throw createError(
          `Google Maps API error: ${placesResponse.status}`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }

      const places = placesResponse.results || [];
      
      // Filter results based on additional keywords
      const filteredPlaces = places.filter((place: any) => {
        if (args.keywords.length <= 1) return true;
        
        const searchText = `${place.name} ${place.types?.join(" ")} ${place.vicinity || ""}`.toLowerCase();
        
        return args.keywords.slice(1).some(keyword => 
          searchText.includes(keyword.toLowerCase())
        );
      });

      // Process each place and store as leads
      const processedLeads = [];
      
      for (const place of filteredPlaces) {
        try {
          // Get additional place details
          const detailsUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.PLACE_DETAILS}?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,types,geometry&key=${apiKey}`;
          
          const detailsResponse = await fetch(detailsUrl);
          const detailsData = await detailsResponse.json();
          
          if (detailsData.status === "OK" && detailsData.result) {
            const details = detailsData.result;
            
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
            const leadId = await ctx.runMutation(internal.leads.internal.createLeadFromSearch, {
              userId,
              ...leadData,
            });

            processedLeads.push({
              leadId,
              businessName: leadData.businessName,
              placeId: leadData.placeId,
            });

          }
        } catch (error) {
          console.error(`Error processing place ${place.place_id}:`, error);
          // Continue with other places even if one fails
        }
      }

      // Update search progress
      await ctx.runMutation(internal.search.internal.updateSearchProgress, {
        searchId: args.searchId,
        discovered: search.progress.discovered + processedLeads.length,
        totalFound: search.results.totalFound + processedLeads.length,
      });

      return {
        results: processedLeads,
        nextPageToken: placesResponse.next_page_token || null,
        totalResults: processedLeads.length,
        location: {
          lat,
          lng,
          formattedAddress: locationData.formatted_address,
        },
      };

    } catch (error) {
      console.error("Google Maps search error:", error);
      
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
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      const geocodeUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}${API_CONFIG.GOOGLE_MAPS.ENDPOINTS.GEOCODING}?address=${encodeURIComponent(args.address)}&key=${apiKey}`;
      
      const response = await fetch(geocodeUrl);
      const data = await response.json();
      
      if (data.status !== "OK" || !data.results.length) {
        throw createError(
          `Address "${args.address}" not found`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }
      
      const result = data.results[0];
      
      return {
        formattedAddress: result.formatted_address,
        location: {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
        },
        addressComponents: result.address_components,
        placeId: result.place_id,
      };

    } catch (error) {
      console.error("Geocoding error:", error);
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
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw createError("Google Maps API key not configured", ERROR_CODES.INTERNAL_ERROR, 500);
    }

    try {
      const params = new URLSearchParams({
        input: args.input,
        key: apiKey,
      });

      if (args.types) {
        params.append("types", args.types);
      }

      const autocompleteUrl = `${API_CONFIG.GOOGLE_MAPS.BASE_URL}/place/autocomplete/json?${params.toString()}`;
      
      const response = await fetch(autocompleteUrl);
      const data = await response.json();
      
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        throw createError(
          `Autocomplete API error: ${data.status}`,
          ERROR_CODES.GOOGLE_MAPS_ERROR,
          400
        );
      }
      
      return {
        predictions: data.predictions || [],
        status: data.status,
      };

    } catch (error) {
      console.error("Place suggestions error:", error);
      throw createError(
        "Failed to get place suggestions",
        ERROR_CODES.GOOGLE_MAPS_ERROR,
        500
      );
    }
  },
});

// Validate location exists
export const validateLocation = action({
  args: { location: v.string() },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    
    if (!userId) {
      throw createError("Authentication required", ERROR_CODES.UNAUTHORIZED, 401);
    }

    try {
      const geocodeResult = await ctx.runAction(internal.search.actions.geocodeAddress, {
        address: args.location,
      });

      return {
        isValid: true,
        formattedAddress: geocodeResult.formattedAddress,
        location: geocodeResult.location,
      };

    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : "Invalid location",
      };
    }
  },
});