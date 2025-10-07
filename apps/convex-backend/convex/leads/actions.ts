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

// Helper function to chunk array
function chunk<T>(array: T[], size: number): T[][] {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
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
    let leads: any[] = [];
    let enrichedCount = 0;

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
            "userApiKeys/actions:getDecryptedApiKey" as any,
            {
              service: providerType, // Use configured provider
              userId: user._id,
            },
          );
          userApiKey = keyResult.apiKey;
        } catch (error) {
          // Will fallback to system API key in EnrichmentService
          logWithCorrelation(
            "warn",
            correlation,
            "Enterprise user API key not available, falling back to system key",
            {
              provider: providerType,
              userId: user._id,
            },
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

      // Create enrichment service
      let enrichmentService;
      try {
        enrichmentService = createEnrichmentService(userApiKey);
      } catch (error) {
        throw new Error(`${providerType.toUpperCase()} API key not configured`);
      }

      logWithCorrelation(
        "info",
        correlation,
        "📋 Lead Enrichment Configuration",
        {
          totalLeadsToEnrich: leads.length,
          userPlan: user.plan,
          enrichmentProvider: providerType,
          apiKeySource: user.plan === "enterprise" && userApiKey ? "user_provided" : "system",
        },
      );

      // Process leads in batches of 10 to avoid rate limits
      const batches = chunk(leads, 10);

      logWithCorrelation(
        "info",
        correlation,
        "🔄 Starting Batch Processing for Lead Enrichment",
        {
          totalLeads: leads.length,
          batchSize: 10,
          totalBatches: batches.length,
          enrichmentProvider: providerType,
          estimatedDuration: batches.length * 2000, // ~2s per batch
        },
      );

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        // Re-check cancellation/paused before each batch
        const latest = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: args.searchId,
          },
        );
        const latestUser = await ctx.runQuery(
          internal.users.internal.getUserInternal,
          {
            userId: search.userId,
          },
        );
        if (
          !latest ||
          latest.status === "cancelled" ||
          latestUser?.processingPaused
        ) {
          await ctx.runMutation(
            internal.search.internal.updateSearchStatusInternal,
            {
              searchId: args.searchId,
              status: "cancelled",
              error: latestUser?.processingPaused
                ? latestUser.pauseReason || "User processing paused by admin"
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
              message: latestUser?.processingPaused
                ? latestUser.pauseReason || "User processing paused by admin"
                : "Search cancelled",
            },
          );
          return { success: false, message: "Cancelled" } as any;
        }
        const batch = batches[batchIndex];
        if (!batch) continue;

        // Create batch correlation context
        const batchCorrelation = createChildContext(
          correlation,
          OPERATION_TYPES.BATCH_PROCESSING,
          {
            batchId: `batch_${batchIndex + 1}`,
            metadata: {
              batchNumber: batchIndex + 1,
              totalBatches: batches.length,
              batchSize: batch.length,
            },
          },
        );

        logWithCorrelation(
          "info",
          batchCorrelation,
          "🔄 Processing Enrichment Batch",
          {
            batchNumber: batchIndex + 1,
            totalBatches: batches.length,
            leadsInBatch: batch.length,
            progressPercent: ((batchIndex + 1) / batches.length) * 100,
          },
        );

        // Prepare domains for bulk enrichment
        const domains = batch
          .map((lead: any) => extractDomain(lead.website))
          .filter((d) => d);

        if (domains.length === 0) {
          // No valid domains in this batch; mark leads as completed with fallback
          for (const lead of batch) {
            await ctx.runMutation(
              internal.leads.internal.updateEnrichmentStatus,
              {
                leadId: (lead as any)._id,
                status: "completed_fallback",
                error: "No website domain available",
              },
            );
          }
          // Continue to next batch
          continue;
        }

        try {
          // Call enrichment provider (FindyMail or IcyPeas)
          logWithCorrelation(
            "info",
            batchCorrelation,
            "🔍 Calling Enrichment Provider",
            {
              provider: providerType,
              domainsCount: domains.length,
              domains: domains.slice(0, 3), // Log first 3 domains for debugging
              roles: enrichmentOptions?.roles,
            },
          );

          const enrichmentData: EnrichmentBatchResult =
            await enrichmentService.enrichBatch(domains, enrichmentOptions);

          // Determine fallback provider (disabled icypeas, no fallback)
          const fallbackProviderType: "findymail" | "icypeas" | null =
            null; // IcyPeas is disabled, no fallback available

          // Track domains that need fallback enrichment
          const domainsNeedingFallback: string[] = [];
          const leadsByDomain: Map<string, any> = new Map();

          // Update each lead with enrichment data
          for (const lead of batch) {
            const domain = extractDomain((lead as any).website);
            leadsByDomain.set(domain, lead);
            const leadEnrichmentData = enrichmentData[domain];

            // Check if we got valid email data (not null and has emails)
            const hasValidEmails = leadEnrichmentData &&
                                   leadEnrichmentData.emails &&
                                   leadEnrichmentData.emails.length > 0;

            if (hasValidEmails) {
              await ctx.runMutation(
                internal.leads.internal.updateLeadEnrichment,
                {
                  leadId: (lead as any)._id,
                  enrichmentData: leadEnrichmentData,
                  status: "completed",
                  enrichmentProvider: providerType,
                },
              );
              enrichedCount++;
            } else {
              // No emails found, add to fallback list
              domainsNeedingFallback.push(domain);

              logWithCorrelation(
                "warn",
                batchCorrelation,
                `⚠️ No emails found for ${domain} using ${providerType}${fallbackProviderType ? `, will try ${fallbackProviderType}` : " (no fallback available)"}`,
                {
                  domain,
                  primaryProvider: providerType,
                  fallbackProvider: fallbackProviderType || "none",
                },
              );
            }
          }

          // Try fallback provider for domains without emails (disabled)
          if (domainsNeedingFallback.length > 0 && fallbackProviderType !== null) {
            logWithCorrelation(
              "info",
              batchCorrelation,
              `🔄 Attempting fallback enrichment for ${domainsNeedingFallback.length} domains`,
              {
                primaryProvider: providerType,
                fallbackProvider: fallbackProviderType,
                domainsCount: domainsNeedingFallback.length,
              },
            );

            try {
              // Create fallback enrichment service
              const fallbackService = createEnrichmentService(undefined, fallbackProviderType);
            const fallbackData: EnrichmentBatchResult =
              await fallbackService.enrichBatch(
                domainsNeedingFallback,
                enrichmentOptions,
              );

              // Process fallback results
              for (const domain of domainsNeedingFallback) {
                const lead = leadsByDomain.get(domain);
                if (!lead) continue;

                const fallbackEnrichmentData = fallbackData[domain];
                const hasValidFallbackEmails = fallbackEnrichmentData &&
                                              fallbackEnrichmentData.emails &&
                                              fallbackEnrichmentData.emails.length > 0;

                if (hasValidFallbackEmails) {
                  await ctx.runMutation(
                    internal.leads.internal.updateLeadEnrichment,
                    {
                      leadId: (lead as any)._id,
                      enrichmentData: fallbackEnrichmentData,
                      status: "completed",
                      enrichmentProvider: fallbackProviderType,
                    },
                  );
                  enrichedCount++;

                  logWithCorrelation(
                    "info",
                    batchCorrelation,
                    `✅ Fallback enrichment successful for ${domain}`,
                    {
                      domain,
                      fallbackProvider: fallbackProviderType,
                      emailsFound: fallbackEnrichmentData.emails.length,
                    },
                  );
                } else {
                  // Enrichment failed, mark as completed_fallback
                  await ctx.runMutation(
                    internal.leads.internal.updateEnrichmentStatus,
                    {
                      leadId: (lead as any)._id,
                      status: "completed_fallback",
                      error: `No enrichment data found from ${providerType}${fallbackProviderType ? ` or ${fallbackProviderType}` : ""}`,
                    },
                  );

                  logWithCorrelation(
                    "warn",
                    batchCorrelation,
                    `❌ Enrichment failed for ${domain}`,
                    {
                      domain,
                      primaryProvider: providerType,
                      fallbackProvider: fallbackProviderType || "none",
                    },
                  );
                }
              }
            } catch (fallbackError) {
              logWithCorrelation(
                "error",
                batchCorrelation,
                "❌ Fallback enrichment provider error",
                {
                  fallbackProvider: fallbackProviderType || "none",
                  domainsCount: domainsNeedingFallback.length,
                  errorType: fallbackError instanceof Error ? fallbackError.constructor.name : "Unknown",
                },
                fallbackError as Error,
              );

              // Mark all fallback domains as failed
              for (const domain of domainsNeedingFallback) {
                const lead = leadsByDomain.get(domain);
                if (!lead) continue;

                await ctx.runMutation(
                  internal.leads.internal.updateEnrichmentStatus,
                  {
                    leadId: (lead as any)._id,
                    status: "completed_fallback",
                    error: `${providerType}${fallbackProviderType ? ` and ${fallbackProviderType}` : ""} enrichment failed`,
                  },
                );
              }
            }
          } else if (domainsNeedingFallback.length > 0) {
            // No fallback available, mark all as completed_fallback
            for (const domain of domainsNeedingFallback) {
              const lead = leadsByDomain.get(domain);
              if (!lead) continue;

              await ctx.runMutation(
                internal.leads.internal.updateEnrichmentStatus,
                {
                  leadId: (lead as any)._id,
                  status: "completed_fallback",
                  error: `No enrichment data found from ${providerType} (no fallback available)`,
                },
              );
            }
          }

          // Broadcast progress update
          const progressPercent = ((batchIndex + 1) / batches.length) * 100;
          await ctx.runMutation(
            internal.realtime.broadcaster.broadcastPipelineUpdate,
            {
              userId: search.userId,
              searchId: args.searchId,
              stage: "enrichment",
              progress: progressPercent,
              message: `Enriched ${enrichedCount} of ${leads.length} leads`,
              data: {
                progress: {
                  discovered: leads.length,
                  enriched: enrichedCount,
                  analyzed: 0,
                  total: leads.length,
                },
              },
            },
          );

          // Add small delay between batches to respect rate limits
          if (batchIndex < batches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          logWithCorrelation(
            "error",
            batchCorrelation,
            "❌ Primary Enrichment Provider Error",
            {
              provider: providerType,
              batchNumber: batchIndex + 1,
              domainsCount: domains.length,
              errorType: error instanceof Error ? error.constructor.name : "Unknown",
            },
            error as Error,
          );

          // Try fallback provider for the entire batch (disabled)
          const fallbackProviderType: "findymail" | "icypeas" | null =
            null; // IcyPeas is disabled, no fallback available

          if (fallbackProviderType !== null) {
            logWithCorrelation(
              "info",
              batchCorrelation,
              `🔄 Primary provider failed, trying fallback provider for entire batch`,
              {
                primaryProvider: providerType,
                fallbackProvider: fallbackProviderType,
                domainsCount: domains.length,
              },
            );

            try {
              const fallbackService = createEnrichmentService(undefined, fallbackProviderType);
            const fallbackData: EnrichmentBatchResult =
              await fallbackService.enrichBatch(domains, enrichmentOptions);

            // Process fallback results
            for (const lead of batch) {
              const domain = extractDomain((lead as any).website);
              const fallbackEnrichmentData = fallbackData[domain];
              const hasValidFallbackEmails = fallbackEnrichmentData &&
                                            fallbackEnrichmentData.emails &&
                                            fallbackEnrichmentData.emails.length > 0;

              if (hasValidFallbackEmails) {
                await ctx.runMutation(
                  internal.leads.internal.updateLeadEnrichment,
                  {
                    leadId: (lead as any)._id,
                    enrichmentData: fallbackEnrichmentData,
                    status: "completed",
                    enrichmentProvider: fallbackProviderType,
                  },
                );
                enrichedCount++;

                logWithCorrelation(
                  "info",
                  batchCorrelation,
                  `✅ Fallback provider success for ${domain}`,
                  {
                    domain,
                    fallbackProvider: fallbackProviderType,
                    emailsFound: fallbackEnrichmentData.emails.length,
                  },
                );
              } else {
                await ctx.runMutation(
                  internal.leads.internal.updateEnrichmentStatus,
                  {
                    leadId: (lead as any)._id,
                    status: "failed",
                    error: `${providerType}${fallbackProviderType ? ` and ${fallbackProviderType}` : ""} enrichment failed`,
                  },
                );
              }
            }
            } catch (fallbackError) {
              logWithCorrelation(
                "error",
                batchCorrelation,
                "❌ Fallback provider also failed",
                {
                  fallbackProvider: fallbackProviderType || "none",
                  errorType: fallbackError instanceof Error ? fallbackError.constructor.name : "Unknown",
                },
                fallbackError as Error,
              );

              // Mark batch as failed
              for (const lead of batch) {
                await ctx.runMutation(
                  internal.leads.internal.updateEnrichmentStatus,
                  {
                    leadId: (lead as any)._id,
                    status: "failed",
                    error:
                      error instanceof Error ? error.message : `${providerType} enrichment failed`,
                  },
                );
              }
            }
          } else {
            // No fallback available, mark batch as failed
            for (const lead of batch) {
              await ctx.runMutation(
                internal.leads.internal.updateEnrichmentStatus,
                {
                  leadId: (lead as any)._id,
                  status: "failed",
                  error: error instanceof Error ? error.message : `${providerType} enrichment failed (no fallback available)`,
                },
              );
            }
          }
        }
      }

      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 2 COMPLETE: Lead Enrichment Phase Finished",
        {
          totalLeads: leads.length,
          enrichedCount,
          failedCount: leads.length - enrichedCount,
          enrichmentRate: (enrichedCount / leads.length) * 100,
          enrichmentProvider: providerType,
          durationMs: performanceData?.duration || 0,
          averageTimePerLead: leads.length > 0 ? (performanceData?.duration || 0) / leads.length : 0,
          nextPhase: "ai_analysis",
        },
      );

      // Trigger AI analysis stage (if not cancelled)
      {
        const latest = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: args.searchId,
          },
        );
        if (latest && latest.status !== "cancelled") {
          logWithCorrelation(
            "info",
            correlation,
            "🔄 PHASE TRANSITION: Triggering Phase 3 (AI Analysis)",
            {
              enrichedLeads: enrichedCount,
              totalLeads: leads.length,
              schedulingDelay: "immediate",
            },
          );
          
          await ctx.scheduler.runAfter(0, "leads/actions:analyzeLeads" as any, {
            searchId: args.searchId,
          });
        }
      }

      return {
        success: true,
        message: `Enrichment completed: ${enrichedCount}/${leads.length} leads enriched using ${providerType}`,
        enrichedCount,
        totalLeads: leads.length,
        enrichmentProvider: providerType,
      };
    } catch (error) {
      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "error",
        correlation,
        "💥 PHASE 2 FAILED: Lead Enrichment Phase Error",
        {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          duration: performanceData?.duration || 0,
          totalLeads: leads?.length || 0,
          enrichedSoFar: enrichedCount || 0,
        },
        error as Error,
      );

      // Update search status to failed (internal to bypass auth in actions)
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "failed",
          error: error instanceof Error ? error.message : "Enrichment failed",
        },
      );

      throw error;
    }
  },
});

