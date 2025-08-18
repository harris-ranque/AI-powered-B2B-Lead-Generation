import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { API_CONFIG, ERROR_CODES, CREDIT_COSTS } from "../lib/constants";
import { retryApiCall } from "../lib/helpers";
import { internal } from "../_generated/api";
import { withBatchRateLimit } from "../rateLimit/middleware";

// Process lead enrichment queue
export const processEnrichmentQueue = internalMutation({
  args: {
    searchId: v.optional(v.id("searches")),
    priority: v.optional(v.boolean()), // High priority processing
  },
  handler: async (ctx, args) => {
    const limit = args.priority ? 20 : 10; // Higher limit for priority processing
    
    // Get leads pending enrichment
    const pendingLeads = await ctx.runQuery(internal.leads.internal.getLeadsPendingEnrichment, {
      searchId: args.searchId,
      limit,
    });

    if (pendingLeads.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;

    for (const lead of pendingLeads) {
      try {
        // Mark as in progress
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: lead._id,
          contactInfo: {
            emails: [],
            contacts: [],
          },
          enrichmentStatus: "in_progress",
        });

        // Schedule enrichment action
        await ctx.scheduler.runAfter(0, internal.leads.enrichment.enrichLead, {
          leadId: lead._id,
        });

        processed++;
      } catch (error) {
        console.error(`Error processing lead ${lead._id}:`, error);
        
        // Mark as failed
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: lead._id,
          contactInfo: {
            emails: [],
            contacts: [],
          },
          enrichmentStatus: "failed",
        });
      }
    }

    return { processed };
  },
});

// Enrich a single lead with contact information
export const enrichLead = internalAction({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.runQuery(internal.leads.internal.getLeadForProcessing, {
      leadId: args.leadId,
    });

    if (!lead) {
      throw new Error("Lead not found");
    }

    const findymailApiKey = process.env.FINDYMAIL_API_KEY;
    
    if (!findymailApiKey) {
      throw new Error("FindyMail API key not configured");
    }

    try {
      // Search for emails using FindyMail API
      const searchPayload = {
        company_name: lead.businessName,
        domain: lead.website ? new URL(lead.website).hostname : undefined,
        location: lead.location.formattedAddress,
      };

      const response = await retryApiCall(async () => {
        const res = await fetch(`${API_CONFIG.FINDYMAIL.BASE_URL}${API_CONFIG.FINDYMAIL.ENDPOINTS.SEARCH_EMAILS}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${findymailApiKey}`,
          },
          body: JSON.stringify(searchPayload),
          signal: AbortSignal.timeout(API_CONFIG.FINDYMAIL.TIMEOUT || 15000),
        });

        if (!res.ok) {
          throw new Error(`FindyMail API error: ${res.status}`);
        }

        return res.json();
      });

      // Process the enrichment results with proper type checking
      const responseData = response as any;
      const enrichmentData = {
        emails: responseData?.emails || [],
        contacts: responseData?.contacts || [],
        socialProfiles: responseData?.social_profiles || {},
      };

      // Update lead with enrichment data
      await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
        leadId: args.leadId,
        contactInfo: enrichmentData,
        enrichmentStatus: "completed",
      });

      // Record credit usage
      await ctx.runMutation(internal.search.internal.recordSearchCredits, {
        searchId: lead.searchId,
        creditsUsed: CREDIT_COSTS.LEAD_ENRICHMENT,
      });

      // Update search progress
      const progressData = await ctx.runQuery(internal.leads.internal.getSearchProgressData, {
        searchId: lead.searchId,
      });

      await ctx.runMutation(internal.search.internal.updateSearchProgress, {
        searchId: lead.searchId,
        enriched: progressData.enrichedLeads,
        enrichedCount: progressData.enrichedLeads,
      });

      // Real-time trigger: Check if this lead should trigger analysis phase
      if (progressData.enrichedLeads > 0) {
        // Schedule immediate analysis for this enriched lead
        await ctx.scheduler.runAfter(1000, internal.langgraph.actions.analyzeLead, {
          leadId: args.leadId,
        });
        
        // Also trigger orchestrator to check if enrichment phase is complete
        await ctx.scheduler.runAfter(2000, internal.search.orchestrator.orchestrateSearchPipeline, {
          searchId: lead.searchId,
        });
      }

    } catch (error) {
      console.error(`Enrichment failed for lead ${args.leadId}:`, error);
      
      // Mark as failed
      await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
        leadId: args.leadId,
        contactInfo: {
          emails: [],
          contacts: [],
        },
        enrichmentStatus: "failed",
      });

      throw error;
    }
  },
});

// Handle enrichment webhook from FindyMail
export const handleEnrichmentWebhook = internalMutation({
  args: {
    leadId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    data: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      if (args.status === "completed" && args.data) {
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: args.leadId as any,
          contactInfo: args.data,
          enrichmentStatus: "completed",
        });
      } else {
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: args.leadId as any,
          contactInfo: {
            emails: [],
            contacts: [],
          },
          enrichmentStatus: "failed",
        });
      }
    } catch (error) {
      console.error("Error processing enrichment webhook:", error);
    }
  },
});