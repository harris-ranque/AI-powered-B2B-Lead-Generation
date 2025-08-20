import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { STATUS, CREDIT_COSTS } from "../lib/constants";
import { createError, retry } from "../lib/helpers";
import { broadcastSearchUpdate } from "../realtime/integration";
import { 
  createCorrelationContext, 
  createChildContext,
  OPERATION_TYPES,
  startPerformanceTracking,
  endPerformanceTracking,
  CorrelationContext
} from "../lib/correlation";
import { logWithCorrelationPersistent } from "../lib/logging";

/**
 * Search Pipeline Orchestrator
 * 
 * Manages the complete lead search pipeline:
 * 1. Google Maps discovery
 * 2. FindyMail email enrichment
 * 3. LangGraph AI analysis
 * 4. Status updates and notifications
 */

// Main orchestrator function - coordinates the entire search pipeline
export const orchestrateSearchPipeline = internalMutation({
  args: {
    searchId: v.id("searches"),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      console.error(`Search not found: ${args.searchId}`);
      return { success: false, error: "Search not found" };
    }

    // Check if system is paused - stop all orchestration
    const systemControlState = await ctx.db
      .query("systemControlState")
      .unique();
    
    if (systemControlState?.systemPaused) {
      await logWithCorrelationPersistent(ctx, 'info', 
        { correlationId: args.correlationId || "none", operationType: OPERATION_TYPES.SEARCH_ORCHESTRATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() },
        `System is paused, orchestration blocked for search ${args.searchId}. Reason: ${systemControlState.reason || 'System paused by admin'}`
      );
      return { success: false, error: "System is currently paused for maintenance" };
    }

    // Prevent spam by checking if search is in a terminal state
    if (search.status === "completed" || search.status === "failed" || search.status === "cancelled") {
      // Only log terminal state skips at info level for first time, then suppress
      const logLevel = search.orchestrationAttempts && search.orchestrationAttempts > 1 ? null : 'debug';
      
      if (logLevel) {
        await logWithCorrelationPersistent(ctx, logLevel, 
          { correlationId: args.correlationId || "none", operationType: OPERATION_TYPES.SEARCH_ORCHESTRATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() },
          `Search ${args.searchId} is in terminal state (${search.status}), skipping orchestration`
        );
      }
      
      // Increment attempt counter to suppress future logs
      await ctx.db.patch(args.searchId, {
        orchestrationAttempts: (search.orchestrationAttempts || 0) + 1,
      });
      
      return { success: true, message: `Search already in terminal state: ${search.status}` };
    }

    // Prevent orchestration loops with atomic lock mechanism
    const now = Date.now();
    const lastOrchestration = search.lastOrchestrationAt || 0;
    const orchestrationCooldown = 15000; // Reduced to 15 seconds for better responsiveness
    
    if (now - lastOrchestration < orchestrationCooldown) {
      await logWithCorrelationPersistent(ctx, 'debug',
        { correlationId: args.correlationId || "none", operationType: OPERATION_TYPES.SEARCH_ORCHESTRATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() },
        `Orchestration cooldown active for search ${args.searchId}, skipping (last: ${lastOrchestration}, now: ${now})`
      );
      return { success: true, message: "Orchestration in cooldown period" };
    }

    // Generate unique orchestration ID for atomic locking
    const orchestrationId = crypto.randomUUID();
    
    // Atomic update with orchestration lock to prevent race conditions
    try {
      await ctx.db.patch(args.searchId, {
        lastOrchestrationAt: now,
        orchestrationLock: orchestrationId,
        orchestrationLockExpiry: now + 300000, // 5 minute lock expiry
      });
    } catch (error) {
      // If patch fails due to concurrent modification, another orchestration is running
      await logWithCorrelationPersistent(ctx, 'debug',
        { correlationId: args.correlationId || "none", operationType: OPERATION_TYPES.SEARCH_ORCHESTRATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() },
        `Concurrent orchestration detected for search ${args.searchId}, aborting this instance`
      );
      return { success: true, message: "Concurrent orchestration in progress" };
    }

    // Create correlation context for this orchestration
    const correlation = args.correlationId 
      ? createChildContext(
          { correlationId: args.correlationId, operationType: OPERATION_TYPES.SEARCH_CREATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() },
          OPERATION_TYPES.SEARCH_ORCHESTRATE,
          { searchId: args.searchId }
        )
      : createCorrelationContext(OPERATION_TYPES.SEARCH_ORCHESTRATE, search.userId, { searchId: args.searchId });

    const perf = startPerformanceTracking();
    
    await logWithCorrelationPersistent(ctx, 'info', correlation, `Starting orchestration for search in status: ${search.status}`);

    try {
      // Broadcast real-time status update
      await broadcastSearchUpdate(ctx, args.searchId, search.status, `Processing pipeline stage: ${search.status}`);
      
      // Check current pipeline stage and trigger next steps
      switch (search.status) {
        case STATUS.SEARCH.PENDING:
          await logWithCorrelationPersistent(ctx, 'info', correlation, 'Triggering Google Maps discovery phase');
          // Start Google Maps discovery
          await ctx.scheduler.runAfter(0, internal.search.orchestrator.startGoogleMapsDiscovery, {
            searchId: args.searchId,
            parentCorrelationId: correlation.correlationId,
          });
          break;

        case STATUS.SEARCH.IN_PROGRESS:
          // First check if discovery has been started, if not start it
          const leadCount = await ctx.runQuery(internal.leads.internal.getLeadCount, { searchId: args.searchId });
          
          if (leadCount === 0) {
            // Check if search was started more than 5 minutes ago with no results
            const searchAge = now - search.createdAt;
            if (searchAge > 300000) { // 5 minutes
              // Search is old with no results, likely completed with zero results
              await logWithCorrelationPersistent(ctx, 'info', correlation, 'Search aged with no results, completing search');
              await ctx.db.patch(args.searchId, {
                status: STATUS.SEARCH.COMPLETED,
              });
              await broadcastSearchUpdate(ctx, args.searchId, "completed", 
                `Search completed - No results found for your search criteria`
              );
              break;
            }
            
            // Discovery hasn't started yet, trigger Google Maps discovery
            await logWithCorrelationPersistent(ctx, 'info', correlation, 'Starting Google Maps discovery for in-progress search');
            await ctx.scheduler.runAfter(0, internal.search.orchestrator.startGoogleMapsDiscovery, {
              searchId: args.searchId,
              parentCorrelationId: correlation.correlationId,
            });
          } else {
            // Check if discoveries are complete, trigger enrichment
            const discoveryResult = await checkDiscoveryComplete(ctx, args.searchId);
            if (discoveryResult.isComplete) {
              await logWithCorrelationPersistent(ctx, 'info', correlation, 'Discovery complete, triggering enrichment phase');
              await ctx.scheduler.runAfter(0, internal.search.orchestrator.startEnrichmentPhase, {
                searchId: args.searchId,
                parentCorrelationId: correlation.correlationId,
              });
            } else {
              await logWithCorrelationPersistent(ctx, 'debug', correlation, 'Discovery still in progress, waiting for completion');
              
              // Send user warning if discovery is taking too long
              if (discoveryResult.shouldWarnUser) {
                await broadcastSearchUpdate(ctx, args.searchId, "discovery_delayed", 
                  `Your search is taking longer than expected. We're still finding leads - this may take up to ${Math.ceil(discoveryResult.timeRemaining / 60000)} more minutes.`
                );
              }
            }
          }
          break;

        default:
          await logWithCorrelationPersistent(ctx, 'debug', correlation, `Search in status ${search.status}, no orchestration needed`);
      }

      const perfData = endPerformanceTracking(perf);
      await logWithCorrelationPersistent(ctx, 'info', correlation, 'Orchestration completed successfully', { status: search.status }, undefined, perfData);

      // Release orchestration lock on successful completion
      await ctx.db.patch(args.searchId, {
        orchestrationLock: undefined,
        orchestrationLockExpiry: undefined,
      });

      return { success: true, correlationId: correlation.correlationId };

    } catch (error) {
      const perfData = endPerformanceTracking(perf);
      await logWithCorrelationPersistent(ctx, 'error', correlation, 'Orchestration failed', { status: search.status }, error as Error, perfData);
      
      // Release orchestration lock on error
      await ctx.db.patch(args.searchId, {
        orchestrationLock: undefined,
        orchestrationLockExpiry: undefined,
        status: STATUS.SEARCH.FAILED,
        error: error instanceof Error ? error.message : "Orchestration failed",
        completedAt: Date.now(),
      });

      // Trigger enhanced error recovery
      await ctx.runMutation(internal.search.errorRecovery.handleSearchError, {
        searchId: args.searchId,
        errorType: error instanceof Error ? error.name : "UNKNOWN",
        errorMessage: error instanceof Error ? error.message : "Orchestration failed",
        attemptCount: 1,
        context: { phase: "orchestration", correlation: correlation.correlationId },
      });

      return { success: false, error: error instanceof Error ? error.message : "Unknown error", correlationId: correlation.correlationId };
    }
  },
});

