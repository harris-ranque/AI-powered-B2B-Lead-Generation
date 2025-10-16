/**
 * Lead Analysis Monitoring System
 *
 * Monitors stuck/timeout leads and triggers retries or marks as failed
 * Health checks for scheduled actions to detect execution issues
 * Runs as a cron job every 5 minutes
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  createCorrelationContext,
  logWithCorrelation,
  OPERATION_TYPES,
} from "../lib/correlation";
import { Doc } from "../_generated/dataModel";

/**
 * Monitor stuck leads and handle timeouts
 *
 * Checks for leads in "scheduled" or "processing" status for > 15 minutes
 * Retries if attempts < 3, marks as timeout otherwise
 */
export const monitorStuckLeads: any = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.MONITORING,
      "system",
      {
        metadata: {
          monitorType: "stuck_lead_analysis",
        },
      },
    );

    logWithCorrelation(
      "info",
      correlation,
      "🔍 Starting Stuck Lead Analysis Monitoring",
      {
        timeoutMinutes: 15,
        maxRetries: 3,
      },
    );

    try {
      // Get all stuck leads (scheduled or processing for > 15 minutes)
      const stuckLeads = (await ctx.runQuery(
        internal.leads.internal.getStuckLeads,
        {
          timeoutMinutes: 15,
        },
      )) as Doc<"leads">[];

      if (stuckLeads.length === 0) {
        logWithCorrelation(
          "info",
          correlation,
          "✅ No Stuck Leads Found",
          {},
        );
        return { success: true, stuckLeadsFound: 0, retriedLeads: 0, timeoutLeads: 0 };
      }

      logWithCorrelation(
        "warn",
        correlation,
        "⚠️ Found Stuck Leads - Processing",
        {
          stuckLeadsCount: stuckLeads.length,
          leads: stuckLeads.map((l: Doc<"leads">) => ({
            leadId: l._id,
            businessName: l.businessName,
            status: l.analysisStatus,
            attempts: l.analysisAttempts || 0,
            scheduledAt: l.analysisScheduledAt,
          })),
        },
      );

      let retriedLeads = 0;
      let timeoutLeads = 0;

      // Process each stuck lead
      for (const lead of stuckLeads) {
        const attempts = lead.analysisAttempts || 0;
        const maxRetries = 3;

        if (attempts >= maxRetries) {
          // Mark as timeout
          await ctx.runMutation(internal.leads.internal.markLeadAnalysisTimeout, {
            leadId: lead._id,
          });
          timeoutLeads++;

          logWithCorrelation(
            "error",
            correlation,
            "⏱️ Lead Marked as Timeout",
            {
              leadId: lead._id,
              businessName: lead.businessName,
              attempts,
              status: "timeout",
            },
          );
        } else {
          // Get search and profile for retry
          const search = await ctx.runQuery(
            internal.search.internal.getSearchInternal,
            {
              searchId: lead.searchId,
            },
          );

          if (!search) {
            logWithCorrelation(
              "error",
              correlation,
              "❌ Search Not Found for Stuck Lead",
              {
                leadId: lead._id,
                searchId: lead.searchId,
              },
            );
            continue;
          }

          const profile = await ctx.runQuery(
            internal.profile.internal.getProfileByUserIdInternal,
            {
              userId: search.userId,
            },
          );

          if (!profile) {
            logWithCorrelation(
              "error",
              correlation,
              "❌ Profile Not Found for Stuck Lead",
              {
                leadId: lead._id,
                userId: search.userId,
              },
            );
            continue;
          }

          // Create new request ID for retry
          const requestId = `${lead.searchId}_${lead._id}_retry${attempts + 1}`;

          // Mark as scheduled again
          await ctx.runMutation(internal.leads.internal.markLeadAnalysisScheduled, {
            leadId: lead._id,
            requestId,
          });

          // Schedule retry
          await ctx.scheduler.runAfter(
            0,
            (internal as any)["leads/asyncAnalysis"].analyzeSingleLead,
            {
              leadId: lead._id,
              searchId: lead.searchId,
              userId: search.userId,
              profileId: profile._id,
              maxRetries: maxRetries - attempts, // Remaining retries
            },
          );

          retriedLeads++;

          logWithCorrelation(
            "info",
            correlation,
            "🔄 Lead Retry Scheduled",
            {
              leadId: lead._id,
              businessName: lead.businessName,
              attempt: attempts + 1,
              maxRetries,
              requestId,
            },
          );
        }
      }

      logWithCorrelation(
        "info",
        correlation,
        "✅ Stuck Lead Monitoring Complete",
        {
          totalStuck: stuckLeads.length,
          retriedLeads,
          timeoutLeads,
        },
      );

      return {
        success: true,
        stuckLeadsFound: stuckLeads.length,
        retriedLeads,
        timeoutLeads,
      };
    } catch (error) {
      logWithCorrelation(
        "error",
        correlation,
        "💥 Stuck Lead Monitoring Failed",
        {},
        error as Error,
      );

      throw error;
    }
  },
});

