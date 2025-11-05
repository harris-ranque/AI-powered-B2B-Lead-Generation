/**
 * Comprehensive Audit Logging for BYOK System
 *
 * Tracks all credit bypass operations, API key usage, and enterprise operations
 * for compliance, debugging, and analytics purposes.
 */

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

/**
 * Audit Event Types
 */
export const AUDIT_EVENT_TYPES = {
  // Credit Operations
  CREDIT_BYPASS: "credit_bypass",
  CREDIT_CHARGE: "credit_charge",
  CREDIT_REFUND: "credit_refund",

  // API Key Operations
  API_KEY_USED: "api_key_used",
  API_KEY_VALIDATED: "api_key_validated",
  API_KEY_FAILED: "api_key_failed",

  // Search Operations
  SEARCH_STARTED: "search_started",
  SEARCH_COMPLETED: "search_completed",
  SEARCH_FAILED: "search_failed",

  // Enrichment Operations
  ENRICHMENT_STARTED: "enrichment_started",
  ENRICHMENT_COMPLETED: "enrichment_completed",
  ENRICHMENT_FAILED: "enrichment_failed",

  // Analysis Operations
  ANALYSIS_STARTED: "analysis_started",
  ANALYSIS_COMPLETED: "analysis_completed",
  ANALYSIS_FAILED: "analysis_failed",
} as const;

type AuditEventType = typeof AUDIT_EVENT_TYPES[keyof typeof AUDIT_EVENT_TYPES];

/**
 * Log a credit bypass event
 */
export const logCreditBypass = internalMutation({
  args: {
    userId: v.id("users"),
    operation: v.string(),
    creditsSkipped: v.number(),
    providers: v.array(v.string()),
    relatedEntityType: v.optional(v.string()),
    relatedEntityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create audit log entry
    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      eventType: AUDIT_EVENT_TYPES.CREDIT_BYPASS,
      operation: args.operation,
      creditsSkipped: args.creditsSkipped,
      providers: args.providers,
      relatedEntityType: args.relatedEntityType,
      relatedEntityId: args.relatedEntityId,
      metadata: args.metadata,
      timestamp: now,
    });

    // Log to console for immediate visibility
    console.log(
      `[AUDIT] Credit Bypass: User ${args.userId} | Operation: ${args.operation} | ` +
      `Credits Skipped: ${args.creditsSkipped} | Providers: ${args.providers.join(", ")}`
    );

    return { success: true };
  },
});

/**
 * Log an API key usage event
 */
export const logApiKeyUsage = internalMutation({
  args: {
    userId: v.id("users"),
    provider: v.string(),
    operation: v.string(),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      eventType: args.success ? AUDIT_EVENT_TYPES.API_KEY_USED : AUDIT_EVENT_TYPES.API_KEY_FAILED,
      operation: args.operation,
      providers: [args.provider],
      success: args.success,
      errorMessage: args.errorMessage,
      metadata: args.metadata,
      timestamp: now,
    });

    if (!args.success) {
      console.warn(
        `[AUDIT] API Key Failed: User ${args.userId} | Provider: ${args.provider} | ` +
        `Operation: ${args.operation} | Error: ${args.errorMessage || "Unknown"}`
      );
    }

    return { success: true };
  },
});

/**
 * Log an operation event (search, enrichment, analysis)
 */
export const logOperationEvent = internalMutation({
  args: {
    userId: v.id("users"),
    eventType: v.string(),
    operation: v.string(),
    bypassedCredits: v.boolean(),
    creditsSkipped: v.optional(v.number()),
    providers: v.optional(v.array(v.string())),
    relatedEntityType: v.optional(v.string()),
    relatedEntityId: v.optional(v.string()),
    success: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    await ctx.db.insert("auditLogs", {
      userId: args.userId,
      eventType: args.eventType as AuditEventType,
      operation: args.operation,
      bypassedCredits: args.bypassedCredits,
      creditsSkipped: args.creditsSkipped,
      providers: args.providers,
      relatedEntityType: args.relatedEntityType,
      relatedEntityId: args.relatedEntityId,
      success: args.success,
      errorMessage: args.errorMessage,
      metadata: args.metadata,
      timestamp: now,
    });

    // Log significant events
    if (args.bypassedCredits && args.creditsSkipped && args.creditsSkipped > 0) {
      console.log(
        `[AUDIT] Operation Bypass: User ${args.userId} | Event: ${args.eventType} | ` +
        `Operation: ${args.operation} | Credits Skipped: ${args.creditsSkipped}`
      );
    }

    return { success: true };
  },
});