// Start Google Maps discovery phase
export const startGoogleMapsDiscovery = internalAction({
  args: {
    searchId: v.id("searches"),
    parentCorrelationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.internal.getSearchById, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error("Search not found");
    }

    // Create correlation context for this discovery phase
    const parentCorrelation = args.parentCorrelationId 
      ? { correlationId: args.parentCorrelationId, operationType: OPERATION_TYPES.SEARCH_ORCHESTRATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() }
      : undefined;
    
    const correlation = parentCorrelation 
      ? createChildContext(parentCorrelation, OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY, { searchId: args.searchId })
      : createCorrelationContext(OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY, search.userId, { searchId: args.searchId });

    const perf = startPerformanceTracking();
    
    await logWithCorrelationPersistent(ctx, 'info', correlation, 'Starting Google Maps discovery', {
      location: search.parameters.location,
      radius: search.parameters.radius,
      keywords: search.parameters.keywords,
    });
    
    try {
      // Update status to in_progress
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: STATUS.SEARCH.IN_PROGRESS,
      });

      await logWithCorrelationPersistent(ctx, 'info', correlation, 'Updated search status to in_progress');

      // Start Google Maps search
      await ctx.runAction(internal.search.actions.searchGoogleMaps, {
        searchId: args.searchId,
        location: search.parameters.location,
        radius: search.parameters.radius,
        keywords: search.parameters.keywords,
        userId: search.userId, // Pass userId for internal call authentication
      });

      const perfData = endPerformanceTracking(perf);
      await logWithCorrelationPersistent(ctx, 'info', correlation, 'Google Maps discovery completed successfully', undefined, undefined, perfData);
      
      // Trigger next phase check with delay to prevent rapid cycling
      await ctx.scheduler.runAfter(2000, internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId: args.searchId,
        correlationId: correlation.correlationId,
      });

    } catch (error) {
      const perfData = endPerformanceTracking(perf);
      await logWithCorrelationPersistent(ctx, 'error', correlation, 'Google Maps discovery failed', undefined, error as Error, perfData);
      
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: STATUS.SEARCH.FAILED,
        error: error instanceof Error ? error.message : "Discovery failed",
      });
    }
  },
});

