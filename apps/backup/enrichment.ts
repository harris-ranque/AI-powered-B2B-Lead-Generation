import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// Enrich lead with FindyMail data
export const enrichLead: any = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const correlationId: string = args.correlationId || `enrich_${Date.now()}`;

    try {
      // Properly retrieve lead from database
      const lead = await ctx.runQuery(
        internal["leads/queries"].getLeadInternal,
        {
          leadId: args.leadId,
        },
      );

      if (!lead) {
        throw new Error(`Lead not found: ${args.leadId}`);
      }

      console.log(`Enriching lead ${args.leadId} for search ${args.searchId}`);

      // Update lead status to in_progress
      await ctx.runMutation(
        internal["leads/mutations"].updateEnrichmentStatus,
        {
          leadId: args.leadId,
          status: "in_progress",
        },
      );

      // Call FindyMail API for enrichment
      const findyMailApiKey = process.env.FINDYMAIL_API_KEY;
      if (!findyMailApiKey) {
        console.warn(
          "FindyMail API key not configured, using fallback enrichment",
        );

        // Use fallback enrichment
        const fallbackResult = await enrichWithFallback(ctx, lead);

        await ctx.runMutation(
          internal["leads/mutations"].updateLeadEnrichment,
          {
            leadId: args.leadId,
            enrichmentData: fallbackResult,
            status: "completed_fallback",
          },
        );

        return {
          success: true,
          enriched: true,
          fallback: true,
          data: fallbackResult,
        };
      }

      // Check domain cache first
      if (lead.website) {
        const domain = extractDomain(lead.website);
        const cachedData: any = await ctx.runQuery(
          internal["leads/queries"].getDomainCache,
          {
            domain,
            searchId: args.searchId,
          },
        );

        if (cachedData) {
          console.log(`Using cached enrichment data for domain: ${domain}`);

          await ctx.runMutation(
            internal["leads/mutations"].updateLeadEnrichment,
            {
              leadId: args.leadId,
              enrichmentData: cachedData.enrichmentData,
              status: "completed",
            },
          );

          return {
            success: true,
            enriched: true,
            cached: true,
            emailsFound: cachedData.enrichmentData.emails?.length || 0,
            data: cachedData.enrichmentData,
          };
        }
      }

      // Prepare enrichment request
      const enrichmentData = {
        company: lead.businessName,
        domain: lead.website || null,
        location: lead.location?.formattedAddress || null,
      };

      // Make API call to FindyMail
      const response = await fetch(
        "https://api.findymail.com/v1/enrich/company",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${findyMailApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(enrichmentData),
        },
      );

      if (!response.ok) {
        console.error(
          `FindyMail API error: ${response.status} - ${response.statusText}`,
        );
        return {
          success: false,
          error: "FindyMail API error",
          enriched: false,
        };
      }

      const enrichmentResult: any = await response.json();

      // Update lead with enrichment data
      const updateData: any = {
        enrichmentStatus: "completed",
        enrichmentData: enrichmentResult,
        updatedAt: Date.now(),
      };

      // Extract useful fields from enrichment result
      if (enrichmentResult.emails && enrichmentResult.emails.length > 0) {
        updateData.enrichedEmails = enrichmentResult.emails;
      }

      if (enrichmentResult.phone) {
        updateData.phone = enrichmentResult.phone;
      }

      if (enrichmentResult.linkedin) {
        updateData.linkedin = enrichmentResult.linkedin;
      }

      // Properly update lead in database
      await ctx.runMutation(internal["leads/mutations"].updateLeadEnrichment, {
        leadId: args.leadId,
        enrichmentData: updateData,
        status: "completed",
      });

      // Cache domain data if we have a website
      if (lead.website && enrichmentResult.emails?.length > 0) {
        const domain = extractDomain(lead.website);
        await ctx.runMutation(internal["leads/mutations"].cacheDomainData, {
          domain,
          searchId: args.searchId,
          enrichmentData: {
            emails: enrichmentResult.emails,
            contacts: enrichmentResult.contacts || [],
            socialProfiles: enrichmentResult.socialProfiles,
          },
        });
      }

      console.log(`Successfully enriched lead ${args.leadId}`);
      return {
        success: true,
        enriched: true,
        emailsFound: enrichmentResult.emails?.length || 0,
        data: enrichmentResult,
      };
    } catch (error) {
      console.error(`Error enriching lead ${args.leadId}:`, error);

      // Update lead with error status
      await ctx.runMutation(
        internal["leads/mutations"].updateEnrichmentStatus,
        {
          leadId: args.leadId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );

      // Try fallback enrichment
      try {
        const lead = await ctx.runQuery(
          internal["leads/queries"].getLeadInternal,
          {
            leadId: args.leadId,
          },
        );

        if (lead) {
          const fallbackResult = await enrichWithFallback(ctx, lead);

          await ctx.runMutation(
            internal["leads/mutations"].updateLeadEnrichment,
            {
              leadId: args.leadId,
              enrichmentData: fallbackResult,
              status: "completed_fallback",
            },
          );

          return {
            success: true,
            enriched: true,
            fallback: true,
            data: fallbackResult,
          };
        }
      } catch (fallbackError) {
        console.error("Fallback enrichment also failed:", fallbackError);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        enriched: false,
      };
    }
  },
});

