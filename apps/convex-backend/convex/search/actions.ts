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
    // Check emergency stop first
    const systemConfig = await ctx.runQuery(api.admin.queries.getSystemConfiguration, {});
    if (!systemConfig?.orchestrationSettings?.leadGenerationEnabled) {
      throw new Error("Lead generation is currently paused. Please contact administrator.");
    }

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

      // Log search started
      console.log(`Search ${args.searchId} started for user ${user._id}: Starting lead discovery...`);

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

      // First geocode the location to get lat,lng coordinates
      let lat: number, lng: number;
      try {
        const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        geocodeUrl.searchParams.set("address", location);
        geocodeUrl.searchParams.set("key", googleMapsApiKey);

        const geocodeResponse = await fetch(geocodeUrl.toString());
        const geocodeData = await geocodeResponse.json() as {
          status: string;
          results?: Array<{
            geometry: {
              location: { lat: number; lng: number };
            };
          }>;
        };
        
        if (geocodeData.status !== "OK" || !geocodeData.results?.[0]) {
          throw new Error(`Geocoding failed: ${geocodeData.status}`);
        }
        
        const coordinates = geocodeData.results[0].geometry.location;
        lat = coordinates.lat;
        lng = coordinates.lng;
        console.log(`Geocoded location "${location}" to ${lat},${lng}`);
      } catch (geocodeError) {
        console.error("Geocoding error:", geocodeError);
        // Fallback: use text search without location bias
        lat = 0;
        lng = 0;
      }

      // Call Google Maps Places API with proper location format
      const placesUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      placesUrl.searchParams.set("query", query);
      if (lat !== 0 && lng !== 0) {
        placesUrl.searchParams.set("location", `${lat},${lng}`);
        placesUrl.searchParams.set("radius", radius.toString());
      }
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

      // Log progress update
      console.log(`Search ${args.searchId} progress: Discovered ${totalFound} leads`);

      // Create lead records for discovered places with Place Details enrichment
      const leadIds: string[] = [];
      for (let i = 0; i < totalFound; i++) {
        const place = places[i];
        
        // Get detailed place information including website and phone
        let detailedPlace = place;
        if (place.place_id) {
          try {
            const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
            detailsUrl.searchParams.set("place_id", place.place_id);
            detailsUrl.searchParams.set("fields", "website,formatted_phone_number,international_phone_number");
            detailsUrl.searchParams.set("key", googleMapsApiKey);
            
            const detailsResponse = await fetch(detailsUrl.toString());
            if (detailsResponse.ok) {
              const detailsData = await detailsResponse.json() as {
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
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.warn(`Failed to get place details for ${place.place_id}:`, error);
            // Continue with basic place data
          }
        }
        
        // Create lead using mutations with enriched data
        const leadId = await ctx.runMutation(api.leads.mutations.createLead, {
          searchId: args.searchId,
          leadData: {
            businessName: detailedPlace.name || "Unknown",
            address: detailedPlace.formatted_address || "",
            placeId: detailedPlace.place_id || "",
            location: {
              lat: detailedPlace.geometry?.location?.lat || 0,
              lng: detailedPlace.geometry?.location?.lng || 0,
              formattedAddress: detailedPlace.formatted_address || "",
              city: undefined,
              state: undefined,
              country: undefined,
              postalCode: undefined,
            },
            phone: detailedPlace.formatted_phone_number || detailedPlace.international_phone_number || undefined,
            website: detailedPlace.website || undefined,
            rating: detailedPlace.rating || undefined,
            reviewCount: detailedPlace.user_ratings_total || undefined,
            category: detailedPlace.types?.[0] || undefined,
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

      // Update search status to processing (discovery complete, but pipeline continues)
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "processing", // Changed from "completed" - pipeline continues
      });

      // Log discovery completion
      console.log(`Search ${args.searchId} discovery completed: ${totalFound} leads found`);

      // If no leads found, complete the search immediately
      if (totalFound === 0) {
        await ctx.runMutation(api.search.mutations.updateSearchStatus, {
          searchId: args.searchId,
          status: "completed",
        });
        
        return {
          success: true,
          message: "Search completed - no results found",
          totalFound: 0,
          leadIds: [],
        };
      }

      // Trigger enrichment stage for discovered leads
      await ctx.scheduler.runAfter(0, "leads/actions:enrichLeads" as any, {
        searchId: args.searchId,
      });

      return {
        success: true,
        message: `Discovered ${totalFound} potential leads, starting enrichment...`,
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

      // Log error
      console.error(`Search ${args.searchId} failed:`, error instanceof Error ? error.message : "Unknown error");

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
    try {
      console.log(`Completing search ${args.searchId}`);

      // Get search info
      const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
        searchId: args.searchId,
      });
      
      if (!search) {
        throw new Error("Search not found");
      }

      // Calculate final results
      const results: any = await ctx.runQuery(internal.search.internal.getSearchResults, {
        searchId: args.searchId,
      });

      // Update search status to completed with final results
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "completed",
      });

      // Update search progress and results
      await ctx.runMutation(internal.search.internal.updateSearchResults, {
        searchId: args.searchId,
        results: {
          totalFound: results.totalFound,
          enrichedCount: results.enrichedCount,
          analyzedCount: results.analyzedCount,
          avgRelevanceScore: results.avgRelevanceScore,
        },
        progress: {
          discovered: results.totalFound,
          enriched: results.enrichedCount,
          analyzed: results.analyzedCount,
          total: results.totalFound,
        },
      });

      // Send final pipeline update broadcast
      await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
        userId: search.userId,
        searchId: args.searchId,
        stage: "completed",
        progress: 100,
        message: `Search completed! Found ${results.totalFound} leads, enriched ${results.enrichedCount}, analyzed ${results.analyzedCount}`,
        data: {
          results: {
            totalFound: results.totalFound,
            enrichedCount: results.enrichedCount,
            analyzedCount: results.analyzedCount,
            avgRelevanceScore: results.avgRelevanceScore,
          },
          progress: {
            discovered: results.totalFound,
            enriched: results.enrichedCount,
            analyzed: results.analyzedCount,
            total: results.totalFound,
          }
        }
      });

      // Send completion notification
      try {
        await ctx.runAction("notifications/actions:sendSearchCompletedEmail" as any, {
          searchId: args.searchId,
          results: results,
        });
      } catch (error) {
        // Don't fail the completion if email fails
        console.warn(`Failed to send completion email for search ${args.searchId}:`, error);
      }

      console.log(`Search ${args.searchId} completed successfully: ${results.totalFound} leads, ${results.enrichedCount} enriched, ${results.analyzedCount} analyzed`);

      return {
        success: true,
        message: "Search completed successfully",
        results: results,
      };

    } catch (error) {
      console.error(`Search completion failed for ${args.searchId}:`, error);
      
      // Update search status to failed
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "Search completion failed",
      });

      throw error;
    }
  },
});