// Start enrichment phase (FindyMail)
export const startEnrichmentPhase = internalAction({
  args: {
    searchId: v.id("searches"),
    parentCorrelationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const search = await ctx.runQuery(internal.search.internal.getSearchById, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error("Search not found");
    }

    // Create correlation context for enrichment phase
    const parentCorrelation = args.parentCorrelationId 
      ? { correlationId: args.parentCorrelationId, operationType: OPERATION_TYPES.SEARCH_ORCHESTRATE, userId: search.userId, searchId: args.searchId, createdAt: Date.now() }
      : undefined;
    
    const correlation = parentCorrelation 
      ? createChildContext(parentCorrelation, OPERATION_TYPES.LEAD_ENRICHMENT, { searchId: args.searchId })
      : createCorrelationContext(OPERATION_TYPES.LEAD_ENRICHMENT, search.userId, { searchId: args.searchId });

    await logWithCorrelationPersistent(ctx, 'info', correlation, `Starting enrichment phase for search: ${args.searchId}`);
    
    try {
      // Get all leads for this search that need enrichment
      const pendingLeads = await ctx.runQuery(internal.leads.internal.getLeadsPendingEnrichment, {
        searchId: args.searchId,
        limit: 50, // Process in batches
      });

      // Also get count of leads already enriched (for logging purposes)
      const totalLeads = await ctx.runQuery(internal.leads.internal.getLeadCount, {
        searchId: args.searchId,
      });

      if (pendingLeads.length === 0) {
        const alreadyEnrichedLeads = totalLeads - pendingLeads.length;
        await logWithCorrelationPersistent(ctx, 'info', correlation, 
          `No leads need enrichment for search: ${args.searchId}. Total leads: ${totalLeads}, skipping enrichment (${alreadyEnrichedLeads} leads already have emails or are completed)`
        );
        await ctx.runMutation(internal.search.orchestrator.checkAnalysisPhase, {
          searchId: args.searchId,
        });
        return;
      }

      const leadsAlreadyWithEmails = totalLeads - pendingLeads.length;
      
      await logWithCorrelationPersistent(ctx, 'info', correlation, 
        `Starting enrichment for ${pendingLeads.length} leads (${leadsAlreadyWithEmails} leads already have emails and will be skipped)`
      );
      
      await broadcastSearchUpdate(ctx, args.searchId, "enrichment_phase", 
        `Starting email enrichment for ${pendingLeads.length} leads${leadsAlreadyWithEmails > 0 ? ` (${leadsAlreadyWithEmails} already have emails)` : ''}`
      );
      
      // Trigger immediate enrichment queue processing
      await ctx.runMutation(internal.leads.enrichment.processEnrichmentQueue, {
        searchId: args.searchId,
      });

      // Also schedule immediate trigger for orchestrator to check progress
      await ctx.scheduler.runAfter(5000, internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId: args.searchId,
      });

      // Schedule a check for completion in 30 seconds
      await ctx.scheduler.runAfter(30000, internal.search.orchestrator.checkEnrichmentProgress, {
        searchId: args.searchId,
      });

    } catch (error) {
      await logWithCorrelationPersistent(ctx, 'error', correlation, `Enrichment phase failed for search ${args.searchId}`, undefined, error as Error);
      
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: STATUS.SEARCH.FAILED,
        error: error instanceof Error ? error.message : "Enrichment failed",
      });
    }
  },
});

