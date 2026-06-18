import { internalMutation } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";
import { createOperationLogger } from "../lib/logger";
import { Id } from "../_generated/dataModel";
import { extractDomainFromWebsite } from "../lib/contactVerification";
import { hasAcceptedContactsAwaitingAnalysis } from "../lib/analysisProgress";
import { slimLeadAnalysisForContactStorage } from "../lib/contactAnalysisStorage";
import { insertPipelineBroadcast } from "../realtime/broadcaster";
import {
  buildWebhookResearchPayload,
  leadAnalysisHasSaveableResearch,
} from "../lib/exportResearchFields";

const BatchLeadResultArg = v.object({
  leadId: v.string(),
  contactId: v.optional(v.string()),
  status: v.union(v.literal("completed"), v.literal("failed")),
  result: v.optional(v.any()),
  error: v.optional(v.union(v.string(), v.null())),
  processingTime: v.number(),
});

/** Apply one LangGraph batch lead result in its own mutation (stays under read limits). */
export const applyBatchLeadResult = internalMutation({
  args: {
    batchId: v.string(),
    searchId: v.id("searches"),
    userId: v.id("users"),
    isEnterpriseUser: v.boolean(),
    leadResult: BatchLeadResultArg,
  },
  handler: async (ctx, args) => {
    const { batchId, searchId, userId, isEnterpriseUser, leadResult } = args;

    if (!/^[a-zA-Z0-9]{16,32}$/.test(leadResult.leadId)) {
      throw new Error(`Invalid leadId format: ${leadResult.leadId}`);
    }

    const leadIdTyped = leadResult.leadId as Id<"leads">;
    const contactIdRaw = leadResult.contactId;
    const hasContactId =
      typeof contactIdRaw === "string" &&
      /^[a-zA-Z0-9]{16,32}$/.test(contactIdRaw);

    if (leadResult.status === "completed" && leadResult.result) {
      const lead = await ctx.db.get(leadIdTyped);
      if (!lead) {
        throw new Error(`Lead not found: ${leadResult.leadId}`);
      }

      const result = leadResult.result;
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
          typeof delayRawCandidate === "number" ? delayRawCandidate : undefined;

        return {
          subject:
            typeof subjectRaw === "string" ? subjectRaw : `Follow Up ${index + 1}`,
          body: typeof bodyRaw === "string" ? bodyRaw : "",
          delay_days: delayRaw ?? (index + 1) * 3,
        };
      });

      const aiAnalysisPayload = {
        relevanceScore: result.relevance_score || 0,
        painPoints: result.pain_points_identified || [],
        valueMatches: result.value_matches || [],
        recommendations: result.recommendations || [],
        leadAnalysis:
          slimLeadAnalysisForContactStorage(result.lead_analysis || {}) ?? {},
        processingTime: leadResult.processingTime,
        confidence: result.relevance_score || 0.5,
        researchTier: result.research_tier,
        leadTier:
          result.lead_tier === "A" || result.lead_tier === "B"
            ? result.lead_tier
            : "A",
        leadTierReason: result.lead_tier_reason,
      };
      const emailContentPayload =
        result.primary_email && result.primary_email !== null
          ? {
              subject: result.primary_email.subject,
              body: result.primary_email.body,
              personalizationNotes:
                result.primary_email.personalization_notes || [],
              estimatedEffectiveness:
                result.primary_email.estimated_effectiveness || 0.5,
            }
          : undefined;

      const contactIdRawSuccess = leadResult.contactId;
      const hasContactIdSuccess =
        typeof contactIdRawSuccess === "string" &&
        /^[a-zA-Z0-9]{16,32}$/.test(contactIdRawSuccess);

      if (hasContactIdSuccess) {
        const contactIdTyped = contactIdRawSuccess as Id<"leadContacts">;
        await ctx.runMutation(
          internal.leads.contactInternal.updateLeadContactAnalysis,
          {
            contactId: contactIdTyped,
            aiAnalysis: aiAnalysisPayload,
            emailContent: emailContentPayload,
            followUpEmails:
              formattedFollowUps.length > 0 ? formattedFollowUps : undefined,
          },
        );
        await ctx.runMutation(
          internal.leads.contactInternal.markContactAnalysisCompleted,
          { contactId: contactIdTyped },
        );
      } else {
        await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
          leadId: leadIdTyped as Id<"leads">,
          aiAnalysis: aiAnalysisPayload,
          emailContent: emailContentPayload,
          followUpEmails:
            formattedFollowUps.length > 0 ? formattedFollowUps : undefined,
        });

        await ctx.runMutation(internal.leads.internal.markLeadAnalysisCompleted, {
          leadId: leadIdTyped as Id<"leads">,
        });
      }

      const leadAnalysisPayload = (result.lead_analysis ?? {}) as Record<
        string,
        unknown
      >;
      const researchMetadata = (leadAnalysisPayload.research_metadata ??
        {}) as Record<string, unknown>;
      const companyDomain = extractDomainFromWebsite(lead.website);

      const deepResearchUsed = Boolean(result.deep_research_used);
      if (deepResearchUsed && !isEnterpriseUser && result.additional_credits_used > 0) {
        await ctx.runMutation(internal.credits.transactions.recordTransaction, {
          userId,
          amount: result.additional_credits_used,
          operation: "usage",
          description: `Deep Research - ${result.deep_research_reason || "Enhanced business intelligence"}`,
          relatedEntityType: "lead",
          relatedEntityId: leadIdTyped,
        });
      }

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
        leadTier: result.lead_tier ?? "A",
        leadTierReason: result.lead_tier_reason,
      });

      if (companyDomain && leadAnalysisHasSaveableResearch(leadAnalysisPayload)) {
        const researchConfidence =
          typeof researchMetadata.confidence_score === "number"
            ? researchMetadata.confidence_score
            : typeof (result as Record<string, unknown>).research_confidence ===
                "number"
              ? ((result as Record<string, unknown>).research_confidence as number)
              : typeof result.relevance_score === "number"
                ? result.relevance_score
                : 0.5;

        try {
          await ctx.runMutation(
            internal.leads.contactInternal.saveCompanyResearchFromWebhook,
            {
              searchId,
              userId,
              leadId: lead._id,
              domain: companyDomain,
              researchPayload: buildWebhookResearchPayload(leadAnalysisPayload, {
                confidence_score: researchConfidence,
                research_tier: result.deep_research_used ? "perplexity" : "tavily",
                deep_research_used: Boolean(result.deep_research_used),
                deep_research_reason: result.deep_research_reason,
              }),
            },
          );
        } catch (researchError) {
          const researchLogger = createOperationLogger.webhook(
            "system",
            "batch_lead_research_save",
          );
          researchLogger.error("Failed to save company research from batch lead result", {
            batchId,
            leadId: leadResult.leadId,
            domain: companyDomain,
            error:
              researchError instanceof Error
                ? researchError.message
                : "Unknown error",
          });
        }
      }

      if (result.primary_email && result.primary_email !== null) {
        const requestId = `${batchId}_${leadIdTyped}`;
        const existing = await ctx.db
          .query("emailSequences")
          .withIndex("by_request_id", (q) => q.eq("requestId", requestId))
          .first();

        if (!existing) {
          await ctx.runMutation(internal.leads.internal.createEmailSequence, {
            leadId: leadIdTyped as Id<"leads">,
            userId,
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

      return { applied: true, status: "completed" as const };
    }

    const errorMessage = leadResult.error || "Analysis failed";

    if (hasContactId) {
      await ctx.runMutation(internal.leads.contactInternal.markContactAnalysisFailed, {
        contactId: contactIdRaw as Id<"leadContacts">,
        error: errorMessage,
      });
      return { applied: true, status: "failed" as const };
    }

    const lead = await ctx.db.get(leadIdTyped);
    if (!lead) {
      throw new Error(`Lead not found: ${leadResult.leadId}`);
    }

    await ctx.runMutation(internal.leads.internal.updateLeadAnalysis, {
      leadId: leadIdTyped as Id<"leads">,
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
      leadId: leadIdTyped as Id<"leads">,
      error: errorMessage,
    });

    return { applied: true, status: "failed" as const };
  },
});