// Analyze leads using LangGraph AI system
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
          stage: "ai_analysis",
        },
      },
    );

    const performanceTracker = startPerformanceTracking();
    let leads: any[] = [];
    let analyzedCount = 0;
    let failedCount = 0;

    logWithCorrelation(
      "info",
      correlation,
      "🚀 PHASE 3 START: AI Analysis Phase Beginning",
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

      // Check LangGraph worker health before starting AI analysis
      const systemConfig = await ctx.runQuery(
        api.admin.queries.getSystemConfiguration,
        {},
      );

      const langGraphHealth = systemConfig?.orchestrationSettings?.langGraphHealth;

      if (!langGraphHealth || langGraphHealth.status === "unavailable") {
        const errorMessage =
          "LangGraph worker is currently unavailable. AI analysis pipeline is temporarily paused. " +
          (langGraphHealth?.lastError || "Worker health check failed.");

        logWithCorrelation(
          "error",
          correlation,
          "❌ PHASE 3 BLOCKED: LangGraph Worker Unavailable",
          {
            healthStatus: langGraphHealth?.status || "unknown",
            lastError: langGraphHealth?.lastError,
            consecutiveFailures: langGraphHealth?.consecutiveFailures,
          },
        );

        await ctx.runMutation(
          internal.search.internal.updateSearchStatusInternal,
          {
            searchId: args.searchId,
            status: "failed",
            error: errorMessage,
          },
        );

        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: args.searchId,
            stage: "analysis_failed",
            progress: 0,
            message: "AI analysis service unavailable",
            error: errorMessage,
          },
        );

        throw new Error(errorMessage);
      }

      if (langGraphHealth.status === "degraded") {
        logWithCorrelation(
          "warn",
          correlation,
          "⚠️ LangGraph Worker Health Degraded - Proceeding with caution",
          {
            healthStatus: langGraphHealth.status,
            services: langGraphHealth.services,
            performance: langGraphHealth.performance,
          },
        );
      }

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
        "📋 AI Analysis Configuration",
        {
          totalLeadsToAnalyze: leads.length,
          batchSize: 3,
          estimatedDuration: Math.ceil(leads.length / 3) * 30000, // ~30s per batch
          langgraphUrl: langgraphUrl?.includes("localhost") ? "local" : "production",
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
          analyzedCount: 0,
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

      // Process leads in concurrent batches for better performance
      const batchSize = 3; // Process 3 leads concurrently
      const leadBatches = chunk(leads, batchSize);

      logWithCorrelation(
        "info",
        correlation,
        "🔄 Starting LangGraph AI Analysis Batches",
        {
          totalLeads: leads.length,
          batchSize,
          totalBatches: leadBatches.length,
          estimatedDuration: leadBatches.length * 30000, // ~30s per batch
          concurrentAnalysis: true,
        },
      );

      for (let batchIndex = 0; batchIndex < leadBatches.length; batchIndex++) {
        const batch = leadBatches[batchIndex];
        if (!batch) continue;

        // Create batch correlation context
        const batchCorrelation = createChildContext(
          correlation,
          OPERATION_TYPES.LANGGRAPH_API,
          {
            batchId: `analysis_batch_${batchIndex + 1}`,
            metadata: {
              batchNumber: batchIndex + 1,
              totalBatches: leadBatches.length,
              batchSize: batch.length,
              concurrentProcessing: true,
            },
          },
        );

        logWithCorrelation(
          "info",
          batchCorrelation,
          "🤖 Processing AI Analysis Batch",
          {
            batchNumber: batchIndex + 1,
            totalBatches: leadBatches.length,
            leadsInBatch: batch.length,
            progressPercent: ((batchIndex + 1) / leadBatches.length) * 100,
            concurrentAnalysis: true,
          },
        );

        // Check for cancellation/paused before each batch
        {
          const latest = await ctx.runQuery(
            internal.search.internal.getSearchInternal,
            {
              searchId: args.searchId,
            },
          );
          const latestUser = await ctx.runQuery(
            internal.users.internal.getUserInternal,
            {
              userId: search.userId,
            },
          );
          if (
            !latest ||
            latest.status === "cancelled" ||
            latestUser?.processingPaused
          ) {
            await ctx.runMutation(
              internal.search.internal.updateSearchStatusInternal,
              {
                searchId: args.searchId,
                status: "cancelled",
                error: latestUser?.processingPaused
                  ? latestUser.pauseReason || "User processing paused by admin"
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
                message: latestUser?.processingPaused
                  ? latestUser.pauseReason || "User processing paused by admin"
                  : "Search cancelled",
              },
            );
            return { success: false, message: "Cancelled" } as any;
          }
        }

        // Process batch concurrently with Promise.allSettled for error resilience
        const batchPromises = batch.map((lead) =>
          processLeadWithLangGraph(
            lead,
            profile,
            langgraphUrl,
            langgraphApiKey,
            args.searchId,
          ),
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Process results and update database
        for (let i = 0; i < batchResults.length; i++) {
          const result = batchResults[i];
          const lead = batch[i] as any; // Type assertion for lead object

          if (!lead || !lead._id) continue;

          if (result?.status === "fulfilled" && result.value.success) {
            // Success: rely on webhook handler to persist analysis and email content (single write-path)
            analyzedCount++;
          } else {
            // Handle failed analysis
            failedCount++;
            const errorMessage =
              result?.status === "fulfilled"
                ? result.value.error
                : "Promise rejected";
            console.error(
              `Failed to analyze lead ${lead?._id}: ${errorMessage}`,
            );

            // Update lead with analysis error
            try {
              await ctx.runMutation(
                internal.leads.internal.updateLeadAnalysis,
                {
                  leadId: lead._id as any,
                  aiAnalysis: {
                    relevanceScore: 0,
                    painPoints: [],
                    valueMatches: [],
                    recommendations: [`Analysis failed: ${errorMessage}`],
                    leadAnalysis: { error: errorMessage },
                    processingTime: 0,
                    confidence: 0,
                  },
                  emailContent: undefined,
                },
              );
            } catch (dbError) {
              console.error(
                `Error storing failure state for lead ${lead._id}:`,
                dbError,
              );
            }
          }
        }

        // Broadcast progress update after each batch
        const totalProcessed = analyzedCount + failedCount;
        const progressPercent = (totalProcessed / leads.length) * 100;

        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: args.searchId,
            stage: "analysis",
            progress: progressPercent,
            message: `Analyzed ${totalProcessed} of ${leads.length} leads (${analyzedCount} successful, ${failedCount} failed)`,
            data: {
              currentBatch: batchIndex + 1,
              totalBatches: leadBatches.length,
              progress: {
                discovered: leads.length,
                enriched: leads.filter(
                  (l: any) =>
                    l.enrichmentStatus === "completed" ||
                    l.enrichmentStatus === "completed_fallback",
                ).length,
                analyzed: analyzedCount,
                failed: failedCount,
                total: leads.length,
              },
            },
          },
        );

        // Add small delay between batches to prevent overwhelming the LangGraph service
        if (batchIndex < leadBatches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "info",
        correlation,
        "🎉 PHASE 3 COMPLETE: AI Analysis Phase Finished",
        {
          totalLeads: leads.length,
          analyzedCount,
          failedCount,
          analysisSuccessRate: (analyzedCount / leads.length) * 100,
          durationMs: performanceData?.duration || 0,
          averageTimePerLead: leads.length > 0 ? (performanceData?.duration || 0) / leads.length : 0,
          nextPhase: "search_completion",
        },
      );

      logWithCorrelation(
        "info",
        correlation,
        "🔄 PHASE TRANSITION: Triggering Final Phase (Search Completion)",
        {
          analyzedLeads: analyzedCount,
          failedLeads: failedCount,
          totalLeads: leads.length,
          schedulingDelay: "immediate",
        },
      );
      
      // Complete the search
      await ctx.scheduler.runAfter(0, "search/actions:completeSearch" as any, {
        searchId: args.searchId,
      });

      return {
        success: true,
        message: `Analysis completed: ${analyzedCount}/${leads.length} leads analyzed`,
        analyzedCount,
        totalLeads: leads.length,
      };
    } catch (error) {
      const performanceData = endPerformanceTracking(performanceTracker);
      
      logWithCorrelation(
        "error",
        correlation,
        "💥 PHASE 3 FAILED: AI Analysis Phase Error",
        {
          errorType: error instanceof Error ? error.constructor.name : "Unknown",
          duration: performanceData?.duration || 0,
          totalLeads: leads?.length || 0,
          analyzedSoFar: analyzedCount || 0,
          failedSoFar: failedCount || 0,
        },
        error as Error,
      );

      // Update search status to failed (internal to bypass auth in actions)
      await ctx.runMutation(
        internal.search.internal.updateSearchStatusInternal,
        {
          searchId: args.searchId,
          status: "failed",
          error: error instanceof Error ? error.message : "AI analysis failed",
        },
      );

      throw error;
    }
  },
});