// Check enrichment progress and trigger next phase
export const checkEnrichmentProgress = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.status !== STATUS.SEARCH.IN_PROGRESS) {
      return;
    }

    const pendingEnrichment = await ctx.runQuery(internal.leads.internal.getLeadsPendingEnrichment, {
      searchId: args.searchId,
      limit: 1,
    });

    if (pendingEnrichment.length === 0) {
      // All enrichment complete, move to analysis phase
      console.log(`Enrichment complete for search: ${args.searchId}, starting analysis`);
      await ctx.scheduler.runAfter(0, internal.search.orchestrator.startAnalysisPhase, {
        searchId: args.searchId,
      });
    } else {
      // Still processing, check again in 30 seconds
      console.log(`Enrichment still in progress for search: ${args.searchId}, ${pendingEnrichment.length} leads remaining`);
      await ctx.scheduler.runAfter(30000, internal.search.orchestrator.checkEnrichmentProgress, {
        searchId: args.searchId,
      });
    }
  },
});

// Start AI analysis phase (LangGraph)
export const startAnalysisPhase = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    console.log(`Starting AI analysis phase for search: ${args.searchId}`);
    
    try {
      // Get enriched leads that need analysis
      const enrichedLeads = await ctx.runQuery(internal.leads.internal.getEnrichedLeadsForAnalysis, {
        searchId: args.searchId,
        limit: 20, // Process in batches
      });

      if (enrichedLeads.length === 0) {
        console.log(`No enriched leads need analysis for search: ${args.searchId} (leads without emails are skipped)`);
        await ctx.runMutation(internal.search.orchestrator.completeSearch, {
          searchId: args.searchId,
        });
        return;
      }

      console.log(`Starting AI analysis for ${enrichedLeads.length} leads with email addresses`);
      await broadcastSearchUpdate(ctx, args.searchId, "analysis_phase", `Starting AI analysis for ${enrichedLeads.length} leads with emails`);

      // Trigger analysis with error handling to prevent infinite loops
      for (const lead of enrichedLeads) {
        try {
          await ctx.runAction(internal.langgraph.actions.analyzeLead, {
            leadId: lead._id,
          });
        } catch (error) {
          console.error(`Failed to analyze lead ${lead._id}:`, error);
          // Continue with other leads even if one fails
        }
      }

      // Schedule a check for completion in 60 seconds
      await ctx.scheduler.runAfter(60000, internal.search.orchestrator.checkAnalysisProgress, {
        searchId: args.searchId,
      });

    } catch (error) {
      console.error(`Analysis phase failed for search ${args.searchId}:`, error);
      
      await ctx.runMutation(internal.search.internal.updateSearchStatus, {
        searchId: args.searchId,
        status: STATUS.SEARCH.FAILED,
        error: error instanceof Error ? error.message : "Analysis failed",
      });
    }
  },
});

