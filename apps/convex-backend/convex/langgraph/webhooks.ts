import { internalMutation } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";
import { createOperationLogger } from "../lib/logger";
import { Id, Doc } from "../_generated/dataModel";

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
      // Research tier tracking from LangGraph
      research_tier: v.optional(v.string()),
      // Structured company data from research extraction
      company_data: v.optional(v.any()),
      follow_up_sequence: v.optional(
        v.union(
          v.null(),
          v.object({
            sequence_id: v.optional(v.string()),
            emails: v.optional(v.array(v.any())),
            timing_schedule: v.optional(v.array(v.number())),
            conversion_strategy: v.optional(v.string()),
          }),
        ),
      ),
      follow_up_emails: v.optional(v.array(v.any())),
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

      const userDoc = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: search.userId,
      });
      const isEnterpriseUser = userDoc?.plan === "enterprise";

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

        // IMPORTANT: Validate approval status before processing
        // Only accept emails that are explicitly approved by QA agent (approved=true)
        // Quality score is metadata - QA agent handles quality validation through retry loop
        const isApproved = args.payload.approved === true;
        const qualityScore = args.payload.quality_score || 0;

        if (!isApproved) {
          logger.warn("Email webhook rejected - not approved by QA agent", {
            requestId: args.payload.request_id,
            approved: isApproved,
            qualityScore: qualityScore,
          });

          // Mark lead as failed analysis rather than accepting unapproved email
          await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
            leadId: leadId as any,
            error: `Email not approved by QA agent (quality score: ${qualityScore.toFixed(2)})`,
          });

          // Acknowledge webhook but don't store unapproved email
          return {
            success: true,
            rejected: true,
            reason: "Email not approved by QA agent",
            qualityScore,
            approved: isApproved,
          };
        }

        // Process successful email generation (only approved emails reach here)
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
            creditsUsed: isEnterpriseUser
              ? 0
              : (requestDoc.creditsUsed || 0) + additionalCredits,
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

        // Update lead with AI analysis results and follow-up emails
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
            // Research tier tracking from LangGraph ("basic", "pro", or "deep")
            researchTier: result.research_tier,
            // Structured company data from research extraction
            companyData: result.company_data,
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
          followUpEmails: formattedFollowUps.length > 0 ? formattedFollowUps : undefined,
        });

        // Mark lead analysis as completed (async tracking)
        await ctx.runMutation(internal.leads.internal.markLeadAnalysisCompleted, {
          leadId: leadId as any,
        });

        // Track deep research usage for per-lead credit charging
        const deepResearchUsed = Boolean(result.deep_research_used);
        const deepResearchProvider = deepResearchUsed ? "perplexity" : "tavily";
        const deepResearchReason = deepResearchUsed
          ? result.deep_research_reason || "Deep research analysis"
          : result.deep_research_reason || "Level one provider satisfied";

        await ctx.db.patch(lead._id, {
          deepResearchUsed,
          deepResearchProvider,
          deepResearchReason,
          deepResearchTimestamp: Date.now(),
          deepResearchDataPoints: deepResearchUsed
            ? result.missing_data_points || []
            : [],
          deepResearchCreditsCharged: 0, // Credits charged at search completion, not per-lead
        });

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

        // Calculate search-level progress
        const allLeads = await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          { searchId: searchId as any },
        );

        // Filter to only eligible leads (same criteria as getLeadsForAnalysis)
        // This ensures we only count leads that should be analyzed
        const eligibleLeads = allLeads.filter((l: Doc<"leads">) => {
          const enrichmentComplete =
            l.enrichmentStatus === "completed" ||
            l.enrichmentStatus === "completed_fallback";
          const hasEmail = Boolean(l.contactInfo?.emails?.length);
          const hasContactName = Boolean(l.contactInfo?.contacts?.[0]?.name);
          return enrichmentComplete && hasEmail && hasContactName;
        });

        const completedLeads = eligibleLeads.filter(
          (l: Doc<"leads">) => l.analysisStatus === "completed",
        ).length;
        const totalLeads = eligibleLeads.length;
        const progressPercent = totalLeads > 0 ? (completedLeads / totalLeads) * 100 : 0;

        // Broadcast success update via real-time status broadcast
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: searchId as any,
            stage: "analysis",
            progress: progressPercent,
            message: `Analyzed ${completedLeads} of ${totalLeads} leads - ${lead.businessName} complete`,
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
              progress: {
                discovered: allLeads.length,
                enriched: allLeads.filter(
                  (l: Doc<"leads">) =>
                    l.enrichmentStatus === "completed" ||
                    l.enrichmentStatus === "completed_fallback",
                ).length,
                analyzed: completedLeads,
                total: totalLeads, // Use eligible leads count
              },
            },
          },
        );

        // Check if all eligible leads are complete and trigger search completion
        // Use idempotency guard to prevent race conditions when multiple webhooks complete simultaneously
        const scheduledOrProcessing = eligibleLeads.filter(
          (l: Doc<"leads">) =>
            l.analysisStatus === "scheduled" || l.analysisStatus === "processing",
        ).length;

        if (scheduledOrProcessing === 0 && completedLeads === totalLeads && totalLeads > 0) {
          // Verify search is still in processing state (idempotency check)
          // This prevents race conditions when multiple webhooks complete simultaneously
          const currentSearch = await ctx.db.get(searchId);
          if (
            currentSearch &&
            (currentSearch.status === "processing" || currentSearch.status === "in_progress")
          ) {
            // All leads are complete! Trigger search completion
            // Note: completeSearch action handles final status transition and idempotency
            logger.info("All leads analyzed - triggering search completion", {
              searchId: searchIdStr,
              totalLeads,
              completedLeads,
              eligibleLeads: eligibleLeads.length,
            });

            try {
              await ctx.scheduler.runAfter(
                0,
                "search/actions:completeSearch" as any,
                {
                  searchId: searchId,
                },
              );

              logger.info("Search completion scheduled successfully", { searchId: searchIdStr });
            } catch (error) {
              logger.error("Failed to schedule search completion", {
                searchId: searchIdStr,
                error: error instanceof Error ? error.message : String(error),
              });

              throw error; // Re-throw to trigger webhook retry
            }
          }
        }

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

        // Mark lead analysis as failed (async tracking)
        await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
          leadId: leadId as any,
          error: errorMessage,
        });

        // Calculate search-level progress (including failures)
        const allLeads = await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          { searchId: searchId as any },
        );

        // Filter to only eligible leads (same criteria as getLeadsForAnalysis)
        const eligibleLeads = allLeads.filter((l: Doc<"leads">) => {
          const enrichmentComplete =
            l.enrichmentStatus === "completed" ||
            l.enrichmentStatus === "completed_fallback";
          const hasEmail = Boolean(l.contactInfo?.emails?.length);
          const hasContactName = Boolean(l.contactInfo?.contacts?.[0]?.name);
          return enrichmentComplete && hasEmail && hasContactName;
        });

        const completedLeads = eligibleLeads.filter(
          (l: Doc<"leads">) => l.analysisStatus === "completed",
        ).length;
        const failedLeads = eligibleLeads.filter(
          (l: Doc<"leads">) => l.analysisStatus === "failed",
        ).length;
        const totalLeads = eligibleLeads.length;
        const processedLeads = completedLeads + failedLeads;
        const progressPercent = totalLeads > 0 ? (processedLeads / totalLeads) * 100 : 0;

        // Broadcast error via real-time status broadcast
        await ctx.runMutation(
          internal.realtime.broadcaster.broadcastPipelineUpdate,
          {
            userId: search.userId,
            searchId: searchId as any,
            stage: "analysis",
            progress: progressPercent,
            message: `Analyzed ${processedLeads} of ${totalLeads} leads (${completedLeads} successful, ${failedLeads} failed)`,
            error: `Failed: ${lead.businessName} - ${errorMessage}`,
            data: {
              stage: "email_generation_failed",
              leadId: leadId,
              leadName: lead.businessName,
              error: errorMessage,
              progress: {
                discovered: allLeads.length,
                enriched: allLeads.filter(
                  (l: Doc<"leads">) =>
                    l.enrichmentStatus === "completed" ||
                    l.enrichmentStatus === "completed_fallback",
                ).length,
                analyzed: completedLeads,
                failed: failedLeads,
                total: totalLeads, // Use eligible leads count
              },
            },
          },
        );

        // Check if all eligible leads are processed (complete or failed) and trigger search completion
        // Use idempotency guard to prevent race conditions
        const scheduledOrProcessing = eligibleLeads.filter(
          (l: Doc<"leads">) =>
            l.analysisStatus === "scheduled" || l.analysisStatus === "processing",
        ).length;

        if (scheduledOrProcessing === 0 && processedLeads === totalLeads && totalLeads > 0) {
          // Verify search is still in processing state (idempotency check)
          // This prevents race conditions when multiple webhooks complete simultaneously
          const currentSearch = await ctx.db.get(searchId);
          if (
            currentSearch &&
            (currentSearch.status === "processing" || currentSearch.status === "in_progress")
          ) {
            // All leads are processed! Trigger search completion
            // Note: completeSearch action handles final status transition and idempotency
            logger.info("All leads processed - triggering search completion", {
              searchId: searchIdStr,
              totalLeads,
              completedLeads,
              failedLeads,
              eligibleLeads: eligibleLeads.length,
            });

            try {
              await ctx.scheduler.runAfter(
                0,
                "search/actions:completeSearch" as any,
                {
                  searchId: searchId,
                },
              );

              logger.info("Search completion scheduled successfully", { searchId: searchIdStr });
            } catch (error) {
              logger.error("Failed to schedule search completion", {
                searchId: searchIdStr,
                error: error instanceof Error ? error.message : String(error),
              });

              throw error; // Re-throw to trigger webhook retry
            }
          }
        }

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
        // Always acknowledge error payloads so the worker does not retry the webhook indefinitely
        return {
          success: true,
          error: errorMessage,
          leadId,
        };
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
        // Always acknowledge error payloads so the worker does not retry the webhook indefinitely
        return {
          success: true,
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

// Batch processing webhook handlers

const BatchProgressUpdate = v.object({
  batchId: v.string(),
  searchId: v.string(),
  progressPercent: v.number(),
  completedCount: v.number(),
  totalCount: v.number(),
  successCount: v.number(),
  failureCount: v.number(),
  currentLead: v.optional(v.union(v.string(), v.null())),
  estimatedTimeRemaining: v.optional(v.union(v.number(), v.null())),
  timestamp: v.optional(v.string()), // Worker sends ISO timestamp for batch progress
});

const BatchLeadResult = v.object({
  leadId: v.string(),
  status: v.union(v.literal("completed"), v.literal("failed")),
  result: v.optional(v.any()),
  error: v.optional(v.union(v.string(), v.null())),
  processingTime: v.number(),
});

const BatchCompletionPayload = v.object({
  batchId: v.string(),
  searchId: v.string(),
  status: v.union(
    v.literal("completed"),
    v.literal("partial"),
    v.literal("failed"),
  ),
  results: v.array(BatchLeadResult),
  summary: v.any(),
  totalProcessingTime: v.number(),
  timestamp: v.optional(v.string()), // Worker sends ISO timestamp for batch completion
});

/**
 * Handle batch progress updates (sent every 10 leads)
 * Non-critical webhook - logs progress and broadcasts to frontend
 */
export const handleBatchProgress = internalMutation({
  args: {
    payload: BatchProgressUpdate,
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "batch_progress_webhook",
    );
    const timer = logger.start(`Processing batch progress: ${args.payload.batchId}`);

    try {
      const { batchId, searchId, progressPercent, completedCount, totalCount, successCount, failureCount, currentLead } = args.payload;

      logger.info("Batch progress update received", {
        batchId,
        searchId,
        progressPercent: `${progressPercent.toFixed(1)}%`,
        completed: `${completedCount}/${totalCount}`,
        successRate: `${successCount}/${completedCount}`,
      });

      // Validate search ID format
      if (!/^[a-zA-Z0-9]{16,32}$/.test(searchId)) {
        logger.error(`Invalid searchId format: ${searchId}`, { batchId });
        return { success: false, error: "Invalid searchId format" };
      }

      const searchIdTyped = searchId as Id<"searches">;

      // Get search
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        { searchId: searchIdTyped },
      );

      if (!search) {
        logger.error(`Search not found: ${searchId}`, { batchId });
        return { success: false, error: "Search not found" };
      }

      // Broadcast progress update to frontend
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: search.userId,
          searchId: searchIdTyped,
          stage: "analysis",
          progress: progressPercent,
          message: currentLead
            ? `Analyzing ${currentLead} (${completedCount}/${totalCount} complete)`
            : `Analyzed ${completedCount} of ${totalCount} leads (${successCount} successful, ${failureCount} failed)`,
          data: {
            batchId,
            stage: "batch_analysis_progress",
            completedCount,
            totalCount,
            successCount,
            failureCount,
            currentLead,
            progressPercent,
          },
        },
      );

      logger.info("Batch progress broadcast complete", {
        batchId,
        progressPercent: `${progressPercent.toFixed(1)}%`,
      });

      return {
        success: true,
        batchId,
        progressPercent,
      };
    } catch (error) {
      logger.error("Error handling batch progress webhook", {
        batchId: args.payload.batchId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Non-critical webhook - don't fail
      return {
        success: true,
        warning: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Handle batch completion with all lead results
 * Critical webhook - processes all lead results and triggers search completion
 */
export const handleBatchCompleted = internalMutation({
  args: {
    payload: BatchCompletionPayload,
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "batch_completion_webhook",
    );
    const timer = logger.start(`Processing batch completion: ${args.payload.batchId}`);

    try {
      const { batchId, searchId, status, results, summary, totalProcessingTime } = args.payload;

      logger.info("Batch completion received", {
        batchId,
        searchId,
        status,
        totalLeads: results.length,
        successCount: results.filter((r) => r.status === "completed").length,
        failureCount: results.filter((r) => r.status === "failed").length,
        processingTime: `${totalProcessingTime.toFixed(2)}s`,
      });

      // Validate search ID format
      if (!/^[a-zA-Z0-9]{16,32}$/.test(searchId)) {
        logger.error(`Invalid searchId format: ${searchId}`, { batchId });
        return { success: false, error: "Invalid searchId format" };
      }

      const searchIdTyped = searchId as Id<"searches">;

      // Get search
      const search = await ctx.runQuery(
        internal.search.internal.getSearchInternal,
        { searchId: searchIdTyped },
      );

      if (!search) {
        logger.error(`Search not found: ${searchId}`, { batchId });
        return { success: false, error: "Search not found" };
      }

      const userDoc = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: search.userId,
      });
      const isEnterpriseUser = userDoc?.plan === "enterprise";

      // Process each lead result
      let processedSuccessfully = 0;
      let processingErrors = 0;

      for (const leadResult of results) {
        try {
          // Validate lead ID format
          if (!/^[a-zA-Z0-9]{16,32}$/.test(leadResult.leadId)) {
            logger.error(`Invalid leadId format: ${leadResult.leadId}`, { batchId });
            processingErrors++;
            continue;
          }

          const leadIdTyped = leadResult.leadId as Id<"leads">;

          // Get lead
          const lead = await ctx.runQuery(internal.leads.internal.getLeadInternal, {
            leadId: leadIdTyped,
          });

          if (!lead) {
            logger.error(`Lead not found: ${leadResult.leadId}`, { batchId });
            processingErrors++;
            continue;
          }

          if (leadResult.status === "completed" && leadResult.result) {
            // Process successful lead result (similar to handleEmailGenerationCompleted)
            const result = leadResult.result;

            // Format follow-up emails
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

            // Update lead with AI analysis and email content
            await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
              leadId: leadIdTyped as any,
              aiAnalysis: {
                relevanceScore: result.relevance_score || 0,
                painPoints: result.pain_points_identified || [],
                valueMatches: result.value_matches || [],
                recommendations: result.recommendations || [],
                leadAnalysis: result.lead_analysis || {},
                processingTime: leadResult.processingTime,
                confidence: result.relevance_score || 0.5,
              },
              emailContent:
                result.primary_email && result.primary_email !== null
                  ? {
                      subject: result.primary_email.subject,
                      body: result.primary_email.body,
                      personalizationNotes:
                        result.primary_email.personalization_notes || [],
                      estimatedEffectiveness:
                        result.primary_email.estimated_effectiveness || 0.5,
                    }
                  : undefined,
              followUpEmails:
                formattedFollowUps.length > 0 ? formattedFollowUps : undefined,
            });

            // Mark lead analysis as completed
            await ctx.runMutation(internal.leads.internal.markLeadAnalysisCompleted, {
              leadId: leadIdTyped as any,
            });

            // Handle deep research credits for non-enterprise users
            const deepResearchUsed = Boolean(result.deep_research_used);
            if (deepResearchUsed && !isEnterpriseUser && result.additional_credits_used > 0) {
              await ctx.runMutation(internal.credits.transactions.recordTransaction, {
                userId: search.userId,
                amount: result.additional_credits_used,
                operation: "usage",
                description: `Deep Research - ${result.deep_research_reason || "Enhanced business intelligence"}`,
                relatedEntityType: "lead",
                relatedEntityId: leadIdTyped,
              });
            }

            // Update deep research metadata
            await ctx.db.patch(lead._id, {
              deepResearchUsed,
              deepResearchProvider: deepResearchUsed ? "perplexity" : "tavily",
              deepResearchReason:
                result.deep_research_reason ||
                (deepResearchUsed ? "Deep research analysis" : "Level one provider satisfied"),
              deepResearchTimestamp: Date.now(),
              deepResearchDataPoints: deepResearchUsed
                ? result.missing_data_points || []
                : [],
              deepResearchCreditsCharged:
                deepResearchUsed && result.additional_credits_used
                  ? result.additional_credits_used
                  : 0,
            });

            // Create email sequence if we have email content
            if (result.primary_email && result.primary_email !== null) {
              const requestId = `${batchId}_${leadIdTyped}`;

              // Check if sequence already exists
              const existingForLead = await ctx.db
                .query("emailSequences")
                .withIndex("by_lead", (q) => q.eq("leadId", lead._id))
                .collect();
              const alreadyExists = existingForLead.some(
                (seq) => seq.requestId === requestId,
              );

              if (!alreadyExists) {
                await ctx.runMutation(internal.leads.internal.createEmailSequence, {
                  leadId: leadIdTyped as any,
                  userId: search.userId,
                  requestId,
                  emailContent: {
                    subject: result.primary_email.subject,
                    body: result.primary_email.body,
                    personalizationNotes:
                      result.primary_email.personalization_notes || [],
                    estimatedEffectiveness:
                      result.primary_email.estimated_effectiveness || 0.5,
                  },
                  agentResults: result.agent_results || [],
                  processingTime: leadResult.processingTime,
                  recommendations: result.recommendations || [],
                });
              }
            }

            processedSuccessfully++;
          } else {
            // Handle failed lead result
            const errorMessage = leadResult.error || "Analysis failed";

            await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
              leadId: leadIdTyped as any,
              aiAnalysis: {
                relevanceScore: 0,
                painPoints: [],
                valueMatches: [],
                recommendations: [`Analysis failed: ${errorMessage}`],
                leadAnalysis: { error: errorMessage },
                processingTime: leadResult.processingTime,
                confidence: 0,
              },
              emailContent: undefined,
            });

            await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
              leadId: leadIdTyped as any,
              error: errorMessage,
            });

            processedSuccessfully++;
          }
        } catch (error) {
          logger.error("Error processing lead result", {
            batchId,
            leadId: leadResult.leadId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          processingErrors++;
        }
      }

      // Calculate overall search progress
      const allLeads = await ctx.runQuery(
        internal.leads.internal.getSearchLeadsInternal,
        { searchId: searchIdTyped },
      );

      const eligibleLeads = allLeads.filter((l: Doc<"leads">) => {
        const enrichmentComplete =
          l.enrichmentStatus === "completed" ||
          l.enrichmentStatus === "completed_fallback";
        const hasEmail = Boolean(l.contactInfo?.emails?.length);
        const hasContactName = Boolean(l.contactInfo?.contacts?.[0]?.name);
        return enrichmentComplete && hasEmail && hasContactName;
      });

      const completedLeads = eligibleLeads.filter(
        (l: Doc<"leads">) => l.analysisStatus === "completed",
      ).length;
      const failedLeads = eligibleLeads.filter(
        (l: Doc<"leads">) => l.analysisStatus === "failed",
      ).length;
      const totalLeads = eligibleLeads.length;
      const processedLeads = completedLeads + failedLeads;
      const progressPercent = totalLeads > 0 ? (processedLeads / totalLeads) * 100 : 0;

      // Broadcast batch completion with clear success messaging
      const successRate = totalLeads > 0 ? (completedLeads / totalLeads) * 100 : 0;
      const isHighSuccess = successRate >= 95; // 95%+ success rate

      let completionMessage: string;
      if (failedLeads === 0) {
        completionMessage = `Batch complete: All ${completedLeads} leads analyzed successfully`;
      } else if (isHighSuccess) {
        completionMessage = `Batch complete: ${completedLeads} analyzed successfully (${failedLeads} skipped, ${successRate.toFixed(1)}% success)`;
      } else {
        completionMessage = `Batch complete: ${completedLeads} analyzed, ${failedLeads} skipped (${processedLeads}/${totalLeads} total)`;
      }

      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: search.userId,
          searchId: searchIdTyped,
          stage: "analysis",
          progress: progressPercent,
          message: completionMessage,
          data: {
            batchId,
            stage: "batch_analysis_completed",
            status,
            processedSuccessfully,
            processingErrors,
            totalProcessingTime,
            successRate,
            progress: {
              discovered: allLeads.length,
              enriched: allLeads.filter(
                (l: Doc<"leads">) =>
                  l.enrichmentStatus === "completed" ||
                  l.enrichmentStatus === "completed_fallback",
              ).length,
              analyzed: completedLeads,
              failed: failedLeads,
              total: totalLeads,
            },
          },
        },
      );

      // Check if all leads are processed and trigger search completion
      const scheduledOrProcessing = eligibleLeads.filter(
        (l: Doc<"leads">) =>
          l.analysisStatus === "scheduled" || l.analysisStatus === "processing",
      ).length;

      if (scheduledOrProcessing === 0 && processedLeads === totalLeads && totalLeads > 0) {
        const currentSearch = await ctx.db.get(searchIdTyped);

        // Atomic check-and-set to prevent race conditions from multiple batch completions
        if (
          currentSearch &&
          (currentSearch.status === "processing" || currentSearch.status === "in_progress") &&
          !currentSearch.completionTriggered // Check flag atomically
        ) {
          logger.info("All leads processed - triggering search completion", {
            searchId,
            batchId,
            totalLeads,
            completedLeads,
            failedLeads,
          });

          // Set completion flag immediately to prevent duplicate triggers
          await ctx.db.patch(searchIdTyped, {
            completionTriggered: true,
            completionTriggeredAt: Date.now(),
          });

          // Schedule completion after setting flag with proper error handling
          try {
            await ctx.scheduler.runAfter(
              0,
              (api as any).search.actions.completeSearch,
              { searchId: searchIdTyped },
            );

            logger.info("Search completion scheduled successfully", { searchId, batchId });
          } catch (error) {
            logger.error("Failed to schedule search completion", {
              searchId,
              batchId,
              error: error instanceof Error ? error.message : String(error),
            });

            // Rollback flag if scheduler fails
            await ctx.db.patch(searchIdTyped, {
              completionTriggered: false,
              completionTriggeredAt: undefined,
            });

            throw error; // Re-throw to trigger webhook retry
          }
        }
      }

      logger.info("Batch completion processed successfully", {
        batchId,
        processedSuccessfully,
        processingErrors,
        totalProcessingTime: `${totalProcessingTime.toFixed(2)}s`,
      });

      return {
        success: true,
        batchId,
        processedSuccessfully,
        processingErrors,
      };
    } catch (error) {
      logger.error("Error handling batch completion webhook", {
        batchId: args.payload.batchId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

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
