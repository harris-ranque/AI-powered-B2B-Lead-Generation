import { action } from "../_generated/server";
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
import { getSingleProviderError } from "../lib/errorMessages";

// Import enrichment types
import { EnrichmentBatchResult, EnrichmentOptions } from "./enrichment/types";

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

      // Get leads that need enrichment
      const leads: any = await ctx.runQuery(
        internal.leads.internal.getUnenrichedLeads,
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
          maxConcurrency: 5,
          architecture: "workpool_controlled",
          estimatedDuration: `${Math.ceil((leads.length * 4) / 5 / 60)} minutes`, // ~4s per lead, 5 concurrent
        },
      );

      // ========================================================================
      // SCHEDULED ACTIONS WITH STAGGERED DELAYS (Rate-Limited Enrichment)
      // ========================================================================
      // Schedule all leads with 200ms delays between each to limit concurrency
      // ~5 concurrent at any time (FindyMail's limit)
      // Each lead gets inline fallback support (FindyMail → IcyPeas)
      // No timeout issues - each lead has its own 10-minute action timeout
      // ========================================================================

      logWithCorrelation(
        "info",
        correlation,
        "🚀 Scheduling All Leads for Async Enrichment (Staggered)",
        {
          totalLeads: leads.length,
          approximateConcurrency: 5,
          architecture: "scheduled_actions_staggered",
          staggerDelay: "200ms per lead",
          estimatedDuration: `${Math.ceil((leads.length * 4) / 5 / 60)} minutes`,
          inlineFallback: true,
          note: "200ms stagger approximates 5 concurrent limit",
        },
      );

      let scheduledCount = 0;
      let schedulingErrors = 0;

      // Schedule all leads with staggered delays (fire-and-forget)
      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        try {
          // Schedule with 200ms delay per lead to limit concurrency
          await ctx.scheduler.runAfter(
            i * 200, // 200ms stagger between leads
            (internal as any)["leads/asyncEnrichment"].enrichSingleLead,
            {
              leadId: lead._id,
              searchId: args.searchId,
              userId: search.userId,
              roles: requestedRoles,
              userApiKey,
            },
          );

          scheduledCount++;
        } catch (error) {
          schedulingErrors++;
          console.error(`Failed to schedule lead ${lead._id} for enrichment:`, error);

          // Mark lead as failed immediately
          await ctx.runMutation(
            internal.leads.internal.updateEnrichmentStatus,
            {
              leadId: lead._id,
              status: "failed",
              error: error instanceof Error ? error.message : "Scheduling failed",
            },
          );
        }
      }


      const performanceData = endPerformanceTracking(performanceTracker);

      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 2 SCHEDULING COMPLETE: All Leads Scheduled with Staggered Delays",
        {
          totalLeads: leads.length,
          scheduledCount,
          schedulingErrors,
          schedulingSuccessRate: (scheduledCount / leads.length) * 100,
          architecture: "scheduled_actions_staggered",
          staggerDelay: "200ms",
          approximateConcurrency: 5,
          estimatedCompletionTime: `${Math.ceil((leads.length * 4) / 5 / 60)} minutes`,
          schedulingDurationMs: performanceData?.duration || 0,
          nextPhase: "ai_analysis_after_enrichment",
          note: "Enrichment will complete asynchronously via scheduled actions",
        },
      );

      // Broadcast initial progress (leads scheduled, processing will happen async)
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: search.userId,
          searchId: args.searchId,
          stage: "enrichment",
          progress: 0, // 0% enriched (scheduled but not complete yet)
          message: `Scheduled ${scheduledCount} leads for enrichment`,
          data: {
            progress: {
              discovered: leads.length,
              enriched: 0, // None complete yet
              analyzed: 0,
              scheduled: scheduledCount,
              total: leads.length,
            },
          },
        },
      );

      // NOTE: We do NOT call analyzeLeads here because enrichment hasn't finished yet!
      // Each enrichment action will check if ALL enrichment is complete
      // The LAST enrichment action to finish will automatically trigger analyzeLeads

      logWithCorrelation(
        "info",
        correlation,
        "ℹ️  AI Analysis will trigger automatically when all enrichment completes",
        {
          scheduledLeads: scheduledCount,
          note: "Last enrichment action to complete will trigger analysis phase",
        },
      );

      return {
        success: true,
        message: `Scheduled ${scheduledCount}/${leads.length} leads for async enrichment`,
        scheduledCount,
        schedulingErrors,
        totalLeads: leads.length,
        enrichmentProvider: providerType,
        note: "Enrichment will complete asynchronously via scheduled actions",
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

// Analyze leads using LangGraph AI system (Async Fire-and-Forget Architecture)
export const analyzeLeads: any = action({
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

      // Get all leads for this search that have valid contact information
      // Only analyze leads with both email and contact name
      const allLeads: any = await ctx.runQuery(
        internal.leads.internal.getSearchLeadsInternal,
        {
          searchId: args.searchId,
        },
      );

      // Filter leads to only those with valid contact information
      const leads = allLeads.filter((lead: any) => {
        const hasEmail = lead.contactInfo?.emails?.length > 0;
        const hasContactName = lead.contactInfo?.contacts?.length > 0 &&
                              lead.contactInfo.contacts[0]?.name;
        return hasEmail && hasContactName;
      });

      const skippedLeads = allLeads.length - leads.length;
      if (skippedLeads > 0) {
        logWithCorrelation(
          "info",
          correlation,
          `📋 Filtering Leads for AI Analysis`,
          {
            totalLeads: allLeads.length,
            leadsWithContact: leads.length,
            skippedLeads,
            reason: "missing_email_or_contact_name",
          },
        );
      }

      // LangGraph service configuration
      const langgraphUrl = process.env.LANGGRAPH_URL;
      const langgraphApiKey = process.env.LANGGRAPH_API_KEY;

      logWithCorrelation(
        "info",
        correlation,
        "📋 AI Analysis Configuration (Batch Processing)",
        {
          totalLeadsToAnalyze: leads.length,
          architecture: "batch_processing",
          batchSize: 100,
          webhookBased: true,
          langgraphUrl: langgraphUrl?.includes("localhost") ? "local" : "production",
          scalability: "unlimited batches supported",
        },
      );

      if (leads.length === 0) {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ PHASE 3 COMPLETE: No Leads to Analyze - Completing Search",
          {
            reason: "zero_leads_for_analysis",
            nextPhase: "search_completion",
          },
        );

        // No leads to analyze, complete the search
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

          // Mark all leads in batch as scheduled
          for (const lead of batch) {
            const typedLead = lead as any; // Type assertion for filtered lead data
            await ctx.runMutation(internal.leads.internal.markLeadAnalysisScheduled, {
              leadId: typedLead._id,
              requestId: `${batchId}_${typedLead._id}`,
            });
          }

          // Schedule the batch analysis action
          await ctx.scheduler.runAfter(
            i * 10000, // 10-second stagger between batches
            (internal as any)["leads/asyncAnalysis"].analyzeLeadsBatch,
            {
              searchId: args.searchId,
              batchId,
              batchNumber: i + 1,
              leadIds: batch.map((l: any) => l._id),
              userId: search.userId,
              profileId: profile._id,
            },
          );

          scheduledBatches++;
        } catch (error) {
          schedulingErrors++;
          console.error(`Failed to schedule batch ${i + 1}:`, error);

          // Mark all leads in failed batch as failed
          for (const lead of batch) {
            const typedLead = lead as any; // Type assertion for filtered lead data
            await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
              leadId: typedLead._id,
              error: error instanceof Error ? error.message : "Batch scheduling failed",
            });
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

// ===== OLD BATCH PROCESSING CODE REMOVED =====
// Legacy helper references retained near top-of-file for enrichment batching
