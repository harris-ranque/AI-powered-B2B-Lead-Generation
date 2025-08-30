import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Enrich lead with FindyMail data
export const enrichLead = internalAction({
  args: {
    leadId: v.id("leads"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Stub implementation - will be restored later
    console.log(`Enriching lead ${args.leadId} for search ${args.searchId}`);
    return { success: true, enriched: false };
  },
});

// Handle enrichment webhook
export const handleEnrichmentWebhook = internalMutation({
  args: {
    leadId: v.id("leads"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Enrichment webhook for lead ${args.leadId}`);
    return { success: true };
  },
});