// Check analysis progress and complete search
export const checkAnalysisProgress = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    
    if (!search || search.status !== STATUS.SEARCH.IN_PROGRESS) {
      return;
    }

    const pendingAnalysis = await ctx.runQuery(internal.leads.internal.getLeadsPendingAnalysis, {
      searchId: args.searchId,
      limit: 1,
    });

    if (pendingAnalysis.length === 0) {
      // All analysis complete, finalize search
      console.log(`Analysis complete for search: ${args.searchId}, completing search`);
      await ctx.scheduler.runAfter(0, internal.search.orchestrator.completeSearch, {
        searchId: args.searchId,
      });
    } else {
      // Still processing, check again in 60 seconds
      console.log(`Analysis still in progress for search: ${args.searchId}, ${pendingAnalysis.length} leads remaining`);
      await ctx.scheduler.runAfter(60000, internal.search.orchestrator.checkAnalysisProgress, {
        searchId: args.searchId,
      });
    }
  },
});

// Check if analysis phase is ready
export const checkAnalysisPhase = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Immediately trigger analysis phase
    await ctx.scheduler.runAfter(0, internal.search.orchestrator.startAnalysisPhase, {
      searchId: args.searchId,
    });
  },
});

// Complete search with zero results
export const completeSearchWithZeroResults = internalMutation({
  args: {
    searchId: v.id("searches"),
    location: v.string(),
    keywords: v.array(v.string()),
    radius: v.number(),
  },
  handler: async (ctx, args) => {
    console.log(`Completing search with zero results: ${args.searchId}`);
    
    try {
      const search = await ctx.db.get(args.searchId);
      
      if (!search) {
        console.error(`Search not found during zero results completion: ${args.searchId}`);
        return;
      }

      // Update search status to completed
      await ctx.db.patch(args.searchId, {
        status: STATUS.SEARCH.COMPLETED,
        endedAt: Date.now(),
        results: {
          totalFound: 0,
          totalEnriched: 0,
          totalAnalyzed: 0,
          successfullyAnalyzed: 0,
        },
        progress: {
          discovered: 0,
          enriched: 0,
          analyzed: 0,
          total: 0,
        },
      });

      // Send completion broadcast to user
      await ctx.scheduler.runAfter(0, internal.realtime.broadcaster.broadcastSearchStatus, {
        searchId: args.searchId,
        status: "completed",
        message: `Search completed - No ${args.keywords[0]} found in ${args.location} within ${args.radius} miles`,
        progress: {
          discovered: 0,
          enriched: 0,
          analyzed: 0,
          total: 0,
        },
        priority: 3,
      });

      console.log(`Search with zero results completed successfully: ${args.searchId}`);
      
    } catch (error) {
      console.error(`Failed to complete search with zero results ${args.searchId}:`, error);
      
      await ctx.db.patch(args.searchId, {
        status: STATUS.SEARCH.FAILED,
        error: error instanceof Error ? error.message : "Failed to complete search",
      });
    }
  },
});

