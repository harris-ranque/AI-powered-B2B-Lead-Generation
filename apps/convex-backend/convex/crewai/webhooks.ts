import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Handle email generation webhook from CrewAI
export const handleEmailGenerationWebhook = internalMutation({
  args: {
    requestId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    processingTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get the CrewAI request
    const request = await ctx.db
      .query("crewaiRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (!request) {
      console.error(`CrewAI request not found: ${args.requestId}`);
      return;
    }

    try {
      // Update request status
      const updateData: any = {
        status: args.status,
        outputData: args.result,
        completedAt: Date.now(),
      };
      
      if (args.error !== undefined) {
        updateData.error = args.error;
      }
      
      if (args.processingTime !== undefined) {
        updateData.processingTime = args.processingTime;
      }
      
      await ctx.db.patch(request._id, updateData);

      if (args.status === "completed" && args.result && request.leadId) {
        // Store email sequence in database
        const emailSequenceId = await ctx.db.insert("emailSequences", {
          leadId: request.leadId,
          userId: request.userId,
          requestId: args.requestId,
          subject: args.result.primary_email?.subject || "",
          body: args.result.primary_email?.body || "",
          tone: args.result.primary_email?.tone || "professional",
          personalizationNotes: args.result.primary_email?.personalization_notes || [],
          sequenceType: "primary",
          sequenceOrder: 1,
          agentResults: args.result.agent_results || [],
          estimatedEffectiveness: args.result.primary_email?.estimated_effectiveness || 0,
          recommendations: args.result.recommendations || [],
          processingTime: args.processingTime || 0,
          status: "generated",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        // Add email sequence to lead
        await ctx.runMutation(internal.leads.internal.addGeneratedEmailToLead, {
          leadId: request.leadId,
          emailSequenceId,
        });

        // Create follow-up emails if requested
        if (args.result.follow_up_sequence && Array.isArray(args.result.follow_up_sequence)) {
          for (let i = 0; i < args.result.follow_up_sequence.length; i++) {
            const followUp = args.result.follow_up_sequence[i];
            
            const followUpId = await ctx.db.insert("emailSequences", {
              leadId: request.leadId,
              userId: request.userId,
              requestId: args.requestId,
              subject: followUp.subject || "",
              body: followUp.body || "",
              tone: followUp.tone || "professional",
              personalizationNotes: followUp.personalization_notes || [],
              sequenceType: "follow_up",
              sequenceOrder: i + 2, // Start from 2 since primary is 1
              agentResults: [],
              estimatedEffectiveness: followUp.estimated_effectiveness || 0,
              recommendations: [],
              processingTime: 0,
              status: "generated",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });

            await ctx.runMutation(internal.leads.internal.addGeneratedEmailToLead, {
              leadId: request.leadId,
              emailSequenceId: followUpId,
            });
          }
        }

        // Send success notification
        await ctx.db.insert("notifications", {
          userId: request.userId,
          type: "email_sent",
          title: "Email Generated Successfully! 🎉",
          message: `AI-powered email has been generated for your lead. Check the results and customize as needed.`,
          data: { 
            requestId: args.requestId,
            leadId: request.leadId,
            emailSequenceId,
            effectiveness: args.result.primary_email?.estimated_effectiveness,
          },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });

      } else if (args.status === "failed") {
        // Send failure notification
        await ctx.db.insert("notifications", {
          userId: request.userId,
          type: "system_alert",
          title: "Email Generation Failed",
          message: `Email generation failed: ${args.error || "Unknown error"}. Please try again.`,
          data: { 
            requestId: args.requestId,
            leadId: request.leadId,
            error: args.error,
          },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });
      }

    } catch (error) {
      console.error("Error processing email generation webhook:", error);
      
      // Update request with processing error
      await ctx.db.patch(request._id, {
        status: "failed",
        error: `Webhook processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
        completedAt: Date.now(),
      });
    }
  },
});

// Handle lead analysis webhook from CrewAI
export const handleAnalysisWebhook = internalMutation({
  args: {
    requestId: v.string(),
    leadId: v.optional(v.string()),
    status: v.union(v.literal("completed"), v.literal("failed")),
    analysis: v.optional(v.any()),
    error: v.optional(v.string()),
    processingTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get the CrewAI request
    const request = await ctx.db
      .query("crewaiRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (!request) {
      console.error(`CrewAI request not found: ${args.requestId}`);
      return;
    }

    try {
      // Update request status
      const updateData: any = {
        status: args.status,
        outputData: args.analysis,
        completedAt: Date.now(),
      };
      
      if (args.error !== undefined) {
        updateData.error = args.error;
      }
      
      if (args.processingTime !== undefined) {
        updateData.processingTime = args.processingTime;
      }
      
      await ctx.db.patch(request._id, updateData);

      if (args.status === "completed" && args.analysis && request.leadId) {
        // Update lead with analysis results
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: request.leadId,
          aiAnalysis: {
            relevanceScore: args.analysis.relevance_score || 0,
            painPoints: args.analysis.pain_points || [],
            valueMatches: args.analysis.value_matches || [],
            fitAssessment: args.analysis.fit_assessment || "",
            recommendedApproach: args.analysis.recommended_approach || "",
            confidence: args.analysis.confidence || 0,
          },
        });

        // Update search progress with new analysis
        const lead = await ctx.db.get(request.leadId);
        if (lead) {
          const progressData = await ctx.runQuery(internal.leads.internal.getSearchProgressData, {
            searchId: lead.searchId,
          });

          await ctx.runMutation(internal.search.internal.updateSearchProgress, {
            searchId: lead.searchId,
            analyzed: progressData.analyzedLeads,
            avgRelevanceScore: progressData.avgRelevanceScore,
          });
        }

        // Send notification for high-relevance leads
        if (args.analysis.relevance_score >= 0.7) {
          await ctx.db.insert("notifications", {
            userId: request.userId,
            type: "system_alert",
            title: "High-Quality Lead Identified! ⭐",
            message: `A lead with ${Math.round(args.analysis.relevance_score * 100)}% relevance has been analyzed. Consider prioritizing this lead.`,
            data: { 
              requestId: args.requestId,
              leadId: request.leadId,
              relevanceScore: args.analysis.relevance_score,
              painPoints: args.analysis.pain_points,
            },
            read: false,
            sent: false,
            createdAt: Date.now(),
          });
        }

      } else if (args.status === "failed") {
        // Send failure notification
        await ctx.db.insert("notifications", {
          userId: request.userId,
          type: "system_alert",
          title: "Lead Analysis Failed",
          message: `Lead analysis failed: ${args.error || "Unknown error"}. Please try again.`,
          data: { 
            requestId: args.requestId,
            leadId: request.leadId,
            error: args.error,
          },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });
      }

    } catch (error) {
      console.error("Error processing analysis webhook:", error);
      
      // Update request with processing error
      await ctx.db.patch(request._id, {
        status: "failed",
        error: `Webhook processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
        completedAt: Date.now(),
      });
    }
  },
});

// Handle bulk analysis completion webhook
export const handleBulkAnalysisWebhook = internalMutation({
  args: {
    requestId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    results: v.optional(v.array(v.any())),
    error: v.optional(v.string()),
    processingTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get the CrewAI request
    const request = await ctx.db
      .query("crewaiRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();

    if (!request) {
      console.error(`CrewAI request not found: ${args.requestId}`);
      return;
    }

    try {
      // Update request status
      const updateData: any = {
        status: args.status,
        outputData: args.results,
        completedAt: Date.now(),
      };
      
      if (args.error !== undefined) {
        updateData.error = args.error;
      }
      
      if (args.processingTime !== undefined) {
        updateData.processingTime = args.processingTime;
      }
      
      await ctx.db.patch(request._id, updateData);

      if (args.status === "completed" && args.results) {
        let processedCount = 0;
        let highQualityCount = 0;

        // Process each analysis result
        for (const result of args.results) {
          if (result.lead_id && result.analysis) {
            try {
              await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
                leadId: result.lead_id,
                aiAnalysis: {
                  relevanceScore: result.analysis.relevance_score || 0,
                  painPoints: result.analysis.pain_points || [],
                  valueMatches: result.analysis.value_matches || [],
                  fitAssessment: result.analysis.fit_assessment || "",
                  recommendedApproach: result.analysis.recommended_approach || "",
                  confidence: result.analysis.confidence || 0,
                },
              });

              processedCount++;

              if (result.analysis.relevance_score >= 0.7) {
                highQualityCount++;
              }
            } catch (error) {
              console.error(`Error updating lead ${result.lead_id}:`, error);
            }
          }
        }

        // Send completion notification
        await ctx.db.insert("notifications", {
          userId: request.userId,
          type: "system_alert",
          title: "Bulk Analysis Complete! 📊",
          message: `${processedCount} leads analyzed successfully. ${highQualityCount} high-quality leads identified.`,
          data: { 
            requestId: args.requestId,
            processedCount,
            highQualityCount,
            totalTime: args.processingTime,
          },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });

      } else if (args.status === "failed") {
        // Send failure notification
        await ctx.db.insert("notifications", {
          userId: request.userId,
          type: "system_alert",
          title: "Bulk Analysis Failed",
          message: `Bulk analysis failed: ${args.error || "Unknown error"}. Please try again.`,
          data: { 
            requestId: args.requestId,
            error: args.error,
          },
          read: false,
          sent: false,
          createdAt: Date.now(),
        });
      }

    } catch (error) {
      console.error("Error processing bulk analysis webhook:", error);
      
      // Update request with processing error
      await ctx.db.patch(request._id, {
        status: "failed",
        error: `Webhook processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
        completedAt: Date.now(),
      });
    }
  },
});