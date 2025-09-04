import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// Google Maps search action
export const searchGoogleMaps = action({
  args: {
    searchId: v.id("searches"),
    forceRestart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Get search record using scheduler
    const search = await ctx.runQuery(api.search.queries.getSearch, { searchId: args.searchId });
    if (!search) {
      throw new Error("Search not found or access denied");
    }

    // Check if search is already in progress (unless force restart)
    if (!args.forceRestart && search.status === "in_progress") {
      throw new Error("Search is already in progress");
    }

    // Check user credits using scheduler
    const currentUser = await ctx.runQuery(api.users.queries.getCurrentUserData, {});
    if (!currentUser || currentUser.credits < 1) {
      throw new Error("Insufficient credits to start search");
    }

    try {
      // Update search status to in progress using scheduler
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "in_progress",
      });

      // Get Google Maps API key
      const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!googleMapsApiKey) {
        throw new Error("Google Maps API key not configured");
      }

      // Build search query
      const params = search.parameters;
      const query = params.keywords.join(" ");
      const location = params.location;
      const radius = params.radius * 1000; // Convert km to meters

      // Call Google Maps Places API
      const placesUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      placesUrl.searchParams.set("query", query);
      placesUrl.searchParams.set("location", location);
      placesUrl.searchParams.set("radius", radius.toString());
      placesUrl.searchParams.set("type", "establishment");
      placesUrl.searchParams.set("key", googleMapsApiKey);

      const response = await fetch(placesUrl.toString());
      if (!response.ok) {
        throw new Error(`Google Maps API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        status: string;
        error_message?: string;
        results?: any[];
      };
      
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        throw new Error(`Google Maps API error: ${data.status} - ${data.error_message || "Unknown error"}`);
      }

      const places = data.results || [];
      const totalFound = Math.min(places.length, params.maxResults);

      // Update search progress using scheduler
      await ctx.runMutation(api.search.mutations.updateSearchProgress, {
        searchId: args.searchId,
        progress: {
          discovered: totalFound,
          enriched: 0,
          analyzed: 0,
          total: totalFound,
        },
      });

      // Create lead records for discovered places
      const leadIds: string[] = [];
      for (let i = 0; i < totalFound; i++) {
        const place = places[i];
        
        // Create lead using mutations
        const leadId = await ctx.runMutation(api.leads.mutations.createLead, {
          searchId: args.searchId,
          leadData: {
            businessName: place.name || "Unknown",
            address: place.formatted_address || "",
            placeId: place.place_id || "",
            location: {
              lat: place.geometry?.location?.lat || 0,
              lng: place.geometry?.location?.lng || 0,
              formattedAddress: place.formatted_address || "",
              city: undefined,
              state: undefined,
              country: undefined,
              postalCode: undefined,
            },
            phone: place.formatted_phone_number || undefined,
            website: place.website || undefined,
            rating: place.rating || undefined,
            reviewCount: place.user_ratings_total || undefined,
            category: place.types?.[0] || undefined,
          },
        });

        leadIds.push(leadId);
      }

      // Deduct credit and record transaction using scheduler
      await ctx.runMutation(api.users.mutations.deductCredits, {
        amount: 1,
        description: "Google Maps lead discovery",
        relatedEntity: {
          type: "search",
          id: args.searchId,
        },
      });

      // Update search credits used
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "completed", // Mark as completed regardless of results
      });

      // If no leads found, return completion message
      if (totalFound === 0) {
        return {
          success: true,
          message: "Search completed - no results found",
          totalFound: 0,
          leadIds: [],
        };
      }

      return {
        success: true,
        message: `Discovered ${totalFound} potential leads`,
        totalFound,
        leadIds,
      };

    } catch (error) {
      console.error("Google Maps search error:", error);
      
      // Update search status to failed using scheduler
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  },
});