// Complete search and send notifications
export const completeSearch = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    console.log(`Completing search: ${args.searchId}`);
    
    try {
      const search = await ctx.db.get(args.searchId);
      
      if (!search) {
        console.error(`Search not found during completion: ${args.searchId}`);
        return;
      }

      // Get final search statistics
      const searchStats = await ctx.runQuery(internal.leads.internal.getSearchStatistics, {
        searchId: args.searchId,
      });

      // Update search status to completed
      await ctx.db.patch(args.searchId, {
        status: STATUS.SEARCH.COMPLETED,
        completedAt: Date.now(),
        results: {
          totalFound: searchStats.totalLeads,
          enrichedCount: searchStats.enrichedLeads,
          avgRelevanceScore: searchStats.avgRelevanceScore,
        },
        progress: {
          discovered: searchStats.totalLeads,
          enriched: searchStats.enrichedLeads,
          analyzed: searchStats.analyzedLeads,
          total: search.parameters.maxResults,
        },
      });

      // Broadcast real-time completion update
      await broadcastSearchUpdate(ctx, args.searchId, 'completed', `Search completed! Found ${searchStats.totalLeads} leads with ${searchStats.enrichedLeads} enriched contacts.`);

      // Send completion notification
      await ctx.db.insert("notifications", {
        userId: search.userId,
        type: "search_completed",
        title: "Search Completed! 🎉",
        message: `Your search "${search.name}" has completed successfully. Found ${searchStats.totalLeads} leads with ${searchStats.enrichedLeads} enriched contacts.`,
        data: {
          searchId: args.searchId,
          searchName: search.name,
          totalFound: searchStats.totalLeads,
          enrichedCount: searchStats.enrichedLeads,
          analyzedCount: searchStats.analyzedLeads,
        },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      console.log(`Search ${args.searchId} completed successfully with ${searchStats.totalLeads} leads`);

    } catch (error) {
      console.error(`Error completing search ${args.searchId}:`, error);
      
      // Broadcast failure update
      await broadcastSearchUpdate(ctx, args.searchId, 'failed', `Search failed during completion: ${error instanceof Error ? error.message : "Unknown error"}`);
      
      await ctx.db.patch(args.searchId, {
        status: STATUS.SEARCH.FAILED,
        error: error instanceof Error ? error.message : "Completion failed",
        completedAt: Date.now(),
      });
    }
  },
});

