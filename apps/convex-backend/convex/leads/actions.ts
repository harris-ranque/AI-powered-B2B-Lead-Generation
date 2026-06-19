import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { Doc } from "../_generated/dataModel";
import {
  createCorrelationContext,
  createChildContext,
  logWithCorrelation,
  startPerformanceTracking,
  endPerformanceTracking,
  OPERATION_TYPES,
  createBatchCorrelationContext,
} from "../lib/correlation";
import {
  createEnrichmentService,
  EnrichmentProviderFactory
} from "./enrichment/provider";
import {
  shouldBlockPipeline,
} from "../lib/apiErrors";
import {
  checkFindyMailCreditsHealth,
  checkOpenAIHealth,
  checkPerplexityHealth,
  isBlockingHealthResult,
  mapHealthCheckToApiError,
  apiErrorToBlockMutationArgs,
} from "../lib/providerHealthCheck";
import { getSingleProviderError } from "../lib/errorMessages";

// Import enrichment types
import { EnrichmentBatchResult, EnrichmentOptions } from "./enrichment/types";

// Import Workpool for batch enrichment
import { enrichmentPool, generateBatchId } from "./workpool";
import { isMultiContactPipelineEnabled } from "../lib/featureFlags";
import {
  normalizeCompanyResearchPayload,
  isValidCompanyResearchCache,
} from "../lib/companyResearchCache";

type LangGraphResponse = {
  status: string;
  result?: {
    relevance_score?: number;
    pain_points_identified?: string[];
    value_matches?: string[];
    recommendations?: string[];
    lead_analysis?: Record<string, any>;
    processing_time?: number;
    agent_results?: Array<{
      agentName: string;
      role: string;
      output: string;
      confidenceScore: number;
      executionTime: number;
    }>;
    primary_email?: {
      subject: string;
      body: string;
      personalization_notes?: string[];
      estimated_effectiveness?: number;
    };
  };
  error?: string;
};

// Helper function to extract domain from URL
function extractDomain(url?: string): string {
  if (!url) return "";
  try {
    const parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsedUrl.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0] || "";
  }
}

// Helper function to process single lead with LangGraph
async function processLeadWithLangGraph(
  lead: any,
  profile: any,
  langgraphUrl: string,
  langgraphApiKey: string,
  searchId: string,
  retryAttempts: number = 3,
): Promise<{ success: boolean; result?: any; error?: string; leadId: any }> {
  // Create correlation context for individual lead analysis
  const leadCorrelation = createCorrelationContext(
    OPERATION_TYPES.LANGGRAPH_API,
    "system",
    {
      searchId,
      leadId: lead._id,
      metadata: {
        businessName: lead.businessName,
        maxRetries: retryAttempts,
      },
    },
  );

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    const attemptCorrelation = createChildContext(
      leadCorrelation,
      OPERATION_TYPES.LANGGRAPH_API,
      {
        metadata: {
          attempt,
          maxAttempts: retryAttempts,
        },
      },
    );

    const attemptPerf = startPerformanceTracking();

    try {
      logWithCorrelation(
        "info",
        attemptCorrelation,
        "🤖 Starting LangGraph Lead Analysis",
        {
          businessName: lead.businessName,
          attempt,
          maxAttempts: retryAttempts,
          hasWebsite: !!lead.website,
          hasContactInfo: !!lead.contactInfo?.emails?.length,
        },
      );

      // Prepare enhanced lead data for LangGraph
      const leadData = {
        id: lead._id,
        company_name: lead.businessName,
        contact_name: lead.contactInfo?.contacts?.[0]?.name || "",
        title: lead.contactInfo?.contacts?.[0]?.title || "",
        industry: lead.category || "",
        company_size:
          lead.contactInfo?.contacts?.[0]?.company_size ||
          (lead.reviewCount && lead.reviewCount > 50
            ? "Medium"
            : lead.reviewCount && lead.reviewCount > 10
              ? "Small"
              : "Micro"),
        location: `${lead.location.city || ""}, ${lead.location.state || ""}`
          .trim()
          .replace(/^,\s*/, ""),
        description:
          lead.enrichmentData?.description || lead.category
            ? `${lead.category} business`
            : "",
        website: lead.website || "",
        contact_info: {
          email: lead.contactInfo?.emails?.[0]?.email || "",
          phone: lead.phone || "",
          linkedin: lead.contactInfo?.socialProfiles?.linkedin || "",
          website: lead.website || "",
        },
        revenue:
          lead.enrichmentData?.estimated_revenue ||
          (lead.reviewCount && lead.reviewCount > 100
            ? "High"
            : lead.reviewCount && lead.reviewCount > 20
              ? "Medium"
              : "Low"),
        technologies: lead.enrichmentData?.technologies || [],
        pain_points: lead.enrichmentData?.pain_points || [],
        // Additional context from enrichment
        rating: lead.rating || 0,
        review_count: lead.reviewCount || 0,
        social_profiles: lead.contactInfo?.socialProfiles || {},
        contact_emails: lead.contactInfo?.emails || [],
        all_contacts: lead.contactInfo?.contacts || [],
      };

      // Call LangGraph for analysis and email generation
      const response = await fetch(`${langgraphUrl}/generate-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${langgraphApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: `${searchId}_${lead._id}_${attempt}`,
          lead: leadData,
          business_profile: {
            company_name: profile.companyName,
            industry: profile.industry,
            value_proposition: profile.valueProposition,
            services: profile.services,
            target_markets: profile.targetMarkets,
            key_differentiators: profile.keyDifferentiators,
            case_studies: [],
            contact_info: profile.contactInfo,
          },
          requirements: {
            tone: "professional",
            length: "medium",
            call_to_action: "Schedule a discovery call",
            include_case_study: false,
            personalization_level: "high",
            follow_up_sequence: true, // Enable follow-up email sequence generation
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LangGraph API error ${response.status}: ${errorText}`);
      }

      const result = (await response.json()) as LangGraphResponse;

      if (result.status === "completed" && result.result) {
        const perfData = endPerformanceTracking(attemptPerf);
        
        logWithCorrelation(
          "info",
          attemptCorrelation,
          "✅ LangGraph Analysis Successful",
          {
            businessName: lead.businessName,
            attempt,
            durationMs: perfData?.duration || 0,
            relevanceScore: result.result.relevance_score,
            hasEmail: !!result.result.primary_email,
          },
        );
        
        return {
          success: true,
          result: result.result,
          leadId: lead._id,
        };
      } else {
        throw new Error(result.error || "LangGraph analysis failed");
      }
    } catch (error) {
      const perfData = endPerformanceTracking(attemptPerf);
      
      logWithCorrelation(
        "error",
        attemptCorrelation,
        "❌ LangGraph Analysis Failed",
        {
          businessName: lead.businessName,
          attempt,
          maxAttempts: retryAttempts,
          durationMs: perfData?.duration || 0,
          willRetry: attempt < retryAttempts,
          backoffDelay: attempt < retryAttempts ? Math.pow(2, attempt) * 1000 : 0,
        },
        error as Error,
      );

      if (attempt === retryAttempts) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          leadId: lead._id,
        };
      }

      // Exponential backoff delay
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000),
      );
    }
  }

  return {
    success: false,
    error: "Max retries exceeded",
    leadId: lead._id,
  };
}