/**
 * Health check for scheduled actions
 *
 * Detects if scheduled actions are not executing by checking for leads
 * that have been "scheduled" for an extended period (30+ minutes) without
 * transitioning to "processing" status.
 *
 * This helps identify issues with Convex scheduler or system overload.
 */
export const checkScheduledActionsHealth: any = internalAction({
  args: {},
  handler: async (ctx) => {
    const correlation = createCorrelationContext(
      OPERATION_TYPES.MONITORING,
      "system",
      {
        metadata: {
          monitorType: "scheduled_actions_health",
        },
      },
    );

    logWithCorrelation(
      "info",
      correlation,
      "🏥 Starting Scheduled Actions Health Check",
      {
        overdueThresholdMinutes: 30,
      },
    );

    try {
      // Get leads scheduled more than 30 minutes ago but still in "scheduled" status
      const overdueLeads = (await ctx.runQuery(
        internal.leads.internal.getStuckLeads,
        {
          timeoutMinutes: 30,
        },
      )) as Doc<"leads">[];

      // Filter to only leads in "scheduled" status (not "processing")
      const scheduledOverdue = overdueLeads.filter(
        (lead: Doc<"leads">) => lead.analysisStatus === "scheduled",
      );

      if (scheduledOverdue.length === 0) {
        logWithCorrelation(
          "info",
          correlation,
          "✅ Scheduled Actions Health: OK",
          {
            overdueCount: 0,
            status: "healthy",
          },
        );

        return {
          success: true,
          status: "healthy",
          overdueLeads: 0,
          message: "All scheduled actions are executing normally",
        };
      }

      // Alert: Scheduled actions may not be executing
      logWithCorrelation(
        "error",
        correlation,
        "🚨 ALERT: Scheduled Actions May Be Stuck",
        {
          overdueCount: scheduledOverdue.length,
          status: "degraded",
          oldestLeads: scheduledOverdue.slice(0, 5).map((l: Doc<"leads">) => ({
            leadId: l._id,
            businessName: l.businessName,
            status: l.analysisStatus,
            scheduledAt: l.analysisScheduledAt,
            minutesOverdue: l.analysisScheduledAt
              ? Math.floor((Date.now() - l.analysisScheduledAt) / 1000 / 60)
              : 0,
          })),
          recommendation:
            "Check Convex scheduler health, system load, and worker capacity",
        },
      );

      // Return degraded status with details
      return {
        success: true,
        status: "degraded",
        overdueLeads: scheduledOverdue.length,
        message: `${scheduledOverdue.length} scheduled actions appear stuck (not executing after 30+ minutes)`,
        oldestLeads: scheduledOverdue.slice(0, 5).map((l: Doc<"leads">) => ({
          leadId: l._id,
          businessName: l.businessName,
          scheduledAt: l.analysisScheduledAt,
          minutesOverdue: l.analysisScheduledAt
            ? Math.floor((Date.now() - l.analysisScheduledAt) / 1000 / 60)
            : 0,
        })),
        recommendation:
          "Check Convex scheduler health, system load, and worker capacity. Consider manual retry.",
      };
    } catch (error) {
      logWithCorrelation(
        "error",
        correlation,
        "💥 Scheduled Actions Health Check Failed",
        {},
        error as Error,
      );

      return {
        success: false,
        status: "error",
        message: "Health check failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
