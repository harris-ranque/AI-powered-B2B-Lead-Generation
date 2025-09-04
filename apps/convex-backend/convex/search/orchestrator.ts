import { internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// Pipeline stages definition
export const PIPELINE_STAGES = [
  "created",
  "discovery",
  "enrichment", 
  "analysis",
  "email_generation",
  "completed"
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

// Main orchestrator for search pipeline
export const orchestrateSearch = internalAction({
  args: {
    searchId: v.id("searches"),
    startFromStage: v.optional(v.union(
      v.literal("discovery"),
      v.literal("enrichment"),
      v.literal("analysis"),
      v.literal("email_generation")
    )),
  },
  handler: async (ctx, args) => {
    const { searchId, startFromStage = "discovery" } = args;
    const correlationId = `orch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Get search details
      const search = await ctx.runQuery(internal.search.queries.getSearchInternal, { 
        searchId 
      });
      
      if (!search) {
        throw new Error("Search not found");
      }

      // Log orchestration start
      await ctx.runMutation(internal.search.mutations.logCorrelation, {
        correlationId,
        operationType: "search_orchestration",
        userId: search.userId,
        searchId,
        level: "info",
        message: `Starting orchestration from stage: ${startFromStage}`,
      });

      // Update search status to in_progress
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId,
        status: "in_progress",
      });

      // Broadcast pipeline start
      await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
        userId: search.userId as Id<"users">,
        searchId,
        stage: "started",
        progress: 0,
        message: "Starting lead generation pipeline",
      });

      let currentStage = startFromStage;
      let pipelineSuccess = true;
      let totalProgress = 0;

      // Stage 1: Google Maps Discovery
      if (currentStage === "discovery") {
        try {
          await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
            userId: search.userId as Id<"users">,
            searchId,
            stage: "discovery",
            progress: 10,
            message: "Discovering leads from Google Maps",
          });

          const discoveryResult = await ctx.runAction(api.search.actions.searchGoogleMaps, {
            searchId,
          });

          if (discoveryResult.totalFound === 0) {
            // No leads found, complete the search
            await ctx.runMutation(api.search.mutations.updateSearchStatus, {
              searchId,
              status: "completed",
            });
            
            await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
              userId: search.userId as Id<"users">,
              searchId,
              stage: "completed",
              progress: 100,
              message: "Search completed - no leads found",
            });
            
            return { success: true, message: "No leads found" };
          }

          totalProgress = 25;
          currentStage = "enrichment";
          
          await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
            userId: search.userId as Id<"users">,
            searchId,
            stage: "discovery",
            progress: totalProgress,
            message: `Discovered ${discoveryResult.totalFound} potential leads`,
          });

        } catch (error) {
          console.error("Discovery stage error:", error);
          pipelineSuccess = false;
          
          await ctx.runMutation(internal.search.mutations.logCorrelation, {
            correlationId,
            operationType: "search_orchestration",
            userId: search.userId as Id<"users">,
            searchId,
            level: "error",
            message: "Discovery stage failed",
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              name: "DiscoveryError",
            },
          });
        }
      }

      // Stage 2: Lead Enrichment
      if (currentStage === "enrichment" && pipelineSuccess) {
        try {
          await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
            userId: search.userId as Id<"users">,
            searchId,
            stage: "enrichment",
            progress: 30,
            message: "Starting lead enrichment with FindyMail",
          });

          const enrichmentResult = await ctx.runAction(internal.leads.enrichment.batchEnrichLeads, {
            searchId,
            correlationId,
          });

          totalProgress = 60;
          currentStage = "analysis";
          
          await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
            userId: search.userId as Id<"users">,
            searchId,
            stage: "enrichment",
            progress: totalProgress,
            message: `Enriched ${enrichmentResult.enrichedCount} leads`,
          });

        } catch (error) {
          console.error("Enrichment stage error:", error);
          // Continue pipeline even if enrichment partially fails
          currentStage = "analysis";
          
          await ctx.runMutation(internal.search.mutations.logCorrelation, {
            correlationId,
            operationType: "search_orchestration", 
            userId: search.userId as Id<"users">,
            searchId,
            level: "warn",
            message: "Enrichment stage had errors but continuing",
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              name: "EnrichmentError",
            },
          });
        }
      }

      // Stage 3: AI Analysis (optional based on plan)
      if (currentStage === "analysis" && pipelineSuccess) {
        try {
          // Check if user plan includes AI analysis
          const user = await ctx.runQuery(internal.users.queries.getUserInternal, {
            userId: search.userId,
          });

          if (user && (user.plan === "pro" || user.plan === "enterprise")) {
            await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
              userId: search.userId as Id<"users">,
              searchId,
              stage: "analysis",
              progress: 70,
              message: "Analyzing leads with AI",
            });

            const analysisResult = await ctx.runAction(internal.langgraph.actions.batchAnalyzeLeads, {
              searchId,
              correlationId,
            });

            totalProgress = 85;
            
            await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
              userId: search.userId as Id<"users">,
              searchId,
              stage: "analysis",
              progress: totalProgress,
              message: `Analyzed ${analysisResult.analyzedCount} leads`,
            });
          } else {
            // Skip analysis for free users
            totalProgress = 85;
          }

          // All stages are done

        } catch (error) {
          console.error("Analysis stage error:", error);
          // Continue to completion even if analysis fails
          // All stages are done
          
          await ctx.runMutation(internal.search.mutations.logCorrelation, {
            correlationId,
            operationType: "search_orchestration",
            userId: search.userId as Id<"users">,
            searchId,
            level: "warn",
            message: "Analysis stage had errors but continuing",
            error: {
              message: error instanceof Error ? error.message : "Unknown error",
              name: "AnalysisError",
            },
          });
        }
      }

      // Final Stage: Complete Pipeline
      // Always execute completion logic
      {
        // Update search status
        await ctx.runMutation(api.search.mutations.updateSearchStatus, {
          searchId,
          status: pipelineSuccess ? "completed" : "failed",
          error: !pipelineSuccess ? "Pipeline had errors" : undefined,
        });

        // Calculate final results
        const results = await ctx.runQuery(internal.search.queries.getSearchResults, {
          searchId,
        });

        // Broadcast completion
        await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
          userId: search.userId as Id<"users">,
          searchId,
          stage: "completed",
          progress: 100,
          message: pipelineSuccess 
            ? `Pipeline completed! Found ${results.totalFound} leads, enriched ${results.enrichedCount}`
            : "Pipeline completed with some errors",
          data: results,
        });

        // Log completion
        await ctx.runMutation(internal.search.mutations.logCorrelation, {
          correlationId,
          operationType: "search_orchestration",
          userId: search.userId as Id<"users">,
          searchId,
          level: "info",
          message: `Orchestration completed. Success: ${pipelineSuccess}`,
          data: results,
        });

        return {
          success: pipelineSuccess,
          message: pipelineSuccess ? "Pipeline completed successfully" : "Pipeline had errors",
          results,
        };
      }

      return {
        success: false,
        message: "Pipeline ended unexpectedly",
      };

    } catch (error) {
      console.error("Orchestration error:", error);
      
      // Update search status to failed
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "Orchestration failed",
      });

      // Broadcast failure
      await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
        userId: search.userId as Id<"users">,
        searchId,
        stage: "failed",
        progress: 0,
        message: "Pipeline failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw error;
    }
  },
});

// Resume a stuck or failed search
export const resumeSearch = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.queries.getSearchInternal, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error("Search not found");
    }

    // Determine which stage to resume from based on progress
    let resumeStage: PipelineStage = "discovery";
    
    // Check if we have any leads
    const leads = await ctx.runQuery(internal.leads.queries.getSearchLeadsInternal, {
      searchId: args.searchId,
    });

    if (leads.length > 0) {
      // We have leads, check enrichment status
      const enrichedLeads = leads.filter(l => 
        l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback"
      );
      
      if (enrichedLeads.length > 0) {
        // Some enrichment done, resume from analysis
        resumeStage = "analysis";
      } else {
        // No enrichment, resume from enrichment
        resumeStage = "enrichment";
      }
    }

    // Resume orchestration from determined stage
    return await orchestrateSearch(ctx, {
      searchId: args.searchId,
      startFromStage: resumeStage,
    });
  },
});

// Check and fix stuck searches (called by cron)
export const checkStuckSearches = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find searches that are in_progress but haven't been updated in 10 minutes
    const stuckThreshold = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    
    const stuckSearches = await ctx.runQuery(internal.search.queries.getStuckSearches, {
      stuckThreshold,
    });

    const results = [];
    
    for (const search of stuckSearches) {
      try {
        console.log(`Resuming stuck search: ${search._id}`);
        const result = await resumeSearch(ctx, { searchId: search._id });
        results.push({ searchId: search._id, success: result.success });
      } catch (error) {
        console.error(`Failed to resume search ${search._id}:`, error);
        results.push({ searchId: search._id, success: false, error: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    return {
      processedCount: results.length,
      results,
    };
  },
});