// Enrich leads with contact information using FindyMail
export const enrichLeads: any = action({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Create correlation context for enrichment phase
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LEAD_ENRICHMENT,
      "system", // Will be updated with actual userId
      {
        searchId: args.searchId,
        metadata: {
          stage: "lead_enrichment",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    logWithCorrelation(
      "info",
      correlation,
      "🚀 PHASE 2 START: Lead Enrichment Phase Beginning",
      {
        searchId: args.searchId,
        timestamp: new Date().toISOString(),
      },
    );

    try {

      // Get search and user info
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        {
          searchId: args.searchId,
        },
      );

      if (!search) {
        logWithCorrelation(
          "error",
          correlation,
          "❌ PHASE 2 FAILED: Search record not found",
          { searchId: args.searchId },
        );
        throw new Error("Search not found");
      }

      // Update correlation with actual userId
      correlation.userId = search.userId;

      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: search.userId,
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Early exit if search cancelled or user paused
      if (search.status === "cancelled" || user.processingPaused) {
        await ctx.runMutation(
          internal.search.internal.updateSearchStatusInternal,
          {
            searchId: args.searchId,
            status: "cancelled",
            error: user.processingPaused
              ? user.pauseReason || "User processing paused by admin"
              : undefined,
          },
        );
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: args.searchId,
            stage: "cancelled",
            progress: 0,
            message: user.processingPaused
              ? user.pauseReason || "User processing paused by admin"
              : "Search cancelled",
          },
        );
        return { success: false, message: "Cancelled" } as any;
      }

      // Get leads that need enrichment (new + linked prior-account businesses)
      const leads: any = await ctx.runQuery(
        internal.leads.internal.getLeadsForEnrichment,
        {
          searchId: args.searchId,
        },
      );

      if (leads.length === 0) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ PHASE 2 COMPLETE: No Leads to Enrich - Skipping to Analysis",
          {
            reason: "zero_leads_for_enrichment",
            nextPhase: "ai_analysis",
          },
        );

        // No leads to enrich, proceed to analysis
        await ctx.scheduler.runAfter(0, "leads/actions:analyzeLeads" as any, {
          searchId: args.searchId,
        });
        return {
          success: true,
          message: "No leads to enrich",
          enrichedCount: 0,
        };
      }

      // Determine enrichment provider and API key
      const providerType = EnrichmentProviderFactory.getConfiguredProvider();
      let userApiKey: string | undefined;

      if (user.plan === "enterprise") {
        try {
          const keyResult = await ctx.runAction(
            internal.userApiKeys.actions.getDecryptedApiKey,
            {
              provider: providerType,
              userId: user._id,
              purpose: "lead_enrichment",
            },
          );
          userApiKey = keyResult.apiKey;
        } catch (error) {
          // For enterprise users, API keys are required
          throw new Error(
            getSingleProviderError(providerType, "lead enrichment")
          );
        }
      }

      // Pre-flight FindyMail credits/auth check before enqueueing enrichment work
      if (providerType === "findymail") {
        const apiKeyForCheck =
          userApiKey ?? process.env.FINDYMAIL_API_KEY ?? undefined;

        if (apiKeyForCheck) {
          const health = await checkFindyMailCreditsHealth(apiKeyForCheck);

          if (isBlockingHealthResult(health)) {
            const apiError = mapHealthCheckToApiError("findymail", health);

            if (shouldBlockPipeline(apiError)) {
              logWithCorrelation(
                "error",
                correlation,
                "🚨 FindyMail pre-flight check failed — blocking enrichment",
                {
                  status: health.status,
                  message: health.message,
                  errorCode: apiError.errorCode,
                },
              );

              await ctx.runMutation(
                internal.leads.enrichment.checkpoint.handlePipelineBlockingError,
                {
                  searchId: args.searchId,
                  userId: search.userId,
                  errorCode: apiError.errorCode,
                  errorMessage: apiError.userMessage,
                  provider: apiError.provider,
                  category: apiError.category,
                  severity: apiError.severity,
                  suggestedAction: apiError.suggestedAction,
                  actionUrl: apiError.actionUrl,
                  actionLabel: apiError.actionLabel,
                  originalStatus: apiError.originalStatus,
                  correlationId: correlation.correlationId,
                },
              );

              return {
                success: false,
                message: apiError.userMessage,
                blocked: true,
                errorCode: apiError.errorCode,
              };
            }
          }
        }
      }

      const requestedRoles = Array.isArray(search.parameters?.roles)
        ? search.parameters.roles.filter((role: unknown): role is string =>
            typeof role === "string" && role.trim().length > 0,
          )
        : undefined;

      const enrichmentOptions: EnrichmentOptions | undefined = requestedRoles
        ? { roles: requestedRoles }
        : undefined;

      logWithCorrelation(
        "info",
        correlation,
        "📋 Lead Enrichment Configuration (Workpool)",
        {
          totalLeadsToEnrich: leads.length,
          userPlan: user.plan,
          enrichmentProvider: providerType,
          apiKeySource: user.plan === "enterprise" && userApiKey ? "user_provided" : "system",
          maxConcurrency: 25, // Workpool handles global parallelism
          perApiKeyConcurrency: 5, // Semaphore handles per-key limiting
          architecture: "workpool_hybrid",
          estimatedDuration: `${Math.ceil((leads.length * 4) / 25 / 60)} minutes`, // ~4s per lead, 25 concurrent max
        },
      );

      // ========================================================================
      // WORKPOOL BATCH ENRICHMENT (Enterprise-Grade Queue Management)
      // ========================================================================
      // Workpool provides:
      // - maxParallelism: 25 - Supports ~5 concurrent users with their own API keys
      // - Automatic retry with exponential backoff (5 attempts, 2s/4s/8s/16s/32s)
      // - Built-in completion tracking via onComplete handler
      // - Race-safe phase transition (no duplicate analysis triggers)
      //
      // Semaphore still handles per-API-key rate limiting (5 concurrent per key)
      // ========================================================================

      // Generate unique batch ID for tracking
      const batchId = generateBatchId(args.searchId);

      logWithCorrelation(
        "info",
        correlation,
        "🚀 Enqueueing Leads to Workpool for Enrichment",
        {
          totalLeads: leads.length,
          batchId,
          architecture: "workpool_with_semaphore",
          globalMaxParallelism: 25,
          perApiKeyLimit: 5,
          retryConfig: "5 attempts with exponential backoff (2s base)",
          estimatedDuration: `${Math.ceil((leads.length * 4) / 25 / 60)} minutes`,
        },
      );

      // Enqueue all leads to Workpool using Promise.all for parallel enqueueing
      // Each lead gets its own onComplete handler for progress tracking
      let workIds: string[] = [];
      try {
        const enqueuePromises = leads.map(async (lead: any) => {
          const workId = await enrichmentPool.enqueueAction(
            ctx,
            internal.leads.asyncEnrichment.enrichSingleLeadWorkpool,
            {
              leadId: lead._id,
              searchId: args.searchId,
              userId: search.userId,
              roles: requestedRoles,
              userApiKey,
              reenrichForSearch: Boolean(lead.reenrichForSearch),
            },
            {
              // Context passed to onComplete handler for tracking
              context: {
                searchId: args.searchId,
                userId: search.userId,
                leadId: lead._id,
                batchId,
              },
              onComplete: internal.leads.workpool.onEnrichmentComplete,
            }
          );
          return String(workId);
        });

        workIds = await Promise.all(enqueuePromises);
      } catch (error) {
        logWithCorrelation(
          "error",
          correlation,
          "❌ Failed to enqueue leads to Workpool",
          { batchId, error: error instanceof Error ? error.message : "Unknown error" },
          error as Error,
        );
        throw error;
      }

      // Initialize batch tracker in database
      await ctx.runMutation(internal.leads.workpool.initEnrichmentBatch, {
        batchId,
        searchId: args.searchId,
        userId: search.userId,
        totalLeads: leads.length,
        workIds: workIds.map(id => String(id)),
      });

      const performanceData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 2 SCHEDULING COMPLETE: All Leads Enqueued to Workpool",
        {
          totalLeads: leads.length,
          enqueuedCount: workIds.length,
          batchId,
          architecture: "workpool_hybrid",
          globalParallelism: 25,
          perApiKeyLimit: 5,
          retryConfig: "exponential backoff (2s, 4s, 8s, 16s, 32s)",
          estimatedCompletionTime: `${Math.ceil((leads.length * 4) / 25 / 60)} minutes`,
          schedulingDurationMs: performanceData?.duration || 0,
          nextPhase: "ai_analysis_after_enrichment",
          note: "Workpool onComplete handler will trigger analysis when all leads done",
        },
      );

      // Broadcast initial progress (leads enqueued, processing will happen async)
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: search.userId,
          searchId: args.searchId,
          stage: "enrichment",
          progress: 0, // 0% enriched (enqueued but not complete yet)
          message: `Enqueued ${workIds.length} leads for enrichment via Workpool`,
          data: {
            progress: {
              discovered: leads.length,
              enriched: 0, // None complete yet
              analyzed: 0,
              enqueued: workIds.length,
              total: leads.length,
            },
            workpoolBatch: {
              batchId,
              workIds: workIds.length,
            },
          },
        },
      );

      // NOTE: We do NOT call analyzeLeads here because enrichment hasn't finished yet!
      // The Workpool onComplete handler (onEnrichmentComplete) will trigger analysis
      // when all leads are complete - race-safe with atomic batch tracking

      logWithCorrelation(
        "info",
        correlation,
        "ℹ️  AI Analysis will trigger automatically via Workpool onComplete",
        {
          enqueuedLeads: workIds.length,
          batchId,
          note: "Workpool tracks completion and triggers analysis when all leads done",
        },
      );

      return {
        success: true,
        message: `Enqueued ${workIds.length}/${leads.length} leads via Workpool`,
        enqueuedCount: workIds.length,
        batchId,
        totalLeads: leads.length,
        enrichmentProvider: providerType,
        architecture: "workpool_hybrid",
        note: "Enrichment will complete asynchronously via Workpool with automatic retry",
      };
    } catch (error) {
      const performanceData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "error",
        correlation,
        "💥 PHASE 2 FAILED: Lead Enrichment Scheduling Error",
        {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          duration: performanceData?.duration || 0,
          searchId: args.searchId,
        },
        error as Error,
      );

      // Update search status to failed (internal to bypass auth in actions)
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "failed",
          error: error instanceof Error ? error.message : "Enrichment scheduling failed",
        },
      );

      throw error;
    }
  },
});

