import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Google Places API types
interface PlacePrediction {
  description: string;
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text?: string;
  };
  types: string[];
}

interface PlacesAutocompleteResponse {
  predictions: PlacePrediction[];
  status: string;
  error_message?: string;
}

// Get place predictions from Google Places API
export const getPlacePredictions = action({
  args: {
    input: v.string(),
    types: v.optional(v.array(v.string())),
    location: v.optional(v.string()),
    radius: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get Google Maps API key
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      throw new Error("Google Maps API key not configured");
    }

    // Validate input
    if (!args.input.trim()) {
      return {
        success: true,
        predictions: [],
        message: "Empty input provided",
      };
    }

    try {
      // Build Places Autocomplete API URL
      const placesUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      );
      placesUrl.searchParams.set("input", args.input);
      placesUrl.searchParams.set("key", googleMapsApiKey);

      // Set default types to cities and administrative areas for location search
      const types =
        args.types && args.types.length > 0 ? args.types : ["(cities)"];
      if (types.length > 0) {
        placesUrl.searchParams.set("types", types.join("|"));
      }

      // Add location bias if provided
      if (args.location && args.radius) {
        placesUrl.searchParams.set("location", args.location);
        placesUrl.searchParams.set("radius", args.radius.toString());
      }

      // Make request to Google Places API
      const response = await fetch(placesUrl.toString());
      if (!response.ok) {
        throw new Error(
          `Google Places API HTTP error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as PlacesAutocompleteResponse;

      // Check API response status
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        throw new Error(
          `Google Places API error: ${data.status} - ${data.error_message || "Unknown error"}`,
        );
      }

      const predictions = data.predictions || [];

      return {
        success: true,
        predictions: predictions.map((prediction) => ({
          placeId: prediction.place_id,
          description: prediction.description,
          mainText: prediction.structured_formatting.main_text,
          secondaryText:
            prediction.structured_formatting.secondary_text || null,
          types: prediction.types,
        })),
        message: `Found ${predictions.length} location suggestions`,
      };
    } catch (error) {
      console.error("Places Autocomplete API error:", error);

      return {
        success: false,
        predictions: [],
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch location suggestions",
      };
    }
  },
});

// Get place details from Google Places API
export const getPlaceDetails = action({
  args: {
    placeId: v.string(),
    fields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get Google Maps API key
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      throw new Error("Google Maps API key not configured");
    }

    // Validate place ID
    if (!args.placeId.trim()) {
      throw new Error("Place ID is required");
    }

    try {
      // Build Places Details API URL
      const detailsUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/details/json",
      );
      detailsUrl.searchParams.set("place_id", args.placeId);
      detailsUrl.searchParams.set("key", googleMapsApiKey);

      // Set fields to return (default to basic place info)
      const fields =
        args.fields && args.fields.length > 0
          ? args.fields
          : ["place_id", "formatted_address", "geometry", "name", "types"];
      detailsUrl.searchParams.set("fields", fields.join(","));

      // Make request to Google Places API
      const response = await fetch(detailsUrl.toString());
      if (!response.ok) {
        throw new Error(
          `Google Places Details API HTTP error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        result?: any;
        status: string;
        error_message?: string;
      };

      // Check API response status
      if (data.status !== "OK") {
        throw new Error(
          `Google Places Details API error: ${data.status} - ${data.error_message || "Unknown error"}`,
        );
      }

      const place = data.result;
      if (!place) {
        throw new Error("No place details found");
      }

      return {
        success: true,
        place: {
          placeId: place.place_id,
          name: place.name || null,
          formattedAddress: place.formatted_address || null,
          geometry: place.geometry
            ? {
                location: {
                  lat: place.geometry.location?.lat || 0,
                  lng: place.geometry.location?.lng || 0,
                },
              }
            : null,
          types: place.types || [],
        },
        message: "Place details retrieved successfully",
      };
    } catch (error) {
      console.error("Places Details API error:", error);

      return {
        success: false,
        place: null,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch place details",
      };
    }
  },
});
