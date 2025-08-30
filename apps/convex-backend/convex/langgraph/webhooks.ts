import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Handle LangGraph analysis completion webhook
export const handleAnalysisCompleted = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    // Stub implementation - will be restored later
    console.log(`LangGraph analysis completed for lead ${args.leadId}`);
    return { success: true };
  },
});

// Handle LangGraph analysis error webhook
export const handleAnalysisError = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    // Stub implementation - will be restored later
    console.log(`LangGraph analysis error for lead ${args.leadId}: ${args.error}`);
    return { success: true };
  },
});

// Additional webhook handlers referenced in http.ts
export const handleEmailGenerationWebhook = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Email generation completed for lead ${args.leadId}`);
    return { success: true };
  },
});

export const handleAnalysisWebhook = internalMutation({
  args: {
    searchId: v.id("searches"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    // Stub implementation
    console.log(`Analysis webhook for search ${args.searchId}`);
    return { success: true };
  },
});