/**
 * Resume enrichment from checkpoint
 *
 * Called when user wants to resume enrichment after a pipeline-blocking error
 * (credits exhausted, subscription paused) has been resolved.
 *
 * Flow:
 * 1. Check if resumable checkpoint exists
 * 2. Get checkpoint status for logging
 * 3. Clear the checkpoint
 * 4. Trigger enrichment for remaining leads (unprocessed)
 */
export const resumeEnrichment: any = action({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Create correlation context
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LEAD_ENRICHMENT,
      "system",
      {
        searchId: args.searchId,
        metadata: {
          stage: "resume_enrichment",
        },
      },
    );

    logWithCorrelation(
      "info",
      correlation,
      "🔄 Attempting to resume enrichment from checkpoint",
      { searchId: args.searchId },
    );

    // Get search info
    const search = await ctx.runQuery(
      internal.search.internal.getSearchInternal,
      { searchId: args.searchId },
    );

    if (!search) {
      throw new Error("Search not found");
    }

    // Check for resumable checkpoint
    const checkpointStatus = await ctx.runQuery(
      internal.leads.enrichment.checkpoint.getCheckpoint,
      { searchId: args.searchId },
    );

    if (!checkpointStatus) {
      logWithCorrelation(
        "warn",
        correlation,
        "⚠️ No checkpoint found - starting fresh enrichment",
        { searchId: args.searchId },
      );

      // No checkpoint, just trigger normal enrichment
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["leads/actions"].enrichLeads,
        { searchId: args.searchId }
      );

      return {
        success: true,
        resumed: false,
        message: "No checkpoint found - started fresh enrichment",
      };
    }

    if (!checkpointStatus.resumable) {
      throw new Error(
        `Checkpoint is not resumable: ${checkpointStatus.errorMessage || "Unknown reason"}`
      );
    }

    logWithCorrelation(
      "info",
      correlation,
      "📋 Found resumable checkpoint",
      {
        searchId: args.searchId,
        lastProcessedIndex: checkpointStatus.lastProcessedIndex,
        totalLeads: checkpointStatus.totalLeads,
        enrichedCount: checkpointStatus.enrichedCount,
        noContactsCount: checkpointStatus.noContactsCount,
        failedCount: checkpointStatus.failedCount,
        remainingLeads: checkpointStatus.totalLeads - checkpointStatus.lastProcessedIndex - 1,
        errorCode: checkpointStatus.errorCode,
      },
    );

    // Clear the checkpoint since we're resuming
    await ctx.runMutation(
      internal.leads.enrichment.checkpoint.clearCheckpoint,
      { searchId: args.searchId },
    );

    logWithCorrelation(
      "info",
      correlation,
      "✅ Checkpoint cleared - triggering enrichment for remaining leads",
      { searchId: args.searchId },
    );

    // Trigger enrichment for remaining leads
    // The enrichLeads action will naturally only process unprocessed (pending) leads
    await ctx.scheduler.runAfter(
      0,
      (internal as any)["leads/actions"].enrichLeads,
      { searchId: args.searchId }
    );

    return {
      success: true,
      resumed: true,
      message: "Enrichment resumed from checkpoint",
      previousProgress: {
        lastProcessedIndex: checkpointStatus.lastProcessedIndex,
        totalLeads: checkpointStatus.totalLeads,
        enrichedCount: checkpointStatus.enrichedCount,
        noContactsCount: checkpointStatus.noContactsCount,
        failedCount: checkpointStatus.failedCount,
        remainingLeads: checkpointStatus.totalLeads - checkpointStatus.lastProcessedIndex - 1,
      },
      previousError: {
        code: checkpointStatus.errorCode,
        message: checkpointStatus.errorMessage,
      },
    };
  },
});

