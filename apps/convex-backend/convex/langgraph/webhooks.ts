import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createOperationLogger } from "../lib/logger";
import { Id } from "../_generated/dataModel";

// Type definitions for LangGraph webhook payloads
const WebhookStatus = v.union(
  v.literal("completed"),
  v.literal("error"),
  v.literal("failed"),
  v.literal("test"),
);

const EmailGenerationResult = v.object({
  request_id: v.string(),
  status: WebhookStatus,
  timestamp: v.optional(v.string()),
  result: v.optional(
    v.object({
      relevance_score: v.optional(v.number()),
      pain_points_identified: v.optional(v.array(v.string())),
      value_matches: v.optional(v.array(v.string())),
      recommendations: v.optional(v.array(v.string())),
      lead_analysis: v.optional(v.any()),
      processing_time: v.optional(v.number()),
      primary_email: v.optional(
        v.union(
          v.null(),
          v.object({
            subject: v.string(),
            body: v.string(),
            personalization_notes: v.optional(v.array(v.string())),
            estimated_effectiveness: v.optional(v.number()),
          }),
        ),
      ),
      agent_results: v.optional(
        v.array(
          v.object({
            agentName: v.string(),
            role: v.string(),
            output: v.string(),
            confidenceScore: v.number(),
            executionTime: v.number(),
          }),
        ),
      ),
      // Deep research metadata
      deep_research_used: v.optional(v.boolean()),
      deep_research_reason: v.optional(v.union(v.string(), v.null())),
      additional_credits_used: v.optional(v.number()),
      missing_data_points: v.optional(v.array(v.string())),
      data_completeness_score: v.optional(v.number()),
    }),
  ),
  error: v.optional(v.string()),
  quality_score: v.optional(v.number()),
  approved: v.optional(v.boolean()),
});

const AnalysisResult = v.object({
  request_id: v.string(),
  lead_id: v.string(),
  status: WebhookStatus,
  timestamp: v.optional(v.string()),
  analysis: v.optional(
    v.object({
      relevance_score: v.number(),
      qualification_level: v.string(),
      fit_assessment: v.string(),
      key_factors: v.array(v.string()),
      opportunities: v.array(v.string()),
      red_flags: v.array(v.string()),
      confidence: v.number(),
      pain_points: v.array(v.string()),
      value_matches: v.array(v.string()),
      recommended_approach: v.string(),
    }),
  ),
  error: v.optional(v.string()),
  processing_time: v.optional(v.number()),
});

