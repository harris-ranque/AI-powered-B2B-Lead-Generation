/**
 * Async Lead Analysis System
 *
 * Scalable webhook-based architecture for analyzing 500+ leads
 * Uses fire-and-forget pattern with scheduled processing
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  createCorrelationContext,
  createChildContext,
  logWithCorrelation,
  startPerformanceTracking,
  endPerformanceTracking,
  OPERATION_TYPES,
} from "../lib/correlation";
import { Doc, Id } from "../_generated/dataModel";
import { getMissingApiKeysError } from "../lib/errorMessages";
import { captureAnalyticsEvent } from "../lib/analytics";
import { extractDomainFromWebsite } from "../lib/contactVerification";
import {
  isValidCompanyResearchCache,
  normalizeCompanyResearchPayload,
} from "../lib/companyResearchCache";
import {
  buildLangGraphUrl,
  langGraphRequestHeaders,
  normalizeLangGraphBaseUrl,
} from "../lib/langgraphClient";

/**
 * DEPRECATED: analyzeSingleLead - Replaced by batch processing
 *
 * This function has been replaced by the batch processing system:
 * - analyzeLeadsBatch: Processes up to 100 leads per batch
 * - retryFailedLeads: Targeted retry for failed leads only
 *
 * The old one-by-one processing was inefficient:
 * - 70-80% HTTP overhead per lead
 * - No progress updates during processing
 * - Harder to track and debug failures
 *
 * The new batch system provides:
 * - Single HTTP request per 100 leads
 * - Progress webhooks every 10 leads
 * - Better error handling with targeted retries
 * - 70-80% reduction in overhead
 */

/**
 * Process a batch of leads (up to 100) with LangGraph API
 *
 * This function handles batch processing with:
 * - Single HTTP request for entire batch
 * - Sequential processing with tolerant error handling
 * - Progress webhooks every 10 leads
 * - Fire-and-forget pattern (webhooks handle results)
 */