// Analyze leads using LangGraph AI system (Async Fire-and-Forget Architecture)
// NOTE: This is an internalAction because it's only called from internal contexts
// (workpool completion handlers, dead letter processor, monitoring recovery)
export const analyzeLeads: any = internalAction({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Create correlation context for AI analysis phase
    const correlation = createCorrelationContext(
      OPERATION_TYPES.AI_ANALYSIS,
      "system", // Will be updated with actual userId
      {
        searchId: args.searchId,
        metadata: {
          stage: "ai_analysis_async",
          architecture: "fire_and_forget",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();

    logWithCorrelation(
      "info",
      correlation,
      "🚀 PHASE 3 START: AI Analysis Phase Beginning (Async Architecture)",
      {
        searchId: args.searchId,
        timestamp: new Date().toISOString(),
        architecture: "webhook_based",
        maxConcurrency: "unlimited",
      },
    );

    try {

      // Get search and user info
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        {
          searchId: args.searchId,
        },
      );

      if (!search) {
        logWithCorrelation(
          "error",
          correlation,
          "❌ PHASE 3 FAILED: Search record not found",
          { searchId: args.searchId },
        );
        throw new Error("Search not found");
      }

      // Update correlation with actual userId
      correlation.userId = search.userId;

      // Fetch user for pause checks
      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: search.userId,
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Early exit if cancelled or paused
      if (search.status === "cancelled" || user.processingPaused) {
        await ctx.runMutation(
          internal.search.internal.updateSearchStatusInternal,
          {
            searchId: args.searchId,
            status: "cancelled",
            error: user.processingPaused
              ? user.pauseReason || "User processing paused by admin"
              : undefined,
          },
        );
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: args.searchId,
            stage: "cancelled",
            progress: 0,
            message: user.processingPaused
              ? user.pauseReason || "User processing paused by admin"
              : "Search cancelled",
          },
        );
        return { success: false, message: "Cancelled" } as any;
      }

      logWithCorrelation(
        "info",
        correlation,
        "🎯 PHASE 3 START: AI Analysis Pipeline",
        {
          searchId: args.searchId,
          note: "Health check already validated by search orchestrator",
        },
      );

      // Get leads or contacts ready for analysis
      const multiContact = isMultiContactPipelineEnabled();
      const leads: any = multiContact
        ? await ctx.runQuery(
            internal.leads.contactInternal.getContactsForAnalysis,
            { searchId: args.searchId },
          )
        : await ctx.runQuery(
            internal.leads.internal.getLeadsForAnalysis,
            { searchId: args.searchId },
          );

      // LangGraph service configuration
      const langgraphUrl = process.env.LANGGRAPH_URL;
      const langgraphApiKey = process.env.LANGGRAPH_API_KEY;

      logWithCorrelation(
        "info",
        correlation,
        "📋 AI Analysis Configuration (Batch Processing)",
        {
          totalLeadsToAnalyze: leads.length,
          leadsWithContactName: leads.filter((l: any) => l.contactInfo?.contacts?.[0]?.name).length,
          leadsWithoutContactName: leads.filter((l: any) => !l.contactInfo?.contacts?.[0]?.name).length,
          architecture: "batch_processing",
          batchSize: 100,
          webhookBased: true,
          langgraphUrl: langgraphUrl?.includes("localhost") ? "local" : "production",
          scalability: "unlimited batches supported",
        },
      );

      if (leads.length === 0) {
        const readiness = await ctx.runQuery(
          internal.search.internal.getSearchCompletionReadinessInternal,
          { searchId: args.searchId },
        );

        if (!readiness.ready) {
          logWithCorrelation(
            "info",
            correlation,
            "⏳ No contacts queued for analysis — Write Emails still in progress or pending",
            {
              reason: readiness.reason,
              inProgress: readiness.inProgress,
              total: readiness.total,
            },
          );
          return {
            success: true,
            message: "Analysis in progress or not ready for completion",
            scheduledCount: 0,
          };
        }

        const contactsStillNeedingWork = await ctx.runQuery(
          internal.leads.contactInternal.getContactsForAnalysis,
          { searchId: args.searchId },
        );

        if (contactsStillNeedingWork.length > 0) {
          logWithCorrelation(
            "warn",
            correlation,
            "⚠️ Contacts need analysis but were not scheduled — re-queuing Write Emails",
            {
              contactCount: contactsStillNeedingWork.length,
            },
          );

          await ctx.scheduler.runAfter(
            0,
            "leads/actions:analyzeLeads" as any,
            { searchId: args.searchId },
          );

          return {
            success: true,
            message: "Re-scheduled analysis for contacts awaiting Write Emails",
            scheduledCount: 0,
          };
        }

        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ PHASE 3 COMPLETE: No pending analysis work - Completing Search",
          {
            reason: readiness.reason,
            nextPhase: "search_completion",
          },
        );

        await ctx.scheduler.runAfter(
          0,
          "search/actions:completeSearch" as any,
          {
            searchId: args.searchId,
          },
        );
        return {
          success: true,
          message: "No leads to analyze",
          scheduledCount: 0,
        };
      }

      // Get user's business profile for AI context (no auth in actions)
      const profile = await ctx.runQuery(
        api.profile.queries.getProfileByUserId,
        { userId: search.userId as any },
      );

      if (!profile) {
        throw new Error("Business profile required for AI analysis");
      }

      let openaiKey = process.env.OPENAI_API_KEY;
      let perplexityKey = process.env.PERPLEXITY_API_KEY;

      if (user.plan === "enterprise") {
        try {
          const enterpriseKeys = await ctx.runAction(
            internal.userApiKeys.actions.resolveUserProviderKeys,
            {
              userId: user._id,
              purpose: "langgraph_lead_analysis",
            },
          );
          if (enterpriseKeys.openai) {
            openaiKey = enterpriseKeys.openai;
          }
          if (enterpriseKeys.perplexity) {
            perplexityKey = enterpriseKeys.perplexity;
          }
        } catch {
          // Fall back to platform keys
        }
      }

      if (!openaiKey) {
        throw new Error("OpenAI API key not configured for AI analysis");
      }

      const openaiHealth = await checkOpenAIHealth(openaiKey);
      if (isBlockingHealthResult(openaiHealth)) {
        const openaiApiError = mapHealthCheckToApiError("openai", openaiHealth);
        if (shouldBlockPipeline(openaiApiError)) {
          logWithCorrelation(
            "error",
            correlation,
            "🚨 OpenAI pre-flight check failed — blocking analysis",
            {
              status: openaiHealth.status,
              message: openaiHealth.message,
              errorCode: openaiApiError.errorCode,
            },
          );

          await ctx.runMutation(internal.search.internal.blockSearchWithApiError, {
            searchId: args.searchId,
            userId: search.userId,
            ...apiErrorToBlockMutationArgs(openaiApiError),
            operationType: "ai_analysis",
            correlationId: correlation.correlationId,
            pipelineStage: "ai_personalization",
          });

          return {
            success: false,
            message: openaiApiError.userMessage,
            blocked: true,
            errorCode: openaiApiError.errorCode,
          };
        }
      }

      if (perplexityKey) {
        const perplexityHealth = await checkPerplexityHealth(perplexityKey);
        if (isBlockingHealthResult(perplexityHealth)) {
          const perplexityApiError = mapHealthCheckToApiError(
            "perplexity",
            perplexityHealth,
          );
          if (shouldBlockPipeline(perplexityApiError)) {
            logWithCorrelation(
              "error",
              correlation,
              "🚨 Perplexity pre-flight check failed — blocking analysis",
              {
                status: perplexityHealth.status,
                message: perplexityHealth.message,
                errorCode: perplexityApiError.errorCode,
              },
            );

            await ctx.runMutation(internal.search.internal.blockSearchWithApiError, {
              searchId: args.searchId,
              userId: search.userId,
              ...apiErrorToBlockMutationArgs(perplexityApiError),
              operationType: "ai_analysis",
              correlationId: correlation.correlationId,
              pipelineStage: "ai_personalization",
            });

            return {
              success: false,
              message: perplexityApiError.userMessage,
              blocked: true,
              errorCode: perplexityApiError.errorCode,
            };
          }
        }
      }

      if (leads.length > 0) {
        await ctx.runAction(
          (internal as any)["leads/asyncAnalysis"].ensureCompanyResearchForSearch,
          {
            searchId: args.searchId,
            userId: search.userId,
          },
        );
      }

      if (!langgraphUrl || !langgraphApiKey) {
        throw new Error("LangGraph service not configured");
      }

      // ========================================================================
      // BATCH SCHEDULING (100 leads per batch)
      // ========================================================================
      // Divide leads into batches of 100
      // Each batch gets its own action that calls the batch endpoint
      // Webhooks handle progress updates and final results
      // ========================================================================

      // Helper function to divide leads into batches
      function chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
          chunks.push(array.slice(i, i + size));
        }
        return chunks;
      }

      const BATCH_SIZE = 100;
      const batches = chunkArray(leads, BATCH_SIZE);

      logWithCorrelation(
        "info",
        correlation,
        "🚀 Scheduling Lead Batches for Analysis",
        {
          totalLeads: leads.length,
          batchSize: BATCH_SIZE,
          totalBatches: batches.length,
          architecture: "batch_processing",
          webhookBased: true,
          estimatedSchedulingTime: batches.length * 10, // ~10ms per batch
        },
      );

      let scheduledBatches = 0;
      let schedulingErrors = 0;

      // Schedule each batch with a 10-second stagger
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        if (!batch) continue; // Type guard for TypeScript
        const batchId = `${args.searchId}_batch_${i + 1}`;

        try {
          logWithCorrelation(
            "info",
            correlation,
            `📦 Scheduling Batch ${i + 1}/${batches.length}`,
            {
              batchId,
              leadsInBatch: batch.length,
              batchNumber: i + 1,
              totalBatches: batches.length,
            },
          );

          // Mark all items in batch as scheduled
          for (const item of batch) {
            const typedItem = item as any;
            if (multiContact) {
              await ctx.runMutation(
                internal.leads.contactInternal.markContactAnalysisScheduled,
                {
                  contactId: typedItem._id,
                  requestId: `${batchId}_${typedItem._id}`,
                },
              );
            } else {
              await ctx.runMutation(internal.leads.internal.markLeadAnalysisScheduled, {
                leadId: typedItem._id,
                requestId: `${batchId}_${typedItem._id}`,
              });
            }
          }

          // Schedule the batch analysis action
          await ctx.scheduler.runAfter(
            i * 10000, // 10-second stagger between batches
            (internal as any)["leads/asyncAnalysis"].analyzeLeadsBatch,
            {
              searchId: args.searchId,
              batchId,
              batchNumber: i + 1,
              ...(multiContact
                ? { contactIds: batch.map((c: any) => c._id) }
                : { leadIds: batch.map((l: any) => l._id) }),
              userId: search.userId,
              profileId: profile._id,
            },
          );

          scheduledBatches++;
        } catch (error) {
          schedulingErrors++;
          console.error(`Failed to schedule batch ${i + 1}:`, error);

          // Mark all items in failed batch as failed
          for (const item of batch) {
            const typedItem = item as any;
            if (multiContact) {
              await ctx.runMutation(
                internal.leads.contactInternal.markContactAnalysisFailed,
                {
                  contactId: typedItem._id,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Batch scheduling failed",
                },
              );
            } else {
              await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
                leadId: typedItem._id,
                error:
                  error instanceof Error ? error.message : "Batch scheduling failed",
              });
            }
          }

          // Broadcast scheduling error
          await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
            userId: search.userId,
            type: "batch_analysis_error",
            title: `Failed to schedule batch ${i + 1}/${batches.length}`,
            message: `Batch of ${batch.length} leads could not be scheduled`,
            data: {
              searchId: args.searchId,
              batchId,
              batchNumber: i + 1,
              leadsCount: batch.length,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            priority: "normal",
            tags: ["analysis", "error", "batch"],
          });
        }
      }

      const performanceData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 3 BATCH SCHEDULING COMPLETE",
        {
          totalLeads: leads.length,
          totalBatches: batches.length,
          scheduledBatches,
          schedulingErrors,
          schedulingSuccessRate: (scheduledBatches / batches.length) * 100,
          durationMs: performanceData?.duration || 0,
          averageTimePerBatch:
            batches.length > 0 ? (performanceData?.duration || 0) / batches.length : 0,
          nextPhase: "batch_webhook_processing",
          note: "Batches will process sequentially with progress webhooks every 10 leads",
        },
      );

      // Broadcast initial progress
      await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
        userId: search.userId,
        searchId: args.searchId,
        stage: "analysis",
        progress: 0, // 0% analyzed (scheduled but not started)
        message: `Scheduled ${scheduledBatches} batches (${leads.length} leads) for AI analysis`,
        data: {
          progress: {
            discovered: leads.length,
            enriched: leads.filter(
              (l: any) =>
                l.enrichmentStatus === "completed" ||
                l.enrichmentStatus === "completed_fallback",
            ).length,
            analyzed: 0, // None complete yet
            scheduledBatches,
            totalBatches: batches.length,
            total: leads.length,
          },
        },
      });

      // NOTE: We do NOT call completeSearch here!
      // The webhook handler will call it when all batches are processed

      return {
        success: true,
        message: `Scheduled ${scheduledBatches}/${batches.length} batches (${leads.length} leads) for analysis`,
        scheduledBatches,
        schedulingErrors,
        totalLeads: leads.length,
        totalBatches: batches.length,
        note: "Batches will complete asynchronously via webhooks with progress updates every 10 leads",
      };
    } catch (error) {
      const performanceData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "error",
        correlation,
        "💥 PHASE 3 FAILED: AI Analysis Scheduling Error",
        {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          duration: performanceData?.duration || 0,
        },
        error as Error,
      );

      // Update search status to failed
      await ctx.runMutation(internal.search.internal.updateSearchStatusInternal, {
        searchId: args.searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "AI analysis scheduling failed",
      });

      throw error;
    }
  },
});