/**
 * Query audit logs for a user
 */
export const getUserAuditLogs = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
    eventType: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;

    let query = ctx.db
      .query("auditLogs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc");

    const logs = await query.take(limit);

    // Apply filters
    let filteredLogs = logs;

    if (args.eventType) {
      filteredLogs = filteredLogs.filter((log) => log.eventType === args.eventType);
    }

    if (args.startDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp >= args.startDate!);
    }

    if (args.endDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp <= args.endDate!);
    }

    return filteredLogs;
  },
});

/**
 * Query credit bypass summary for a user
 */
export const getCreditBypassSummary = internalQuery({
  args: {
    userId: v.id("users"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("eventType"), AUDIT_EVENT_TYPES.CREDIT_BYPASS))
      .collect();

    let filteredLogs = logs;

    if (args.startDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp >= args.startDate!);
    }

    if (args.endDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp <= args.endDate!);
    }

    const totalCreditsSkipped = filteredLogs.reduce(
      (sum, log) => sum + (log.creditsSkipped || 0),
      0
    );

    const operationCounts: Record<string, number> = {};
    const providerUsage: Record<string, number> = {};

    filteredLogs.forEach((log) => {
      operationCounts[log.operation] = (operationCounts[log.operation] || 0) + 1;

      if (log.providers) {
        log.providers.forEach((provider) => {
          providerUsage[provider] = (providerUsage[provider] || 0) + 1;
        });
      }
    });

    return {
      totalBypassEvents: filteredLogs.length,
      totalCreditsSkipped,
      operationCounts,
      providerUsage,
      period: {
        start: args.startDate || Math.min(...filteredLogs.map((l) => l.timestamp)),
        end: args.endDate || Math.max(...filteredLogs.map((l) => l.timestamp)),
      },
    };
  },
});

/**
 * Query all audit logs (admin only)
 */
export const getAllAuditLogs = internalQuery({
  args: {
    limit: v.optional(v.number()),
    eventType: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 1000;

    let query = ctx.db.query("auditLogs").order("desc");

    const logs = await query.take(limit);

    // Apply filters
    let filteredLogs = logs;

    if (args.eventType) {
      filteredLogs = filteredLogs.filter((log) => log.eventType === args.eventType);
    }

    if (args.startDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp >= args.startDate!);
    }

    if (args.endDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp <= args.endDate!);
    }

    return filteredLogs;
  },
});

/**
 * Get platform-wide credit bypass statistics
 */
export const getPlatformBypassStats = internalQuery({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("auditLogs")
      .filter((q) => q.eq(q.field("eventType"), AUDIT_EVENT_TYPES.CREDIT_BYPASS))
      .collect();

    let filteredLogs = logs;

    if (args.startDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp >= args.startDate!);
    }

    if (args.endDate) {
      filteredLogs = filteredLogs.filter((log) => log.timestamp <= args.endDate!);
    }

    const totalCreditsSkipped = filteredLogs.reduce(
      (sum, log) => sum + (log.creditsSkipped || 0),
      0
    );

    const uniqueUsers = new Set(filteredLogs.map((log) => log.userId)).size;

    const operationBreakdown: Record<string, { count: number; credits: number }> = {};

    filteredLogs.forEach((log) => {
      if (!operationBreakdown[log.operation]) {
        operationBreakdown[log.operation] = { count: 0, credits: 0 };
      }
      // Safe to assert non-null as we just initialized it above
      const breakdown = operationBreakdown[log.operation]!;
      breakdown.count++;
      breakdown.credits += log.creditsSkipped || 0;
    });

    return {
      totalBypassEvents: filteredLogs.length,
      totalCreditsSkipped,
      uniqueEnterpriseUsers: uniqueUsers,
      operationBreakdown,
      period: {
        start: args.startDate || Math.min(...filteredLogs.map((l) => l.timestamp)),
        end: args.endDate || Math.max(...filteredLogs.map((l) => l.timestamp)),
      },
    };
  },
});
