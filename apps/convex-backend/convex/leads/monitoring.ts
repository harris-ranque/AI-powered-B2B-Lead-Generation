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

      // Group stuck leads by search for batch retry
      const leadsGroupedBySearch = new Map<string, Doc<"leads">[]>();

      for (const lead of stuckLeads) {
        const searchId = lead.searchId;
        if (!leadsGroupedBySearch.has(searchId)) {
          leadsGroupedBySearch.set(searchId, []);
        }
        leadsGroupedBySearch.get(searchId)!.push(lead);
      }

      logWithCorrelation(
        "info",
        correlation,
        "📦 Grouped Stuck Leads by Search",
        {
          totalLeads: stuckLeads.length,
          uniqueSearches: leadsGroupedBySearch.size,
        },
      );

      // Process each search's stuck leads
      for (const [searchId, leads] of leadsGroupedBySearch) {
        if (leads.length === 0) continue; // Skip empty lead arrays
        const attempts = leads[0]?.analysisAttempts || 0;
        const maxRetries = 3;

        // Filter leads by retry count
        const leadsToTimeout = leads.filter((l) => (l.analysisAttempts || 0) >= maxRetries);
        const leadsToRetry = leads.filter((l) => (l.analysisAttempts || 0) < maxRetries);

        // Mark exceeded leads as timeout
        for (const lead of leadsToTimeout) {
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
              attempts: lead.analysisAttempts || 0,
              status: "timeout",
            },
          );
        }

        // Retry eligible leads using batch system
        if (leadsToRetry.length > 0) {
          // Get search and profile
          const search = await ctx.runQuery(
            internal.search.internal.getSearchInternal,
            {
              searchId: searchId as any,
            },
          );

          if (!search) {
            logWithCorrelation(
              "error",
              correlation,
              "❌ Search Not Found for Stuck Leads",
              {
                searchId,
                leadCount: leadsToRetry.length,
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
              "❌ Profile Not Found for Stuck Leads",
              {
                searchId,
                userId: search.userId,
              },
            );
            continue;
          }

          // Mark all leads as failed so retry system can pick them up
          for (const lead of leadsToRetry) {
            await ctx.runMutation(internal.leads.internal.markLeadAnalysisFailed, {
              leadId: lead._id,
              error: "Stuck in processing - marked for batch retry",
            });
          }

          // Use batch retry system (handles batching, scheduling, and retry tracking)
          const retryResult = await ctx.runAction(
            (internal as any)["leads/asyncAnalysis"].retryFailedLeads,
            {
              searchId: search._id,
              userId: search.userId,
              profileId: profile._id,
              maxRetries: 2, // Allow 2 more retries
            },
          );

          retriedLeads += leadsToRetry.length;

          logWithCorrelation(
            "info",
            correlation,
            "🔄 Batch Retry Scheduled for Stuck Leads",
            {
              searchId,
              leadsRetried: leadsToRetry.length,
              batchesScheduled: retryResult?.batchCount || 0,
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