export const analyzeLeadsBatch: any = internalAction({
  args: {
    searchId: v.id("searches"),
    batchId: v.string(),
    batchNumber: v.number(),
    leadIds: v.optional(v.array(v.id("leads"))),
    contactIds: v.optional(v.array(v.id("leadContacts"))),
    userId: v.id("users"),
    profileId: v.id("businessProfiles"),
  },
  handler: async (ctx, args) => {
    const batchItemCount =
      args.contactIds?.length ?? args.leadIds?.length ?? 0;
    // Create correlation context for batch
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LANGGRAPH_API,
      args.userId,
      {
        searchId: args.searchId,
        metadata: {
          batchId: args.batchId,
          batchNumber: args.batchNumber,
          leadCount: batchItemCount,
          stage: "batch_analysis",
        },
      },
    );

    const perfTracker = startPerformanceTracking();

    try {
      logWithCorrelation(
        "info",
        correlation,
        "🚀 Starting Batch Lead Analysis",
        {
          batchId: args.batchId,
          batchNumber: args.batchNumber,
          leadCount: batchItemCount,
        },
      );

      // Get LangGraph configuration
      const langgraphUrl = normalizeLangGraphBaseUrl(process.env.LANGGRAPH_URL ?? "");
      const langgraphApiKey = process.env.LANGGRAPH_API_KEY;

      if (!langgraphUrl || !langgraphApiKey) {
        throw new Error("LangGraph service not configured");
      }

      // Get business profile once for entire batch
      const profile = (await ctx.runQuery(
        internal.profile.internal.getProfileInternal,
        { profileId: args.profileId },
      )) as Doc<"businessProfiles"> | null;

      if (!profile) {
        throw new Error(`Profile ${args.profileId} not found`);
      }

      // Get user details to check plan
      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: args.userId,
      });

      // Resolve BYOK provider keys once for entire batch (enterprise users)
      let providerKeys: Record<string, string> | undefined;
      if (user?.plan === "enterprise") {
        try {
          const resolvedKeys = (await ctx.runAction(
            internal.userApiKeys.actions.resolveUserProviderKeys,
            {
              userId: args.userId,
              purpose: "batch_lead_analysis",
            },
          )) as Record<string, string>;

          const googleKey =
            resolvedKeys.google_places || resolvedKeys.google_maps || "";

          if (!resolvedKeys.google_places && resolvedKeys.google_maps) {
            console.warn(
              `BYOK: Enterprise user ${args.userId} is using legacy google_maps provider`,
            );
          }

          const missingProviders: string[] = [];
          if (!resolvedKeys.openai) missingProviders.push("OpenAI");
          if (!resolvedKeys.tavily) missingProviders.push("Tavily");
          if (!resolvedKeys.perplexity) missingProviders.push("Perplexity");
          if (!googleKey) missingProviders.push("Google Places");
          if (!resolvedKeys.findymail) missingProviders.push("FindyMail");

          if (missingProviders.length > 0) {
            throw new Error(
              `Missing required BYOK providers: ${missingProviders.join(", ")}`,
            );
          }

          providerKeys = {
            openai: resolvedKeys.openai!,
            tavily: resolvedKeys.tavily!,
            perplexity: resolvedKeys.perplexity!,
            googlePlaces: googleKey,
            findymail: resolvedKeys.findymail!,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : getMissingApiKeysError(
                  ["OpenAI", "Tavily", "Perplexity", "Google Places", "FindyMail"],
                  "batch analysis",
                );

          // Mark all items in batch as failed
          if (args.contactIds?.length) {
            for (const contactId of args.contactIds) {
              await ctx.runMutation(
                internal.leads.contactInternal.markContactAnalysisFailed,
                { contactId, error: errorMessage },
              );
            }
          } else if (args.leadIds?.length) {
            for (const leadId of args.leadIds) {
              await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
                leadId,
                error: errorMessage,
              });
            }
          }

          throw new Error(`BYOK keys missing: ${errorMessage}`);
        }
      }

      // Fetch batch items (contacts or leads)
      const formattedLeads: Record<string, unknown>[] = [];
      const companyResearchCache = new Map<string, Record<string, unknown>>();

      if (args.contactIds && args.contactIds.length > 0) {
        for (const contactId of args.contactIds) {
          const contact = await ctx.runQuery(
            internal.leads.contactInternal.getContactInternal,
            { contactId },
          );
          if (!contact) continue;

          const lead = (await ctx.runQuery(
            internal.leads.internal.getLeadInternal,
            { leadId: contact.leadId },
          )) as Doc<"leads"> | null;
          if (!lead) continue;

          const domain =
            extractDomainFromWebsite(lead.website) ?? "";
          let companyResearch: Record<string, unknown> | undefined;
          if (domain) {
            if (!companyResearchCache.has(domain)) {
              const cached = await ctx.runQuery(
                internal.leads.contactInternal.getCompanyResearchByDomain,
                { searchId: args.searchId, domain },
              );
              if (
                cached?.researchPayload &&
                isValidCompanyResearchCache(cached.researchPayload)
              ) {
                const normalized = normalizeCompanyResearchPayload(
                  cached.researchPayload,
                );
                if (normalized) {
                  companyResearchCache.set(domain, normalized);
                }
              }
            }
            companyResearch = companyResearchCache.get(domain);
          }

          const companySizeFromEnrichment =
            typeof lead.enrichmentData?.company_size === "string"
              ? lead.enrichmentData.company_size
              : undefined;
          const inferredCompanySize =
            companySizeFromEnrichment ||
            (lead.reviewCount && lead.reviewCount > 50
              ? "Medium"
              : lead.reviewCount && lead.reviewCount > 10
                ? "Small"
                : "Micro");

          formattedLeads.push({
            id: contact._id,
            leadId: lead._id,
            contactId: contact._id,
            company_name: lead.businessName,
            contact_name: contact.name,
            title: contact.title || "",
            industry: lead.category || "",
            company_size: inferredCompanySize,
            location: `${lead.location.city || ""}, ${lead.location.state || ""}`
              .trim()
              .replace(/^,\s*/, ""),
            description:
              lead.enrichmentData?.description || lead.category
                ? `${lead.category} business`
                : "",
            website: lead.website || "",
            contact_info: {
              email: contact.email,
              phone: lead.phone || "",
              linkedin: contact.linkedin || "",
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
            rating: lead.rating || 0,
            review_count: lead.reviewCount || 0,
            company_research: companyResearch,
          });
        }
      } else if (args.leadIds) {
        const leads: Doc<"leads">[] = [];
        for (const leadId of args.leadIds) {
          const lead = (await ctx.runQuery(
            internal.leads.internal.getLeadInternal,
            { leadId },
          )) as Doc<"leads"> | null;

          if (lead) {
            leads.push(lead);
          } else {
            console.warn(`Lead ${leadId} not found in batch ${args.batchId}`);
          }
        }

        if (leads.length === 0) {
          throw new Error("No valid leads found in batch");
        }

        for (const lead of leads) {
          const companySizeFromEnrichment =
            typeof lead.enrichmentData?.company_size === "string"
              ? lead.enrichmentData.company_size
              : undefined;
          const employeeCount =
            typeof lead.enrichmentData?.employee_count === "number"
              ? String(lead.enrichmentData.employee_count)
              : undefined;
          const inferredCompanySize =
            companySizeFromEnrichment ||
            employeeCount ||
            (lead.reviewCount && lead.reviewCount > 50
              ? "Medium"
              : lead.reviewCount && lead.reviewCount > 10
                ? "Small"
                : "Micro");

          formattedLeads.push({
            id: lead._id,
            company_name: lead.businessName,
            contact_name: lead.contactInfo?.contacts?.[0]?.name || "",
            title: lead.contactInfo?.contacts?.[0]?.title || "",
            industry: lead.category || "",
            company_size: inferredCompanySize,
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
            rating: lead.rating || 0,
            review_count: lead.reviewCount || 0,
            social_profiles: lead.contactInfo?.socialProfiles || {},
            contact_emails: lead.contactInfo?.emails || [],
            all_contacts: lead.contactInfo?.contacts || [],
          });
        }
      }

      if (formattedLeads.length === 0) {
        throw new Error("No valid batch items found");
      }

      // Prepare batch request payload
      const batchPayload = {
        batchId: args.batchId,
        searchId: args.searchId,
        userId: args.userId,
        leads: formattedLeads,
        businessProfile: {
          companyName: profile.companyName,
          industry: profile.industry,
          valueProposition: profile.valueProposition,
          services: profile.services,
          targetMarkets: profile.targetMarkets,
          keyDifferentiators: profile.keyDifferentiators,
          caseStudies: [],
          contactInfo: profile.contactInfo,
        },
        requirements: {
          tone: "professional",
          length: "medium",
          callToAction: "Schedule a discovery call",
          includeCaseStudy: false,
          personalizationLevel: "high",
          followUpSequence: true,
        },
        providerKeys,
        maxConcurrent: 20, // Concurrent processing for optimal performance (default: 20)
      };

      // Call batch endpoint
      const response = await fetch(buildLangGraphUrl(langgraphUrl, "/batch-generate-emails"), {
        method: "POST",
        headers: langGraphRequestHeaders(langgraphApiKey),
        body: JSON.stringify(batchPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `LangGraph batch API error ${response.status}: ${errorText}`,
        );
      }

      const result = await response.json();
      const perfData = endPerformanceTracking(perfTracker);

      logWithCorrelation(
        "info",
        correlation,
        "✅ Batch Analysis Scheduled (Webhook-based)",
        {
          batchId: args.batchId,
          batchNumber: args.batchNumber,
          leadCount: formattedLeads.length,
          durationMs: perfData?.duration || 0,
          webhooksExpected: true,
          progressInterval: 10,
        },
      );

      captureAnalyticsEvent(args.userId, "batch_analysis_scheduled", {
        batchId: args.batchId,
        searchId: args.searchId,
        batchNumber: args.batchNumber,
        leadCount: formattedLeads.length,
        durationMs: perfData?.duration || 0,
      });

      return {
        success: true,
        batchId: args.batchId,
        leadCount: formattedLeads.length,
        status: result.status || "processing",
      };
    } catch (error) {
      const perfData = endPerformanceTracking(perfTracker);

      logWithCorrelation(
        "error",
        correlation,
        "❌ Batch Analysis Failed",
        {
          batchId: args.batchId,
          batchNumber: args.batchNumber,
          leadCount: batchItemCount,
          durationMs: perfData?.duration || 0,
        },
        error as Error,
      );

      // Mark all items in batch as failed
      if (args.contactIds?.length) {
        for (const contactId of args.contactIds) {
          await ctx.runMutation(
            internal.leads.contactInternal.markContactAnalysisFailed,
            {
              contactId,
              error:
                error instanceof Error
                  ? error.message
                  : "Batch analysis failed",
            },
          );
        }
      } else if (args.leadIds?.length) {
        for (const leadId of args.leadIds) {
          await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
            leadId,
            error:
              error instanceof Error ? error.message : "Batch analysis failed",
          });
        }
      }

      captureAnalyticsEvent(args.userId, "batch_analysis_failed", {
        batchId: args.batchId,
        searchId: args.searchId,
        batchNumber: args.batchNumber,
        reason: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        batchId: args.batchId,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Run company-level research once per domain before contact analysis fan-out.
 */
export const ensureCompanyResearchForSearch: any = internalAction({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const domainsNeeded = await ctx.runQuery(
      internal.leads.contactInternal.getDomainsNeedingCompanyResearch,
      { searchId: args.searchId },
    );

    if (domainsNeeded.length === 0) {
      return { researched: 0, skipped: 0 };
    }

    const langgraphUrl = normalizeLangGraphBaseUrl(process.env.LANGGRAPH_URL ?? "");
    const langgraphApiKey = process.env.LANGGRAPH_API_KEY;
    if (!langgraphUrl || !langgraphApiKey) {
      throw new Error("LangGraph service not configured");
    }

    const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
      userId: args.userId,
    });
    const userTier = user?.plan ?? "free";
    const isEnterpriseUser = user?.plan === "enterprise";

    let providerKeys: Record<string, string> | undefined;
    if (isEnterpriseUser) {
      try {
        const resolvedKeys = (await ctx.runAction(
          internal.userApiKeys.actions.resolveUserProviderKeys,
          {
            userId: args.userId,
            purpose: "company_research",
          },
        )) as Record<string, string>;

        if (resolvedKeys.tavily && resolvedKeys.perplexity) {
          providerKeys = {
            tavily: resolvedKeys.tavily,
            perplexity: resolvedKeys.perplexity,
          };
        }
      } catch (error) {
        console.warn(
          `[CompanyResearch] BYOK key resolution failed for user ${args.userId}:`,
          error,
        );
      }
    }

    let researched = 0;
    for (const item of domainsNeeded) {
      try {
        const response = await fetch(buildLangGraphUrl(langgraphUrl, "/research-company"), {
          method: "POST",
          headers: langGraphRequestHeaders(langgraphApiKey),
          body: JSON.stringify({
            companyName: item.businessName,
            domain: item.domain,
            location: item.location,
            industry: item.industry,
            userId: args.userId,
            userTier,
            providerKeys,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `[CompanyResearch] Failed for ${item.domain}: ${response.status} ${errorText}`,
          );
          continue;
        }

        const data = (await response.json()) as {
          researchPayload?: Record<string, unknown>;
          deepResearchUsed?: boolean;
          additionalCreditsUsed?: number;
        };

        if (!data.researchPayload) {
          continue;
        }

        await ctx.runMutation(
          internal.leads.contactInternal.saveCompanyResearchFromWebhook,
          {
            searchId: args.searchId,
            userId: args.userId,
            leadId: item.leadId,
            domain: item.domain,
            researchPayload: data.researchPayload,
          },
        );

        if (
          data.deepResearchUsed &&
          !isEnterpriseUser &&
          typeof data.additionalCreditsUsed === "number" &&
          data.additionalCreditsUsed > 0
        ) {
          await ctx.runMutation(internal.credits.transactions.recordTransaction, {
            userId: args.userId,
            amount: data.additionalCreditsUsed,
            operation: "usage",
            description: `Deep Research (company cache) - ${item.businessName}`,
            relatedEntityType: "lead",
            relatedEntityId: item.leadId,
          });
        }

        researched += 1;
      } catch (error) {
        console.error(
          `[CompanyResearch] Error researching ${item.domain}:`,
          error,
        );
      }
    }

    return {
      researched,
      skipped: domainsNeeded.length - researched,
    };
  },
});

/**
 * Retry failed leads from a batch
 *
 * This function identifies failed leads and re-schedules them for batch processing.
 * Implements targeted retry strategy - only retries individual failed leads, not entire batches.
 * Includes retry limit (max 2 retries) to prevent infinite loops.
 */
export const retryFailedLeads: any = internalAction({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    profileId: v.id("businessProfiles"),
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRetries = args.maxRetries || 2; // Default max 2 retry attempts

    const correlation = createCorrelationContext(
      OPERATION_TYPES.LANGGRAPH_API,
      args.userId,
      {
        searchId: args.searchId,
        metadata: {
          stage: "failed_lead_retry",
          maxRetries,
        },
      },
    );

    const perfTracker = startPerformanceTracking();

    try {
      logWithCorrelation(
        "info",
        correlation,
        "🔄 Starting Failed Lead Retry",
        {
          searchId: args.searchId,
          maxRetries,
        },
      );

      const failedContacts = (await ctx.runQuery(
        internal.leads.contactInternal.getFailedContactsForRetry,
        { searchId: args.searchId, maxRetries },
      )) as Array<{ _id: Id<"leadContacts"> }>;

      if (failedContacts.length > 0) {
        logWithCorrelation(
          "info",
          correlation,
          "📋 Found Failed Contacts for Retry",
          {
            searchId: args.searchId,
            failedCount: failedContacts.length,
            maxRetries,
          },
        );

        await ctx.runAction(
          (internal as any)["leads/asyncAnalysis"].ensureCompanyResearchForSearch,
          {
            searchId: args.searchId,
            userId: args.userId,
          },
        );

        const BATCH_SIZE = 100;
        const batches: Array<Array<{ _id: Id<"leadContacts"> }>> = [];
        for (let i = 0; i < failedContacts.length; i += BATCH_SIZE) {
          batches.push(failedContacts.slice(i, i + BATCH_SIZE));
        }

        for (const contact of failedContacts) {
          await ctx.runMutation(
            internal.leads.contactInternal.markContactAnalysisScheduled,
            {
              contactId: contact._id,
              requestId: `${args.searchId}_retry_contact_${contact._id}`,
            },
          );
        }

        let scheduledBatches = 0;
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          if (!batch) continue;
          const batchId = `${args.searchId}_retry_batch_${i + 1}`;

          await ctx.scheduler.runAfter(
            i * 10000,
            (internal as any)["leads/asyncAnalysis"].analyzeLeadsBatch,
            {
              searchId: args.searchId,
              batchId,
              batchNumber: i + 1,
              contactIds: batch.map((c) => c._id),
              userId: args.userId,
              profileId: args.profileId,
            },
          );

          scheduledBatches++;
        }

        const perfData = endPerformanceTracking(perfTracker);

        logWithCorrelation(
          "info",
          correlation,
          "✅ Failed Contacts Retry Scheduled",
          {
            searchId: args.searchId,
            retriedCount: failedContacts.length,
            batchCount: scheduledBatches,
            durationMs: perfData?.duration || 0,
          },
        );

        captureAnalyticsEvent(args.userId, "failed_contacts_retry_scheduled", {
          searchId: args.searchId,
          retriedCount: failedContacts.length,
          batchCount: scheduledBatches,
        });

        return {
          success: true,
          retriedCount: failedContacts.length,
          batchCount: scheduledBatches,
          message: `Scheduled ${failedContacts.length} failed contacts for retry in ${scheduledBatches} batches`,
        };
      }

      // Legacy fallback: searches without leadContacts rows
      const allLeads = await ctx.runQuery(
        internal.leads.internal.getSearchLeadsInternal,
        { searchId: args.searchId },
      );

      const failedLeads = allLeads.filter((lead: any) => {
        const isFailed = lead.analysisStatus === "failed";
        const retryCount = lead.analysisRetryCount || 0;
        const canRetry = retryCount < maxRetries;

        return isFailed && canRetry;
      });

      if (failedLeads.length === 0) {
        logWithCorrelation(
          "info",
          correlation,
          "ℹ️ No Failed Leads to Retry",
          {
            searchId: args.searchId,
            totalLeads: allLeads.length,
            failedLeads: allLeads.filter((l: any) => l.analysisStatus === "failed").length,
            exceededRetryLimit: allLeads.filter((l: any) =>
              l.analysisStatus === "failed" && (l.analysisRetryCount || 0) >= maxRetries
            ).length,
          },
        );

        return {
          success: true,
          retriedCount: 0,
          skippedCount: 0,
          message: "No failed leads eligible for retry",
        };
      }

      logWithCorrelation(
        "info",
        correlation,
        "📋 Found Failed Leads for Retry",
        {
          searchId: args.searchId,
          failedCount: failedLeads.length,
          maxRetries,
        },
      );

      // Batch failed leads into groups of 100
      const BATCH_SIZE = 100;
      const batches: any[][] = [];
      for (let i = 0; i < failedLeads.length; i += BATCH_SIZE) {
        batches.push(failedLeads.slice(i, i + BATCH_SIZE));
      }

      // Increment retry count and reset status for each failed lead
      for (const lead of failedLeads) {
        const retryCount = (lead.analysisRetryCount || 0) + 1;

        await ctx.runMutation(internal.leads.internal.updateLeadRetryCount, {
          leadId: lead._id,
          retryCount,
        });

        // Mark lead as scheduled for retry
        await ctx.runMutation(internal.leads.internal.markLeadAnalysisScheduled, {
          leadId: lead._id,
          requestId: `${args.searchId}_retry_${retryCount}_${lead._id}`,
        });
      }

      // Schedule each batch with staggered delays
      let scheduledBatches = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        if (!batch) continue; // Type guard for TypeScript
        const batchId = `${args.searchId}_retry_batch_${i + 1}`;

        // Schedule the batch analysis action
        await ctx.scheduler.runAfter(
          i * 10000, // 10-second stagger between retry batches
          (internal as any)["leads/asyncAnalysis"].analyzeLeadsBatch,
          {
            searchId: args.searchId,
            batchId,
            batchNumber: i + 1,
            leadIds: batch.map((l: any) => l._id),
            userId: args.userId,
            profileId: args.profileId,
          },
        );

        scheduledBatches++;
      }

      const perfData = endPerformanceTracking(perfTracker);

      logWithCorrelation(
        "info",
        correlation,
        "✅ Failed Leads Retry Scheduled",
        {
          searchId: args.searchId,
          retriedCount: failedLeads.length,
          batchCount: scheduledBatches,
          durationMs: perfData?.duration || 0,
        },
      );

      captureAnalyticsEvent(args.userId, "failed_leads_retry_scheduled", {
        searchId: args.searchId,
        retriedCount: failedLeads.length,
        batchCount: scheduledBatches,
      });

      return {
        success: true,
        retriedCount: failedLeads.length,
        batchCount: scheduledBatches,
        message: `Scheduled ${failedLeads.length} failed leads for retry in ${scheduledBatches} batches`,
      };
    } catch (error) {
      const perfData = endPerformanceTracking(perfTracker);

      logWithCorrelation(
        "error",
        correlation,
        "❌ Failed Lead Retry Error",
        {
          searchId: args.searchId,
          durationMs: perfData?.duration || 0,
        },
        error as Error,
      );

      captureAnalyticsEvent(args.userId, "failed_leads_retry_failed", {
        searchId: args.searchId,
        reason: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
