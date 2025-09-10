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
    agent_results?: Array<{
      agentName: string;
      role: string;
      output: string;
      confidenceScore: number;
      executionTime: number;
    }>;
    primary_email?: {
      subject: string;
      body: string;
      personalization_notes?: string[];
      estimated_effectiveness?: number;
    };
  };
  error?: string;
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

// Helper function to process single lead with LangGraph
async function processLeadWithLangGraph(
  lead: any,
  profile: any,
  langgraphUrl: string,
  langgraphApiKey: string,
  searchId: string,
  retryAttempts: number = 3
): Promise<{ success: boolean; result?: any; error?: string; leadId: any }> {
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      console.log(`Analyzing lead ${lead.businessName} (attempt ${attempt}/${retryAttempts})`);

      // Prepare enhanced lead data for LangGraph
      const leadData = {
        id: lead._id,
        company_name: lead.businessName,
        contact_name: lead.contactInfo?.contacts?.[0]?.name || "",
        title: lead.contactInfo?.contacts?.[0]?.title || "",
        industry: lead.category || "",
        company_size: lead.contactInfo?.contacts?.[0]?.company_size || 
                     (lead.reviewCount && lead.reviewCount > 50 ? "Medium" : 
                      lead.reviewCount && lead.reviewCount > 10 ? "Small" : "Micro"),
        location: `${lead.location.city || ""}, ${lead.location.state || ""}`.trim().replace(/^,\s*/, ''),
        description: lead.enrichmentData?.description || 
                    lead.category ? `${lead.category} business` : "",
        website: lead.website || "",
        contact_info: {
          email: lead.contactInfo?.emails?.[0]?.email || "",
          phone: lead.phone || "",
          linkedin: lead.contactInfo?.socialProfiles?.linkedin || "",
          website: lead.website || "",
        },
        revenue: lead.enrichmentData?.estimated_revenue || 
                (lead.reviewCount && lead.reviewCount > 100 ? "High" : 
                 lead.reviewCount && lead.reviewCount > 20 ? "Medium" : "Low"),
        technologies: lead.enrichmentData?.technologies || [],
        pain_points: lead.enrichmentData?.pain_points || [],
        // Additional context from enrichment
        rating: lead.rating || 0,
        review_count: lead.reviewCount || 0,
        social_profiles: lead.contactInfo?.socialProfiles || {},
        contact_emails: lead.contactInfo?.emails || [],
        all_contacts: lead.contactInfo?.contacts || [],
      };

      // Call LangGraph for analysis and email generation
      const response = await fetch(`${langgraphUrl}/generate-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${langgraphApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          request_id: `${searchId}_${lead._id}_${attempt}`,
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
        const errorText = await response.text();
        throw new Error(`LangGraph API error ${response.status}: ${errorText}`);
      }

      const result = await response.json() as LangGraphResponse;

      if (result.status === "completed" && result.result) {
        return {
          success: true,
          result: result.result,
          leadId: lead._id,
        };
      } else {
        throw new Error(result.error || "LangGraph analysis failed");
      }

    } catch (error) {
      console.error(`Error analyzing lead ${lead._id} (attempt ${attempt}):`, error);
      
      if (attempt === retryAttempts) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          leadId: lead._id,
        };
      }
      
      // Exponential backoff delay
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  return {
    success: false,
    error: "Max retries exceeded",
    leadId: lead._id,
  };
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
        // No leads to enrich, proceed to analysis
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

      // Trigger AI analysis stage
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
        // No leads to analyze, complete the search
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
      let failedCount = 0;

      // Process leads in concurrent batches for better performance
      const batchSize = 3; // Process 3 leads concurrently
      const leadBatches = chunk(leads, batchSize);

      for (let batchIndex = 0; batchIndex < leadBatches.length; batchIndex++) {
        const batch = leadBatches[batchIndex];
        if (!batch) continue;

        console.log(`Processing analysis batch ${batchIndex + 1}/${leadBatches.length} with ${batch.length} leads`);

        // Process batch concurrently with Promise.allSettled for error resilience
        const batchPromises = batch.map(lead => 
          processLeadWithLangGraph(lead, profile, langgraphUrl, langgraphApiKey, args.searchId)
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Process results and update database
        for (let i = 0; i < batchResults.length; i++) {
          const result = batchResults[i];
          const lead = batch[i] as any; // Type assertion for lead object
          
          if (!lead || !lead._id) continue;
          
          if (result?.status === 'fulfilled' && result.value.success) {
            try {
              // Store AI analysis and email results with enhanced data structure
              await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
                leadId: lead._id,
                aiAnalysis: {
                  relevanceScore: result.value.result.relevance_score || 0,
                  painPoints: result.value.result.pain_points_identified || [],
                  valueMatches: result.value.result.value_matches || [],
                  recommendations: result.value.result.recommendations || [],
                  leadAnalysis: result.value.result.lead_analysis || {},
                  processingTime: result.value.result.processing_time || 0,
                  confidence: result.value.result.relevance_score || 0.5,
                },
                emailContent: result.value.result.primary_email ? {
                  subject: result.value.result.primary_email.subject,
                  body: result.value.result.primary_email.body,
                  personalizationNotes: result.value.result.primary_email.personalization_notes || [],
                  estimatedEffectiveness: result.value.result.primary_email.estimated_effectiveness || 0.5,
                } : undefined,
              });

              // Create email sequence record if we have email content
              if (result.value.result.primary_email) {
                await ctx.runMutation(internal.leads.internal.createEmailSequence, {
                  leadId: lead._id,
                  userId: search.userId,
                  requestId: `${args.searchId}_${lead._id}`,
                  emailContent: {
                    subject: result.value.result.primary_email.subject,
                    body: result.value.result.primary_email.body,
                    personalizationNotes: result.value.result.primary_email.personalization_notes || [],
                    estimatedEffectiveness: result.value.result.primary_email.estimated_effectiveness || 0.5,
                  },
                  agentResults: result.value.result.agent_results || [],
                  processingTime: result.value.result.processing_time || 0,
                  recommendations: result.value.result.recommendations || [],
                });
              }
              
              analyzedCount++;
            } catch (dbError) {
              console.error(`Error storing analysis results for lead ${result.value.leadId}:`, dbError);
              failedCount++;
            }
          } else {
            // Handle failed analysis
            failedCount++;
            const errorMessage = result?.status === 'fulfilled' ? result.value.error : 'Promise rejected';
            console.error(`Failed to analyze lead ${lead?._id}: ${errorMessage}`);
            
            // Update lead with analysis error
            try {
              await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
                leadId: lead._id as any,
                aiAnalysis: {
                  relevanceScore: 0,
                  painPoints: [],
                  valueMatches: [],
                  recommendations: [`Analysis failed: ${errorMessage}`],
                  leadAnalysis: { error: errorMessage },
                  processingTime: 0,
                  confidence: 0,
                },
                emailContent: undefined,
              });
            } catch (dbError) {
              console.error(`Error storing failure state for lead ${lead._id}:`, dbError);
            }
          }
        }

        // Broadcast progress update after each batch
        const totalProcessed = analyzedCount + failedCount;
        const progressPercent = (totalProcessed / leads.length) * 100;
        
        await ctx.runMutation(internal.realtime.broadcaster.broadcastPipelineUpdate, {
          userId: search.userId,
          searchId: args.searchId,
          stage: "analysis",
          progress: progressPercent,
          message: `Analyzed ${totalProcessed} of ${leads.length} leads (${analyzedCount} successful, ${failedCount} failed)`,
          data: {
            currentBatch: batchIndex + 1,
            totalBatches: leadBatches.length,
            progress: {
              discovered: leads.length,
              enriched: leads.filter((l: any) => l.enrichmentStatus === "completed" || l.enrichmentStatus === "completed_fallback").length,
              analyzed: analyzedCount,
              failed: failedCount,
              total: leads.length,
            }
          }
        });

        // Add small delay between batches to prevent overwhelming the LangGraph service
        if (batchIndex < leadBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`AI analysis completed for search ${args.searchId}: ${analyzedCount}/${leads.length} leads analyzed`);

      // Complete the search
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