// Helper function to check if discovery is complete with user warning logic
async function checkDiscoveryComplete(ctx: any, searchId: string): Promise<{
  isComplete: boolean;
  shouldWarnUser: boolean;
  timeRemaining: number;
  leadCount: number;
}> {
  const search = await ctx.db.get(searchId);
  
  if (!search) {
    return { isComplete: false, shouldWarnUser: false, timeRemaining: 0, leadCount: 0 };
  }

  // Check if we have discovered any leads
  const leadCount = await ctx.runQuery(internal.leads.internal.getLeadCount, {
    searchId,
  });

  const timeSinceStart = Date.now() - search.createdAt;
  const maxDiscoveryTime = 5 * 60 * 1000; // 5 minutes
  const warningThreshold = 2 * 60 * 1000; // Warn after 2 minutes
  const timeRemaining = maxDiscoveryTime - timeSinceStart;

  // Discovery is complete if we have leads or if enough time has passed
  const hasLeads = leadCount > 0;
  const timeExpired = timeSinceStart > maxDiscoveryTime;
  const isComplete = hasLeads || timeExpired;

  // Should warn user if discovery is taking longer than 2 minutes and still in progress
  const shouldWarnUser = !isComplete && timeSinceStart > warningThreshold && 
    !(search.lastWarningAt && (Date.now() - search.lastWarningAt) < 60000); // Don't spam warnings

  // Update last warning time if we're sending a warning
  if (shouldWarnUser) {
    await ctx.db.patch(searchId, {
      lastWarningAt: Date.now(),
    });
  }

  return { 
    isComplete, 
    shouldWarnUser, 
    timeRemaining: Math.max(0, timeRemaining),
    leadCount 
  };
}

// Manual trigger for stuck searches
export const rescueStuckSearch = internalMutation({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    console.log(`Rescuing potentially stuck search: ${args.searchId}`);
    
    const search = await ctx.db.get(args.searchId);
    
    if (!search) {
      return { success: false, error: "Search not found" };
    }

    // Force orchestration regardless of current status
    await ctx.scheduler.runAfter(0, internal.search.orchestrator.orchestrateSearchPipeline, {
      searchId: args.searchId,
    });

    return { success: true, message: "Search rescue triggered" };
  },
});

// High-frequency priority queue processor for real-time responsiveness
export const processPriorityQueues = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      // Process active searches that might need pipeline advancement
      const activeSearches = await ctx.db
        .query("searches")
        .withIndex("by_status", (q) => q.eq("status", "in_progress"))
        .order("desc") // Process newest first
        .take(5);

      let processedSearches = 0;

      for (const search of activeSearches) {
        try {
          // Check if this search has been idle for more than 2 minutes
          const lastUpdate = search.completedAt || search.startedAt || search.createdAt;
          const lastOrchestration = search.lastOrchestrationAt || 0;
          const idleTime = Date.now() - lastUpdate;
          const orchestrationGap = Date.now() - lastOrchestration;
          
          // Only trigger if idle for >2 minutes AND no orchestration in last 30 seconds
          if (idleTime > 2 * 60 * 1000 && orchestrationGap > 30 * 1000) {
            // Trigger orchestration to check pipeline status
            await ctx.scheduler.runAfter(0, internal.search.orchestrator.orchestrateSearchPipeline, {
              searchId: search._id,
            });
            processedSearches++;
          }
        } catch (error) {
          console.error(`Error processing search ${search._id} in priority queue:`, error);
          // Continue with other searches even if one fails
        }
      }

      // Process high-priority enrichment queues
      await ctx.runMutation(internal.leads.enrichment.processEnrichmentQueue, {
        priority: true,
      });

      console.log(`Priority queues processed: ${processedSearches} searches checked`);
      return { processedSearches };

    } catch (error) {
      console.error("Error in priority queue processing:", error);
      return { error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});

// Cleanup expired orchestration locks
export const cleanupExpiredLocks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    // Find searches with expired locks
    const stalledSearches = await ctx.db
      .query("searches")
      .filter((q) => 
        q.and(
          q.neq(q.field("orchestrationLock"), null),
          q.lt(q.field("orchestrationLockExpiry"), now)
        )
      )
      .take(10);

    let cleanedCount = 0;

    for (const search of stalledSearches) {
      await ctx.db.patch(search._id, {
        orchestrationLock: undefined,
        orchestrationLockExpiry: undefined,
      });
      
      // Re-trigger orchestration for unlocked search
      await ctx.scheduler.runAfter(0, internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId: search._id,
      });
      
      cleanedCount++;
    }

    return { cleanedCount };
  },
});

