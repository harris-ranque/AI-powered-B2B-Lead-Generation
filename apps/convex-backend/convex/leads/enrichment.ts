import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// Enrich lead with FindyMail data
export const enrichLead = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    try {
      // Get the lead
      const lead = await ctx.db.get(args.leadId);
      if (!lead) {
        throw new Error("Lead not found");
      }

      // Get the search to verify context
      const search = await ctx.db.get(args.searchId);
      if (!search) {
        throw new Error("Search not found");
      }

      // Call FindyMail API for enrichment
      const findyMailApiKey = process.env.FINDYMAIL_API_KEY;
      if (!findyMailApiKey) {
        console.warn("FindyMail API key not configured, skipping enrichment");
        return { success: true, enriched: false, reason: "API key not configured" };
      }

      // Prepare enrichment request
      const enrichmentData = {
        company: lead.businessName,
        domain: lead.website || null,
        location: lead.location.formattedAddress || null,
      };

      // Make API call to FindyMail
      const response = await fetch("https://api.findymail.com/v1/enrich/company", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${findyMailApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(enrichmentData),
      });

      if (!response.ok) {
        console.error(`FindyMail API error: ${response.status} - ${response.statusText}`);
        return { success: false, error: "FindyMail API error", enriched: false };
      }

      const enrichmentResult = await response.json();

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

      await ctx.db.patch(args.leadId, updateData);

      console.log(`Successfully enriched lead ${args.leadId}`);
      return { 
        success: true, 
        enriched: true, 
        emailsFound: enrichmentResult.emails?.length || 0,
        data: enrichmentResult 
      };

    } catch (error) {
      console.error(`Error enriching lead ${args.leadId}:`, error);
      
      // Update lead with error status - store error in enrichmentData
      await ctx.db.patch(args.leadId, {
        enrichmentStatus: "failed",
        enrichmentData: {
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: Date.now(),
        },
        updatedAt: Date.now(),
      });

      return { success: false, error: error instanceof Error ? error.message : "Unknown error", enriched: false };
    }
  },
});

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

      console.log(`Processed enrichment webhook for lead ${args.leadId}: ${result.success ? 'success' : 'failed'}`);
      return { success: true, processed: true };

    } catch (error) {
      console.error(`Error processing enrichment webhook for lead ${args.leadId}:`, error);
      
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

      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  },
});