// Populate company research cache once per lead domain before contact fan-out analysis.
export const runCompanyResearchOnce: ReturnType<typeof internalAction> = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{
    cached: boolean;
    companyResearchId?: string;
  }> => {
    const lead = await ctx.runQuery(internal.leads.internal.getLeadInternal, {
      leadId: args.leadId,
    });
    if (!lead?.website) {
      return { cached: false };
    }

    const domain = extractDomain(lead.website);
    if (!domain) {
      return { cached: false };
    }

    const existing = await ctx.runQuery(
      internal.leads.contactInternal.getCompanyResearchByDomain,
      { searchId: args.searchId, domain },
    );
    if (existing?.researchPayload && isValidCompanyResearchCache(existing.researchPayload)) {
      return { cached: true, companyResearchId: existing._id };
    }

    const aiAnalysis = lead.aiAnalysis as
      | {
          leadAnalysis?: Record<string, unknown>;
          researchTier?: string;
        }
      | undefined;
    const leadAnalysis = aiAnalysis?.leadAnalysis;
    if (!leadAnalysis) {
      return { cached: false };
    }

    const researchPayload = normalizeCompanyResearchPayload({
      company_overview:
        (leadAnalysis.company_overview as string | undefined) ??
        (leadAnalysis.research_summary as string | undefined),
      lead_analysis: leadAnalysis,
      comprehensive_report:
        (leadAnalysis.research_metadata as Record<string, unknown> | undefined)
          ?.comprehensive_report ?? leadAnalysis.comprehensive_report,
      research_tier: aiAnalysis?.researchTier,
      confidence_score:
        (leadAnalysis.research_metadata as Record<string, unknown> | undefined)
          ?.confidence_score,
    });

    if (!researchPayload) {
      return { cached: false };
    }

    const companyResearchId = await ctx.runMutation(
      internal.leads.contactInternal.upsertCompanyResearch,
      {
        searchId: args.searchId,
        userId: args.userId,
        leadId: args.leadId,
        domain,
        researchPayload,
        status: "completed",
        provider: aiAnalysis?.researchTier ?? "cached",
      },
    );

    await ctx.runMutation(
      internal.leads.contactInternal.linkContactsToCompanyResearch,
      { leadId: args.leadId, companyResearchId },
    );

    return { cached: true, companyResearchId };
  },
});

// ===== OLD BATCH PROCESSING CODE REMOVED =====
// Legacy helper references retained near top-of-file for enrichment batching
