import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { v } from "convex/values";
import { Doc } from "../_generated/dataModel";

// Type definitions for external API responses
type FindyMailResponse = Record<string, {
  emails: Array<{
    email: string;
    type: string;
    confidence: number;
  }>;
  contacts: Array<{
    name: string;
    title?: string;
    email?: string;
    linkedin?: string;
    confidence: number;
    domain?: string;
  }>;
  socialProfiles?: {
    linkedin?: string;
    twitter?: string;
    facebook?: string;
  };
}>;

type LangGraphResponse = {
  status: string;
  result?: {
    relevance_score?: number;
    pain_points_identified?: string[];
    value_matches?: string[];
    recommendations?: string[];
    lead_analysis?: Record<string, any>;
    processing_time?: number;
    primary_email?: {
      subject: string;
      body: string;
      personalization_notes?: string[];
      estimated_effectiveness?: number;
    };
  };
};

// Helper function to extract domain from URL
function extractDomain(url?: string): string {
  if (!url) return "";
  try {
    const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsedUrl.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] || "";
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

// Enrich leads with contact information using FindyMail
export const enrichLeads: any = action({
  args: { 
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Starting lead enrichment for search ${args.searchId}`);

      // Get search and user info
      const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
        searchId: args.searchId,
      });
      
      if (!search) {
        throw new Error("Search not found");
      }

      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: search.userId,
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Get leads that need enrichment
      const leads: any = await ctx.runQuery(internal.leads.internal.getUnenrichedLeads, {
        searchId: args.searchId,
      });

      console.log(`Found ${leads.length} leads to enrich for search ${args.searchId}`);

      if (leads.length === 0) {
        // No leads to enrich, proceed to analysis - using the action reference directly
        await ctx.scheduler.runAfter(0, "leads/actions:analyzeLeads" as any, {
          searchId: args.searchId,
        });
        return { success: true, message: "No leads to enrich", enrichedCount: 0 };
      }

      // Determine API key source (Enterprise users provide their own)
      let apiKey: string;
      if (user.plan === "enterprise") {
        try {
          const keyResult = await ctx.runAction("userApiKeys/actions:getDecryptedApiKey" as any, {
            service: "findymail",
            userId: user._id,
          });
          apiKey = keyResult.apiKey;
        } catch (error) {
          // Fallback to system API key if user key not available
          apiKey = process.env.FINDYMAIL_API_KEY || "";
        }
      } else {
        apiKey = process.env.FINDYMAIL_API_KEY || "";
      }

      if (!apiKey) {
        throw new Error("FindyMail API key not available");
      }

      // Process leads in batches of 10 to avoid rate limits
      const batches = chunk(leads, 10);
      let enrichedCount = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        if (!batch) continue;
        
        console.log(`Processing enrichment batch ${batchIndex + 1}/${batches.length} with ${batch.length} leads`);

        // Prepare domains for bulk enrichment
        const domains = batch.map((lead: any) => extractDomain(lead.website)).filter(d => d);
        
        if (domains.length === 0) {
          // Skip batch if no valid domains
          continue;
        }

        try {
          // Call FindyMail bulk enrichment API
          const response = await fetch('https://app.findymail.com/api/v1/bulk-enrich', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              domains: domains,
            }),
          });

          if (!response.ok) {
            console.error(`FindyMail API error: ${response.status} ${response.statusText}`);
            // Mark leads as failed but continue with others
            for (const lead of batch) {
              await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
                leadId: (lead as any)._id,
                status: "failed",
                error: `FindyMail API error: ${response.status}`,
              });
            }
            continue;
          }

          const enrichmentData = await response.json() as FindyMailResponse;

          // Update each lead with enrichment data
          for (const lead of batch) {
            const domain = extractDomain((lead as any).website);
            const leadEnrichmentData = enrichmentData[domain];

            if (leadEnrichmentData) {
              await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
                leadId: (lead as any)._id,
                enrichmentData: leadEnrichmentData,
                status: "completed",
              });
              enrichedCount++;
            } else {
              // No enrichment data found, mark as completed with fallback
              await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
                leadId: (lead as any)._id,
                status: "completed_fallback",
                error: "No enrichment data found",
              });
            }
          }

          // Broadcast progress update
          const progressPercent = ((batchIndex + 1) / batches.length) * 100;
          await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
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
              }
            }
          });

          // Add small delay between batches to respect rate limits
          if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

        } catch (error) {
          console.error(`Error enriching batch ${batchIndex + 1}:`, error);
          
          // Mark batch as failed but continue
          for (const lead of batch) {
            await ctx.runMutation(internal.leads.internal.updateEnrichmentStatus, {
              leadId: (lead as any)._id,
              status: "failed",
              error: error instanceof Error ? error.message : "Enrichment failed",
            });
          }
        }
      }

      console.log(`Enrichment completed for search ${args.searchId}: ${enrichedCount}/${leads.length} leads enriched`);

      // Trigger AI analysis stage - using the action reference directly
      await ctx.scheduler.runAfter(0, "leads/actions:analyzeLeads" as any, {
        searchId: args.searchId,
      });

      return {
        success: true,
        message: `Enrichment completed: ${enrichedCount}/${leads.length} leads enriched`,
        enrichedCount,
        totalLeads: leads.length,
      };

    } catch (error) {
      console.error(`Enrichment failed for search ${args.searchId}:`, error);
      
      // Update search status to failed
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "Enrichment failed",
      });

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
    try {
      console.log(`Starting AI analysis for search ${args.searchId}`);

      // Get search and user info
      const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
        searchId: args.searchId,
      });
      
      if (!search) {
        throw new Error("Search not found");
      }

      // Get all leads for this search (enriched and unenriched)
      const leads: any = await ctx.runQuery(internal.leads.internal.getSearchLeadsInternal, {
        searchId: args.searchId,
      });

      console.log(`Found ${leads.length} leads to analyze for search ${args.searchId}`);

      if (leads.length === 0) {
        // No leads to analyze, complete the search - using the action reference directly
        await ctx.scheduler.runAfter(0, "search/actions:completeSearch" as any, {
          searchId: args.searchId,
        });
        return { success: true, message: "No leads to analyze", analyzedCount: 0 };
      }

      // Get user's business profile for AI context
      const profile = await ctx.runQuery(api.profile.queries.getBusinessProfile, {});
      
      if (!profile) {
        throw new Error("Business profile required for AI analysis");
      }

      // LangGraph service configuration
      const langgraphUrl = process.env.LANGGRAPH_URL;
      const langgraphApiKey = process.env.LANGGRAPH_API_KEY;
      
      if (!langgraphUrl || !langgraphApiKey) {
        throw new Error("LangGraph service not configured");
      }

      let analyzedCount = 0;

      // Process leads one by one (LangGraph doesn't have batch processing yet)
      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (!lead) continue;
        
        try {
          console.log(`Analyzing lead ${i + 1}/${leads.length}: ${lead.businessName}`);

          // Prepare lead data for LangGraph
          const leadData = {
            id: lead._id,
            company_name: lead.businessName,
            contact_name: lead.contactInfo?.contacts?.[0]?.name || "",
            title: lead.contactInfo?.contacts?.[0]?.title || "",
            industry: lead.category || "",
            company_size: "",
            location: `${lead.location.city || ""}, ${lead.location.state || ""}`.trim().replace(/^,\s*/, ''),
            description: "",
            website: lead.website || "",
            contact_info: {
              email: lead.contactInfo?.emails?.[0]?.email || "",
              phone: lead.phone || "",
              linkedin: lead.contactInfo?.socialProfiles?.linkedin || "",
              website: lead.website || "",
            },
            revenue: "",
            technologies: [],
            pain_points: [],
          };

          // Call LangGraph for analysis and email generation
          const response = await fetch(`${langgraphUrl}/generate-email`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${langgraphApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              request_id: `${args.searchId}_${lead._id}`,
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
                follow_up_sequence: false,
              },
            }),
          });

          if (!response.ok) {
            console.error(`LangGraph API error for lead ${lead._id}: ${response.status} ${response.statusText}`);
            continue;
          }

          const result = await response.json() as LangGraphResponse;

          if (result.status === "completed" && result.result) {
            // Store AI analysis and email results
            await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
              leadId: lead._id,
              aiAnalysis: {
                relevanceScore: result.result.relevance_score || 0,
                painPoints: result.result.pain_points_identified || [],
                valueMatches: result.result.value_matches || [],
                recommendations: result.result.recommendations || [],
                leadAnalysis: result.result.lead_analysis || {},
                processingTime: result.result.processing_time || 0,
              },
              emailContent: result.result.primary_email ? {
                subject: result.result.primary_email.subject,
                body: result.result.primary_email.body,
                personalizationNotes: result.result.primary_email.personalization_notes || [],
                estimatedEffectiveness: result.result.primary_email.estimated_effectiveness || 0.5,
              } : undefined,
            });
            
            analyzedCount++;
          }

          // Broadcast progress update
          const progressPercent = ((i + 1) / leads.length) * 100;
          await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
            userId: search.userId,
            searchId: args.searchId,
            stage: "analysis",
            progress: progressPercent,
            message: `Analyzed ${i + 1} of ${leads.length} leads`,
            data: {
              currentLead: lead.businessName,
              relevanceScore: result.result?.relevance_score || 0,
              progress: {
                discovered: leads.length,
                enriched: leads.filter((l: Doc<"leads">) => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback").length,
                analyzed: analyzedCount,
                total: leads.length,
              }
            }
          });

          // Add small delay between requests to avoid overwhelming LangGraph
          if (i < leads.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

        } catch (error) {
          console.error(`Error analyzing lead ${lead._id}:`, error);
          // Continue with other leads even if one fails
        }
      }

      console.log(`AI analysis completed for search ${args.searchId}: ${analyzedCount}/${leads.length} leads analyzed`);

      // Complete the search - using the action reference directly
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
      console.error(`AI analysis failed for search ${args.searchId}:`, error);
      
      // Update search status to failed
      await ctx.runMutation(api.search.mutations.updateSearchStatus, {
        searchId: args.searchId,
        status: "failed",
        error: error instanceof Error ? error.message : "AI analysis failed",
      });

      throw error;
    }
  },
});