// Handle LangGraph email generation completion webhook
export const handleEmailGenerationCompleted = internalMutation({
  args: {
    payload: EmailGenerationResult,
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "email_generation_webhook",
    );
    const timer = logger.start(
      `Processing email generation webhook: ${args.payload.request_id}`,
    );

    try {
      const rawStatus = args.payload.status;
      const status = rawStatus === "failed" ? "error" : rawStatus;

      // Handle test webhook
      if (status === "test") {
        logger.info("Test webhook received", {
          requestId: args.payload.request_id,
        });
        return { success: true, message: "Test webhook processed" };
      }

      if (status !== "completed" && status !== "error") {
        logger.error(`Invalid status: ${rawStatus}`, {
          requestId: args.payload.request_id,
          status: rawStatus,
        });
        return { success: false, error: "Invalid status" };
      }

      // Extract search and lead IDs from request_id pattern: searchId_leadId_attempt
      const requestIdParts = args.payload.request_id.split("_");
      if (requestIdParts.length < 2) {
        logger.error(`Invalid request ID format: ${args.payload.request_id}`, {
          requestId: args.payload.request_id,
          parts: requestIdParts,
        });
        return { success: false, error: "Invalid request ID format" };
      }

      logger.debug("Webhook validation passed", {
        requestId: args.payload.request_id,
        status,
      });

      const [searchIdStr, leadIdStr] = requestIdParts as [
        string,
        string,
        ...string[],
      ];

      // Validate that the extracted IDs are valid Convex IDs
      let searchId: Id<"searches">;
      let leadId: Id<"leads">;

      try {
        // Try to convert strings to Convex IDs - this will throw if invalid
        searchId = searchIdStr as Id<"searches">;
        leadId = leadIdStr as Id<"leads">;

        // Basic validation - Convex IDs should be alphanumeric and of reasonable length
        if (!/^[a-zA-Z0-9]{16,32}$/.test(searchIdStr) || !/^[a-zA-Z0-9]{16,32}$/.test(leadIdStr)) {
          throw new Error("Invalid ID format");
        }
      } catch (error) {
        logger.error(`Invalid Convex IDs in request: ${args.payload.request_id}`, {
          searchIdStr,
          leadIdStr,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Invalid Convex ID format" };
      }

      // Get search and validate
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        {
          searchId,
        },
      );

      if (!search) {
        logger.error(`Search not found: ${searchId}`, {
          requestId: args.payload.request_id,
          searchId: searchIdStr,
        });
        return { success: false, error: "Search not found" };
      }

      // Get lead and validate
      const lead = await ctx.runQuery(internal.leads.internal.getLeadInternal, {
        leadId,
      });

      if (!lead) {
        console.error(`Lead not found: ${leadId}`);
        return { success: false, error: "Lead not found" };
      }

      // Find the request document for downstream status updates
      const requestDoc = await ctx.db
        .query("langgraphRequests")
        .withIndex("by_request_id", (q) =>
          q.eq("requestId", args.payload.request_id),
        )
        .unique();

      if (status === "completed") {
        if (!args.payload.result) {
          logger.error("Email completion webhook missing result payload", {
            requestId: args.payload.request_id,
          });
          return { success: false, error: "Missing result payload" };
        }

        // Process successful email generation
        const result = args.payload.result;

        const resultRecord = result as Record<string, unknown>;
        const followUpSequenceRaw =
          resultRecord["follow_up_sequence"] &&
          typeof resultRecord["follow_up_sequence"] === "object"
            ? (resultRecord["follow_up_sequence"] as Record<string, unknown>)
            : undefined;

        const followUpEmailsRaw: Array<Record<string, unknown>> = (() => {
          const direct = resultRecord["follow_up_emails"];
          if (Array.isArray(direct)) {
            return direct as Array<Record<string, unknown>>;
          }

          if (followUpSequenceRaw) {
            const emails = Array.isArray(followUpSequenceRaw["emails"])
              ? (followUpSequenceRaw["emails"] as Array<Record<string, unknown>>)
              : [];
            const timing = Array.isArray(followUpSequenceRaw["timing_schedule"])
              ? (followUpSequenceRaw["timing_schedule"] as Array<number>)
              : [];

            return emails.map((email, index) => {
              const delayFromSchedule =
                typeof timing[index] === "number" ? timing[index] : undefined;
              return {
                ...email,
                delay_days: delayFromSchedule,
              };
            });
          }

          return [];
        })();

        const formattedFollowUps = followUpEmailsRaw.map((followUp, index) => {
          const subjectRaw = followUp["subject"];
          const bodyRaw = followUp["body"];
          const delayRawCandidate = followUp["delay_days"] ?? followUp["delayDays"];
          const delayRaw =
            typeof delayRawCandidate === "number"
              ? delayRawCandidate
              : undefined;

          return {
            subject:
              typeof subjectRaw === "string"
                ? subjectRaw
                : `Follow Up ${index + 1}`,
            body: typeof bodyRaw === "string" ? bodyRaw : "",
            delay_days: delayRaw ?? (index + 1) * 3,
          };
        });

        const formattedOutput = result.primary_email && result.primary_email !== null
          ? {
              primary_email: {
                subject: result.primary_email.subject,
                body: result.primary_email.body,
                personalization_notes:
                  result.primary_email.personalization_notes || [],
                estimated_effectiveness:
                  result.primary_email.estimated_effectiveness || 0.15,
              },
              follow_up_emails: formattedFollowUps,
              relevance_score: result.relevance_score || 0,
              personalization_notes:
                result.primary_email.personalization_notes || [],
              estimated_response_rate:
                result.primary_email.estimated_effectiveness || 0.15,
              leadId,
              requestId: args.payload.request_id,
              processing_time: result.processing_time || 0,
              quality_score: args.payload.quality_score,
            }
          : undefined;

        if (requestDoc) {
          const additionalCredits =
            result.additional_credits_used && result.additional_credits_used > 0
              ? result.additional_credits_used
              : 0;

          await ctx.db.patch(requestDoc._id, {
            status: "completed",
            completedAt: Date.now(),
            processingTime:
              typeof result.processing_time === "number"
                ? result.processing_time
                : requestDoc.processingTime,
            creditsUsed: (requestDoc.creditsUsed || 0) + additionalCredits,
            outputData: {
              raw: result,
              formatted: formattedOutput,
              qualityScore: args.payload.quality_score,
              approved: args.payload.approved,
              followUpEmails: formattedFollowUps,
              followUpSequence: followUpSequenceRaw,
              status,
              timestamp: args.payload.timestamp,
            },
          });
        }

        // Update lead with AI analysis results
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: leadId as any,
          aiAnalysis: {
            relevanceScore: result.relevance_score || 0,
            painPoints: result.pain_points_identified || [],
            valueMatches: result.value_matches || [],
            recommendations: result.recommendations || [],
            leadAnalysis: result.lead_analysis || {},
            processingTime: result.processing_time || 0,
            confidence: result.relevance_score || 0.5,
          },
          emailContent: result.primary_email && result.primary_email !== null
            ? {
                subject: result.primary_email.subject,
                body: result.primary_email.body,
                personalizationNotes:
                  result.primary_email.personalization_notes || [],
                estimatedEffectiveness:
                  result.primary_email.estimated_effectiveness || 0.5,
              }
            : undefined,
        });

        // Process deep research tracking and credit charges
        if (result.deep_research_used) {
          logger.info("Processing deep research charge", {
            leadId,
            reason: result.deep_research_reason,
            additionalCredits: result.additional_credits_used,
            missingDataPoints: result.missing_data_points,
          });

          // Update lead with deep research metadata
          await ctx.db.patch(lead._id, {
            deepResearchUsed: true,
            deepResearchReason: result.deep_research_reason || "Deep research analysis",
            deepResearchTimestamp: Date.now(),
            deepResearchDataPoints: result.missing_data_points || [],
            deepResearchCreditsCharged: result.additional_credits_used || 0,
          });

          // Charge additional credits for deep research
          if (result.additional_credits_used && result.additional_credits_used > 0) {
            await ctx.runMutation(internal.credits.transactions.recordTransaction, {
              userId: search.userId,
              amount: result.additional_credits_used,
              operation: "usage",
              description: `Deep Research - ${result.deep_research_reason || "Enhanced business intelligence"}`,
              relatedEntityType: "lead",
              relatedEntityId: leadId,
            });

            logger.info("Deep research credits charged", {
              userId: search.userId,
              credits: result.additional_credits_used,
              leadId,
            });
          }
        }

        // Create email sequence record if we have email content (idempotent by request_id per lead)
        if (result.primary_email && result.primary_email !== null) {
          // Check existing sequences for this lead with same requestId
          const existingForLead = await ctx.db
            .query("emailSequences")
            .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
            .collect();
          const alreadyExists = existingForLead.some(
            (seq) => seq.requestId === args.payload.request_id,
          );

          if (!alreadyExists) {
            await ctx.runMutation(internal.leads.internal.createEmailSequence, {
              leadId: leadId as any,
              userId: search.userId,
              requestId: args.payload.request_id,
              emailContent: {
                subject: result.primary_email.subject,
                body: result.primary_email.body,
                personalizationNotes:
                  result.primary_email.personalization_notes || [],
                estimatedEffectiveness:
                  result.primary_email.estimated_effectiveness || 0.5,
              },
              agentResults: result.agent_results || [],
              processingTime: result.processing_time || 0,
              recommendations: result.recommendations || [],
            });
          }
        }

        // Broadcast success update via real-time status broadcast
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: searchId as any,
            stage: "email_generation_completed",
            progress: 100,
            message: `Personalized emails ready for ${lead.businessName}. Download them from Search History or continue reviewing.`,
            data: {
              stage: "email_generation_completed",
              redirectTo: "search-history",
              leadId: leadId,
              leadName: lead.businessName,
              relevanceScore: result.relevance_score || 0,
              qualityScore: args.payload.quality_score || 0,
              approved: args.payload.approved || false,
              emailGenerated: !!(result.primary_email && result.primary_email !== null),
              processingTime: result.processing_time || 0,
              requestId: args.payload.request_id,
            },
          },
        );

        await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
          userId: search.userId,
          type: "email_generation_completed",
          title: `Emails ready for ${lead.businessName}`,
          message:
            "We finished personalizing this lead. Visit Search History to review and export the CSV.",
          data: {
            searchId,
            leadId,
            requestId: args.payload.request_id,
            redirectTo: "search-history",
            downloadAvailable: true,
          },
          priority: "high",
          tags: ["email", "pipeline", "history"],
        });

        console.log(
          `Email generation completed successfully for lead ${leadId}`,
        );
        return {
          success: true,
          leadId,
          emailGenerated: !!(result.primary_email && result.primary_email !== null),
        };
      } else {
        // Handle error case
        const errorMessage = args.payload.error || "Unknown error";

        if (requestDoc) {
          await ctx.db.patch(requestDoc._id, {
            status: "failed",
            completedAt: Date.now(),
            error: errorMessage,
            outputData: {
              status: "error",
              error: errorMessage,
              timestamp: args.payload.timestamp,
            },
            processingTime: requestDoc.processingTime,
          });
        }

        // Update lead with error state
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: leadId as any,
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

        // Broadcast error via real-time status broadcast
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: searchId as any,
            stage: "analysis_failed",
            progress: 0,
            message: `AI analysis failed for ${lead.businessName}: ${errorMessage}`,
            error: errorMessage,
            data: {
              stage: "email_generation_failed",
              leadId: leadId,
              leadName: lead.businessName,
              error: errorMessage,
            },
          },
        );

        await ctx.runMutation(internal.realtime.broadcaster.broadcast, {
          userId: search.userId,
          type: "email_generation_failed",
          title: `Email generation failed for ${lead.businessName}`,
          message: errorMessage,
          data: {
            searchId,
            leadId,
            requestId: args.payload.request_id,
          },
          priority: "urgent",
          tags: ["email", "pipeline", "error"],
        });

        console.error(
          `Email generation failed for lead ${leadId}: ${errorMessage}`,
        );
        return { success: false, error: errorMessage, leadId };
      }
    } catch (error) {
      console.error("Error handling email generation webhook:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Handle LangGraph lead analysis completion webhook
export const handleAnalysisCompleted = internalMutation({
  args: {
    payload: AnalysisResult,
  },
  handler: async (ctx, args) => {
    try {
      console.log(`Processing analysis webhook: ${args.payload.request_id}`);

      // Validate required fields
      if (!args.payload.lead_id) {
        console.error("Missing lead_id in payload");
        return { success: false, error: "Missing lead_id" };
      }

      const rawStatus = args.payload.status;
      const status = rawStatus === "failed" ? "error" : rawStatus;

      if (status !== "completed" && status !== "error") {
        console.error(`Invalid analysis status: ${rawStatus}`);
        return { success: false, error: "Invalid status" };
      }

      const leadIdStr = args.payload.lead_id;
      if (!/^[a-zA-Z0-9]{16,32}$/.test(leadIdStr)) {
        console.error(`Invalid lead_id format: ${leadIdStr}`);
        return { success: false, error: "Invalid lead_id format" };
      }

      const leadId = leadIdStr as Id<"leads">;

      // Get lead and validate
      const lead = await ctx.runQuery(internal.leads.internal.getLeadInternal, {
        leadId: leadId as any,
      });

      if (!lead) {
        console.error(`Lead not found: ${args.payload.lead_id}`);
        return { success: false, error: "Lead not found" };
      }

      // Get search for broadcasting
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        {
          searchId: lead.searchId,
        },
      );

      if (!search) {
        console.error(`Search not found: ${lead.searchId}`);
        return { success: false, error: "Search not found" };
      }

      const requestDoc = await ctx.db
        .query("langgraphRequests")
        .withIndex("by_request_id", (q) =>
          q.eq("requestId", args.payload.request_id),
        )
        .unique();

      if (status === "completed") {
        if (!args.payload.analysis) {
          console.error("Analysis webhook missing analysis payload");
          return { success: false, error: "Missing analysis payload" };
        }

        // Process successful analysis
        const analysis = args.payload.analysis;

        // Update lead with analysis results
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: leadId as any,
          aiAnalysis: {
            relevanceScore: analysis.relevance_score,
            painPoints: analysis.pain_points,
            valueMatches: analysis.value_matches,
            recommendations: [analysis.recommended_approach],
            leadAnalysis: {
              qualification_level: analysis.qualification_level,
              fit_assessment: analysis.fit_assessment,
              key_factors: analysis.key_factors,
              opportunities: analysis.opportunities,
              red_flags: analysis.red_flags,
            },
            processingTime: args.payload.processing_time || 0,
            confidence: analysis.confidence,
            fitAssessment: analysis.fit_assessment,
            recommendedApproach: analysis.recommended_approach,
          },
          emailContent: undefined, // Analysis only, no email
        });

        if (requestDoc) {
          await ctx.db.patch(requestDoc._id, {
            status: "completed",
            completedAt: Date.now(),
            processingTime:
              args.payload.processing_time ?? requestDoc.processingTime ?? 0,
            outputData: {
              analysis,
              status,
              timestamp: args.payload.timestamp,
            },
          });
        }

        // Broadcast success update via real-time status broadcast
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: lead.searchId,
            stage: "lead_analysis_completed",
            progress: 100,
            message: `Lead analysis completed for ${lead.businessName}. Relevance: ${Math.round(analysis.relevance_score * 100)}%`,
            data: {
              leadId: args.payload.lead_id,
              leadName: lead.businessName,
              relevanceScore: analysis.relevance_score,
              qualificationLevel: analysis.qualification_level,
              keyFactors: analysis.key_factors.length,
              opportunities: analysis.opportunities.length,
              redFlags: analysis.red_flags.length,
              processingTime: args.payload.processing_time || 0,
            },
          },
        );

        console.log(
          `Analysis completed successfully for lead ${args.payload.lead_id}`,
        );
        return {
          success: true,
          leadId: args.payload.lead_id,
          relevanceScore: analysis.relevance_score,
        };
      } else {
        // Handle error case
        const errorMessage = args.payload.error || "Analysis failed";

        // Update lead with error state
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: leadId as any,
          aiAnalysis: {
            relevanceScore: 0,
            painPoints: [],
            valueMatches: [],
            recommendations: [`Analysis failed: ${errorMessage}`],
            leadAnalysis: { error: errorMessage },
            processingTime: args.payload.processing_time || 0,
            confidence: 0,
          },
          emailContent: undefined,
        });

        if (requestDoc) {
          await ctx.db.patch(requestDoc._id, {
            status: "failed",
            completedAt: Date.now(),
            processingTime: requestDoc.processingTime ?? 0,
            error: errorMessage,
            outputData: {
              status: "error",
              error: errorMessage,
              timestamp: args.payload.timestamp,
            },
          });
        }

        // Broadcast error via real-time status broadcast
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: lead.searchId,
            stage: "lead_analysis_failed",
            progress: 0,
            message: `Lead analysis failed for ${lead.businessName}: ${errorMessage}`,
            error: errorMessage,
            data: {
              leadId: args.payload.lead_id,
              leadName: lead.businessName,
              error: errorMessage,
            },
          },
        );

        console.error(
          `Analysis failed for lead ${args.payload.lead_id}: ${errorMessage}`,
        );
        return {
          success: false,
          error: errorMessage,
          leadId: args.payload.lead_id,
        };
      }
    } catch (error) {
      console.error("Error handling analysis webhook:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Legacy handlers (kept for backward compatibility)
export const handleAnalysisError = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(
      `Legacy handleAnalysisError called for lead ${args.leadId}: ${args.error}`,
    );
    // For legacy compatibility, just log the error
    // The new webhook handlers should be used for new integrations
    return {
      success: true,
      message: "Legacy handler - please update to new webhook format",
    };
  },
});

export const handleEmailGenerationWebhook = internalMutation({
  args: {
    searchId: v.id("searches"),
    leadId: v.id("leads"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    console.log(
      `Legacy handleEmailGenerationWebhook called for search ${args.searchId}, lead ${args.leadId}`,
    );
    // For legacy compatibility, just log
    // The new webhook handlers should be used for new integrations
    return {
      success: true,
      message: "Legacy handler - please update to new webhook format",
    };
  },
});

export const handleAnalysisWebhook = internalMutation({
  args: {
    searchId: v.id("searches"),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    console.log(
      `Legacy analysis webhook for search ${args.searchId} - consider updating to new handler`,
    );
    return {
      success: true,
      message: "Legacy handler - please update to new webhook format",
    };
  },
});