// Batch enrich leads for a search
export const batchEnrichLeads: any = internalAction({
  args: {
    searchId: v.id("searches"),
    correlationId: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const correlationId = args.correlationId || `batch_enrich_${Date.now()}`;
    const batchSize = args.batchSize || 5; // Process 5 leads at a time

    try {
      // Get all leads for this search that need enrichment
      const leads: any = await ctx.runQuery(
        internal["leads/queries"].getUnenrichedLeads,
        {
          searchId: args.searchId,
        },
      );

      console.log(`Starting batch enrichment for ${leads.length} leads`);

      let enrichedCount = 0;
      let failedCount = 0;

      // Process in batches
      for (let i = 0; i < leads.length; i += batchSize) {
        const batch = leads.slice(i, Math.min(i + batchSize, leads.length));

        // Process batch in parallel
        const batchPromises = batch.map((lead: any) =>
          ctx.runAction(internal["leads/enrichment"].enrichLead, {
            leadId: lead._id,
            searchId: args.searchId,
            correlationId: `${correlationId}_${lead._id}`,
          }),
        );

        const results = await Promise.allSettled(batchPromises);

        // Count results
        results.forEach((result: any) => {
          if (result.status === "fulfilled" && result.value.enriched) {
            enrichedCount++;
          } else {
            failedCount++;
          }
        });

        // Update search progress
        await ctx.runMutation(api.search.mutations.updateSearchProgress, {
          searchId: args.searchId,
          progress: {
            discovered: leads.length,
            enriched: enrichedCount,
            analyzed: 0,
            total: leads.length,
          },
        });

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < leads.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      console.log(
        `Batch enrichment completed: ${enrichedCount} enriched, ${failedCount} failed`,
      );

      return {
        success: true,
        enrichedCount,
        failedCount,
        totalLeads: leads.length,
      };
    } catch (error) {
      console.error("Batch enrichment error:", error);
      throw error;
    }
  },
});

// Helper function to extract domain from URL
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname?.replace("www.", "") || url;
  } catch {
    return url?.replace("www.", "").split("/")[0] || url;
  }
}

// Fallback enrichment when FindyMail is not available
async function enrichWithFallback(ctx: any, lead: any) {
  // Generate generic email patterns based on domain
  const emails = [];

  if (lead.website) {
    const domain = extractDomain(lead.website);

    // Common email patterns
    emails.push(
      { email: `info@${domain}`, type: "generic", confidence: 0.7 },
      { email: `contact@${domain}`, type: "generic", confidence: 0.7 },
      { email: `hello@${domain}`, type: "generic", confidence: 0.6 },
      { email: `sales@${domain}`, type: "sales", confidence: 0.6 },
    );
  }

  // Create fallback contact info
  const contactInfo = {
    emails,
    contacts: [],
    socialProfiles: lead.contactInfo?.socialProfiles || {},
    fallbackUsed: true,
    fallbackReason: "FindyMail API not available",
  };

  return contactInfo;
}

// Handle enrichment webhook
export const handleEnrichmentWebhook = internalMutation({
  args: {
    leadId: v.id("leads"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    try {
      // Get the lead
      const lead = await ctx.db.get(args.leadId);
      if (!lead) {
        throw new Error("Lead not found");
      }

      const result = args.result;

      // Update lead with webhook result
      const updateData: any = {
        enrichmentStatus: result.success ? "completed" : "failed",
        enrichmentData: result.data || null,
        updatedAt: Date.now(),
      };

      if (result.success && result.data) {
        // Extract enrichment data
        if (result.data.emails && result.data.emails.length > 0) {
          updateData.enrichedEmails = result.data.emails;
        }

        if (result.data.phone) {
          updateData.phone = result.data.phone;
        }

        if (result.data.linkedin) {
          updateData.linkedin = result.data.linkedin;
        }

        if (result.data.company_info) {
          updateData.companyInfo = result.data.company_info;
        }
      } else {
        updateData.enrichmentData = {
          error: result.error || "Enrichment failed",
          timestamp: Date.now(),
        };
      }

      await ctx.db.patch(args.leadId, updateData);

      console.log(
        `Processed enrichment webhook for lead ${args.leadId}: ${result.success ? "success" : "failed"}`,
      );
      return { success: true, processed: true };
    } catch (error) {
      console.error(
        `Error processing enrichment webhook for lead ${args.leadId}:`,
        error,
      );

      // Mark enrichment as failed
      try {
        await ctx.db.patch(args.leadId, {
          enrichmentStatus: "failed",
          enrichmentData: {
            error: "Webhook processing failed",
            timestamp: Date.now(),
          },
          updatedAt: Date.now(),
        });
      } catch (updateError) {
        console.error("Failed to update lead with webhook error:", updateError);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
