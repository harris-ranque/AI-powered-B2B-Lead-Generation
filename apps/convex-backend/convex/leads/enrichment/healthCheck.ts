/**
 * FindyMail Health Check Action
 *
 * Provides health check functionality for monitoring FindyMail API status.
 * Used by cron jobs for proactive alerting and by admin dashboard for status display.
 */

import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { FindyMailProvider, type FindyMailHealthCheckResult } from "./findymail";
import { internal } from "../../_generated/api";

/**
 * Internal action to check FindyMail API health
 * Called by cron job for periodic monitoring
 */
export const checkFindyMailHealth = internalAction({
  args: {},
  handler: async (ctx): Promise<FindyMailHealthCheckResult> => {
    const apiKey = process.env.FINDYMAIL_API_KEY;

    if (!apiKey) {
      return {
        healthy: false,
        status: "auth_failed",
        message: "FINDYMAIL_API_KEY environment variable is not configured",
        responseTimeMs: 0,
        timestamp: Date.now(),
      };
    }

    const provider = new FindyMailProvider(apiKey);
    const result = await provider.healthCheck(apiKey);

    // Log health check result
    console.log(`[FindyMail Health] Status: ${result.status}`, {
      healthy: result.healthy,
      credits: result.credits,
      responseTimeMs: result.responseTimeMs,
      message: result.message,
    });

    // Store the health check result in database for historical tracking
    await ctx.runMutation(internal.leads.enrichment.healthCheck.recordHealthCheck, {
      provider: "findymail",
      ...result,
    });

    // Alert if unhealthy (except rate_limited which is temporary)
    if (!result.healthy && result.status !== "rate_limited") {
      console.error(`[FindyMail Health] ⚠️ UNHEALTHY: ${result.message}`);

      // Could trigger notification here
      // await ctx.runAction(internal.notifications.actions.sendAlert, { ... });
    }

    return result;
  },
});

/**
 * Record health check result in database
 */
export const recordHealthCheck = internalMutation({
  args: {
    provider: v.string(),
    healthy: v.boolean(),
    status: v.string(),
    message: v.string(),
    credits: v.optional(v.number()),
    responseTimeMs: v.number(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Store in a health check log table
    // For now, we'll just track the latest status in memory/logs
    // Future: Create a healthCheckLogs table for historical data

    const logEntry = {
      provider: args.provider,
      healthy: args.healthy,
      status: args.status,
      message: args.message,
      credits: args.credits,
      responseTimeMs: args.responseTimeMs,
      timestamp: args.timestamp,
      checkedAt: Date.now(),
    };

    console.log(`[Health Check Recorded] ${args.provider}:`, logEntry);

    return logEntry;
  },
});

/**
 * Get the latest health check status
 * Can be exposed as a query for admin dashboard
 */
export const getHealthStatus = internalQuery({
  args: {
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Future: Query from healthCheckLogs table
    // For now, return a placeholder indicating the check should be run

    return {
      message: "Run health check action to get current status",
      lastChecked: null,
      providers: {
        findymail: {
          status: "unknown",
          healthy: null,
          message: "Health check not yet run",
        },
      },
    };
  },
});

/**
 * Check all external API health
 * Useful for a comprehensive system health check
 */
export const checkAllApisHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    const results: Record<string, FindyMailHealthCheckResult> = {};

    // Check FindyMail
    try {
      const findyMailResult = await ctx.runAction(
        internal.leads.enrichment.healthCheck.checkFindyMailHealth,
        {}
      );
      results.findymail = findyMailResult;
    } catch (error) {
      results.findymail = {
        healthy: false,
        status: "unknown_error",
        message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTimeMs: 0,
        timestamp: Date.now(),
      };
    }

    // Future: Add other API health checks (Google Maps, Tavily, Perplexity, etc.)

    // Determine overall health
    const allHealthy = Object.values(results).every((r) => "healthy" in r && r.healthy);
    const anyUnhealthy = Object.values(results).some((r) => "healthy" in r && !r.healthy);

    const overallStatus = allHealthy
      ? "all_healthy"
      : anyUnhealthy
        ? "degraded"
        : "unknown";

    console.log(`[System Health] Overall status: ${overallStatus}`, results);

    return {
      overallStatus,
      allHealthy,
      timestamp: Date.now(),
      providers: results,
    };
  },
});
