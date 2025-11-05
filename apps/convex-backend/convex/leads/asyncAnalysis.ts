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
import { Doc } from "../_generated/dataModel";
import { getMissingApiKeysError } from "../lib/errorMessages";
import { captureAnalyticsEvent } from "../lib/analytics";

/**
 * Process a single lead with LangGraph API (scheduled action)
 *
 * This function is scheduled for each lead individually, allowing:
 * - Parallel processing of hundreds of leads
 * - Independent timeouts per lead (10 min each)
 * - Automatic retry on failures
 * - Webhook-based result handling
 */
export const analyzeSingleLead: any = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    userId: v.id("users"),
    profileId: v.id("businessProfiles"),
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxRetries = args.maxRetries || 3;

    // Get lead data
    const lead = (await ctx.runQuery(
      internal.leads.internal.getLeadInternal,
      {
        leadId: args.leadId,
      },
    )) as Doc<"leads"> | null;

    if (!lead) {
      console.error(`Lead ${args.leadId} not found`);
      return { success: false, error: "Lead not found" };
    }

    // Get business profile
    const profile = (await ctx.runQuery(
      internal.profile.internal.getProfileInternal,
      {
        profileId: args.profileId,
      },
    )) as Doc<"businessProfiles"> | null;

  if (!profile) {
    console.error(`Profile ${args.profileId} not found`);
    return { success: false, error: "Profile not found" };
  }
    captureAnalyticsEvent(args.userId, "async_analysis_enqueued", {
      leadId: args.leadId,
      searchId: args.searchId,
      businessName: lead.businessName,
    });

    // Get LangGraph configuration
    const langgraphUrl = process.env.LANGGRAPH_URL;
    const langgraphApiKey = process.env.LANGGRAPH_API_KEY;

    if (!langgraphUrl || !langgraphApiKey) {
      console.error("LangGraph service not configured");
      await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
        leadId: args.leadId,
        error: "LangGraph service not configured",
      });
      captureAnalyticsEvent(args.userId, "async_analysis_failed", {
        leadId: args.leadId,
        searchId: args.searchId,
        reason: "service_not_configured",
      });
      return { success: false, error: "LangGraph service not configured" };
    }

    // Create correlation context
    const correlation = createCorrelationContext(
      OPERATION_TYPES.LANGGRAPH_API,
      args.userId,
      {
        searchId: args.searchId,
        leadId: args.leadId,
        metadata: {
          businessName: lead.businessName,
          maxRetries,
        },
      },
    );

    // Mark as started
    await ctx.runMutation(internal.leads.internal.markLeadAnalysisStarted, {
      leadId: args.leadId,
    });

    // Retry loop
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const attemptCorrelation = createChildContext(
        correlation,
        OPERATION_TYPES.LANGGRAPH_API,
        {
          metadata: {
            attempt,
            maxAttempts: maxRetries,
          },
        },
      );

      const attemptPerf = startPerformanceTracking();
      captureAnalyticsEvent(args.userId, "async_analysis_attempt_started", {
        leadId: args.leadId,
        searchId: args.searchId,
        attempt,
        maxAttempts: maxRetries,
      });

      try {
        logWithCorrelation(
          "info",
          attemptCorrelation,
          "🤖 Starting LangGraph Lead Analysis",
          {
            businessName: lead.businessName,
            attempt,
            maxAttempts: maxRetries,
            hasWebsite: !!lead.website,
            hasContactInfo: !!lead.contactInfo?.emails?.length,
          },
        );

        // Create request ID for tracking
        const requestId = `${args.searchId}_${args.leadId}_${attempt}`;

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

        // Get user details to check plan
        const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
          userId: args.userId,
        });

        // Get enterprise user's API keys (BYOK flow)
        let providerKeys: Record<string, string> | undefined;
        if (user?.plan === "enterprise") {
          try {
            const resolvedKeys =
              (await ctx.runAction(
                internal.userApiKeys.actions.resolveUserProviderKeys,
                {
                  userId: args.userId,
                  purpose: "async_lead_analysis",
                },
              )) as Record<string, string>;

            const googleKey =
              resolvedKeys.google_places || resolvedKeys.google_maps || "";

            if (!resolvedKeys.google_places && resolvedKeys.google_maps) {
              console.warn(
                `BYOK: Enterprise user ${args.userId} is using legacy google_maps provider; ask them to re-save as google_places`,
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

            // All keys are validated to exist above, safe to assert non-null
            providerKeys = {
              openai: resolvedKeys.openai!,
              tavily: resolvedKeys.tavily!,
              perplexity: resolvedKeys.perplexity!,
              googlePlaces: googleKey,
              findymail: resolvedKeys.findymail!,
            };
          } catch (error) {
            // This should have been caught earlier, but just in case
            console.error("Enterprise user missing required API keys:", error);
            const errorMessage = error instanceof Error
              ? error.message
          : getMissingApiKeysError(["OpenAI", "Tavily", "Perplexity", "Google Places", "FindyMail"], "lead analysis");
        await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
          leadId: args.leadId,
          error: errorMessage,
        });
        captureAnalyticsEvent(args.userId, "async_analysis_failed", {
          leadId: args.leadId,
          searchId: args.searchId,
          reason: "missing_byok_keys",
          missingProviders: errorMessage,
        });
        return { success: false, error: "Missing required API keys" };
      }
        }

        // Prepare lead data for LangGraph
        const leadData = {
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
        };

        // Call LangGraph API
        const response = await fetch(`${langgraphUrl}/generate-email`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${langgraphApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            request_id: requestId,
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
              follow_up_sequence: true,
            },
            provider_keys: providerKeys,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`LangGraph API error ${response.status}: ${errorText}`);
        }

        const result = await response.json();

        const perfData = endPerformanceTracking(attemptPerf);

        logWithCorrelation(
          "info",
          attemptCorrelation,
          "✅ LangGraph Analysis Scheduled (Webhook-based)",
          {
            businessName: lead.businessName,
            attempt,
            durationMs: perfData?.duration || 0,
            requestId,
            webhookExpected: true,
          },
        );

        // Success - webhook will handle the result
        captureAnalyticsEvent(args.userId, "async_analysis_completed", {
          leadId: args.leadId,
          searchId: args.searchId,
          attempt,
          durationMs: perfData?.duration || 0,
          requestId,
        });
        return {
          success: true,
          requestId,
          leadId: lead._id,
        };
      } catch (error) {
        const perfData = endPerformanceTracking(attemptPerf);

        logWithCorrelation(
          "error",
          attemptCorrelation,
          "❌ LangGraph Analysis Failed",
          {
            businessName: lead.businessName,
            attempt,
            maxAttempts: maxRetries,
            durationMs: perfData?.duration || 0,
            willRetry: attempt < maxRetries,
            backoffDelay: attempt < maxRetries ? Math.pow(2, attempt) * 1000 : 0,
          },
          error as Error,
        );

        if (attempt === maxRetries) {
          // Final failure - mark as failed
          await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
            leadId: args.leadId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          captureAnalyticsEvent(args.userId, "async_analysis_failed", {
            leadId: args.leadId,
            searchId: args.searchId,
            reason: error instanceof Error ? error.message : "Unknown error",
            attempt,
            maxAttempts: maxRetries,
          });

          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            leadId: lead._id,
          };
        }

        // Exponential backoff delay before retry
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000),
        );
      }
    }

    // Should never reach here, but handle it
  await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
    leadId: args.leadId,
    error: "Max retries exceeded",
  });
  captureAnalyticsEvent(args.userId, "async_analysis_failed", {
    leadId: args.leadId,
    searchId: args.searchId,
    reason: "max_retries",
  });

  return {
    success: false,
    error: "Max retries exceeded",
      leadId: lead._id,
    };
  },
});
