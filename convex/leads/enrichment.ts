import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { API_CONFIG, ERROR_CODES, CREDIT_COSTS } from "../lib/constants";
import { retry } from "../lib/helpers";
import { internal } from "../_generated/api";

// Process lead enrichment queue
export const processEnrichmentQueue = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get leads pending enrichment
    const pendingLeads = await ctx.runQuery(internal.leads.internal.getLeadsPendingEnrichment, {
      limit: 10,
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

        // Trigger enrichment action
        await ctx.runAction(internal.leads.enrichment.enrichLead, {
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

      const response = await retry(async () => {
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
      }, 3, 2000);

      // Process the enrichment results
      const enrichmentData = {
        emails: response.emails || [],
        contacts: response.contacts || [],
        socialProfiles: response.social_profiles || {},
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
        creditsUsed: CREDIT_COSTS.EMAIL_ENRICHMENT,
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