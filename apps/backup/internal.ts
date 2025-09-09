import { internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";

// Batch analyze leads using LangGraph
export const batchAnalyzeLeads: any = internalAction({
  args: {
    searchId: v.id("searches"),
    correlationId: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const correlationId = args.correlationId || `batch_analyze_${Date.now()}`;
    const batchSize = args.batchSize || 3; // Process 3 leads at a time for AI analysis
    
    try {
      // Get all enriched leads for this search
      const leads: any = await ctx.runQuery(internal["leads/queries"].getSearchLeadsInternal, {
        searchId: args.searchId,
      });
      
      // Filter to only enriched leads without analysis
      const leadsToAnalyze: any = leads.filter((l: any) => 
        (l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback") &&
        !l.aiAnalysis
      );
      
      console.log(`Starting batch AI analysis for ${leadsToAnalyze.length} leads`);
      
      let analyzedCount = 0;
      let failedCount = 0;
      
      // Process in batches
      for (let i = 0; i < leadsToAnalyze.length; i += batchSize) {
        const batch = leadsToAnalyze.slice(i, Math.min(i + batchSize, leadsToAnalyze.length));
        
        // Process batch in parallel
        const batchPromises = batch.map((lead: any) => 
          ctx.runAction(api.langgraph.actions.analyzeLead, {
            leadId: lead._id,
          })
        );
        
        const results = await Promise.allSettled(batchPromises);
        
        // Count results
        results.forEach((result: any) => {
          if (result.status === "fulfilled") {
            analyzedCount++;
          } else {
            failedCount++;
            console.error("Lead analysis failed:", result.reason);
          }
        });
        
        // Update search progress
        await ctx.runMutation(api.search.mutations.updateSearchProgress, {
          searchId: args.searchId,
          progress: {
            discovered: leads.length,
            enriched: leads.filter((l: any) => 
              l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback"
            ).length,
            analyzed: analyzedCount,
            total: leads.length,
          },
        });
        
        // Small delay between batches to avoid overwhelming the AI service
        if (i + batchSize < leadsToAnalyze.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(`Batch AI analysis completed: ${analyzedCount} analyzed, ${failedCount} failed`);
      
      return {
        success: true,
        analyzedCount,
        failedCount,
        totalLeads: leadsToAnalyze.length,
      };
      
    } catch (error) {
      console.error("Batch AI analysis error:", error);
      throw error;
    }
  },
});