/** Finalize batch webhook without loading all completed contact payloads. */
export const finalizeBatchCompletion = internalMutation({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    batchId: v.string(),
    processedSuccessfully: v.number(),
    processingErrors: v.number(),
    batchStatus: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
  },
  handler: async (ctx, args) => {
    const logger = createOperationLogger.webhook(
      "system",
      "batch_completion_finalize",
    );

    const awaiting = await hasAcceptedContactsAwaitingAnalysis(ctx, args.searchId);
    const isComplete = !awaiting;

    const completionMessage =
      args.processingErrors === 0
        ? `Batch complete: processed ${args.processedSuccessfully} contact(s)`
        : `Batch complete: ${args.processedSuccessfully} processed, ${args.processingErrors} error(s) (${args.batchStatus})`;

    await insertPipelineBroadcast(ctx, {
      userId: args.userId,
      searchId: args.searchId,
      stage: "analysis",
      progress: isComplete ? 100 : 0,
      message: completionMessage,
      data: {
        batchId: args.batchId,
        processedSuccessfully: args.processedSuccessfully,
        processingErrors: args.processingErrors,
        batchStatus: args.batchStatus,
        analysisComplete: isComplete,
      },
    });

    const backfill = await ctx.runMutation(
      internal.leads.contactInternal.backfillContactCompanyResearchForSearch,
      { searchId: args.searchId },
    );
    if (backfill.linked > 0) {
      logger.info("Backfilled companyResearch links after batch completion", {
        searchId: args.searchId,
        batchId: args.batchId,
        linked: backfill.linked,
        total: backfill.total,
      });
    }

    if (isComplete) {
      const currentSearch = await ctx.db.get(args.searchId);

      if (
        currentSearch &&
        (currentSearch.status === "processing" ||
          currentSearch.status === "in_progress") &&
        !currentSearch.completionTriggered
      ) {
        logger.info("All contacts processed - triggering search completion", {
          searchId: args.searchId,
          batchId: args.batchId,
        });

        await ctx.db.patch(args.searchId, {
          completionTriggered: true,
          completionTriggeredAt: Date.now(),
        });

        try {
          await ctx.scheduler.runAfter(0, (api as any).search.actions.completeSearch, {
            searchId: args.searchId,
          });
        } catch (error) {
          await ctx.db.patch(args.searchId, {
            completionTriggered: false,
            completionTriggeredAt: undefined,
          });
          throw error;
        }
      }
    }

    return { isComplete, awaiting };
  },
});
