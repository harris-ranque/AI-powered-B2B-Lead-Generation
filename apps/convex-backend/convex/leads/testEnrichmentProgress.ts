/**
 * Test functions for workpool enrichment progress features
 *
 * Use these in Convex dashboard to test:
 * - getEnrichmentProgress query
 * - Admin pause/resume controls
 * - Progress broadcasting with workpool metrics
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Test the getEnrichmentProgress query
 * Usage: Call with a valid searchId to see enrichment breakdown
 */
export const testGetEnrichmentProgress = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    // Get the search and leads data
    const search = await ctx.db.get(args.searchId);
    if (!search) {
      return {
        success: false,
        error: "Search not found",
      };
    }

    const allLeads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const pending = allLeads.filter(l => l.enrichmentStatus === "pending").length;
    const inProgress = allLeads.filter(l => l.enrichmentStatus === "in_progress").length;
    const completed = allLeads.filter(l =>
      l.enrichmentStatus === "completed" ||
      l.enrichmentStatus === "completed_fallback"
    ).length;
    const failed = allLeads.filter(l => l.enrichmentStatus === "failed").length;

    const total = allLeads.length;
    const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

    const progress = {
      searchId: args.searchId,
      searchStatus: search.status,
      total,
      pending,
      inProgress,
      completed,
      failed,
      percentComplete,
      providers: {
        findymail: allLeads.filter(l => l.enrichmentProvider === "findymail").length,
      },
      isComplete: pending === 0 && inProgress === 0,
      isPaused: search.enrichmentPaused || false,
    };

    console.log("Enrichment Progress Test Results:", {
      searchId: args.searchId,
      progress,
      timestamp: Date.now(),
    });

    return {
      success: true,
      message: "Successfully retrieved enrichment progress",
      data: progress,
    };
  },
});

/**
 * Test the pause enrichment mutation (admin only)
 * Usage: Call with a searchId to pause its enrichment
 */
export const testPauseEnrichment = mutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    try {
      const search = await ctx.db.get(args.searchId);
      if (!search) {
        return {
          success: false,
          error: "Search not found",
        };
      }

      // Get current user (would be admin in real usage)
      const user = await ctx.auth.getUserIdentity();
      if (!user) {
        return {
          success: false,
          error: "Not authenticated",
        };
      }

      // Pause the search
      await ctx.db.patch(args.searchId, {
        enrichmentPaused: true,
        pausedAt: Date.now(),
      });

      console.log("Pause Enrichment Test:", {
        searchId: args.searchId,
        action: "paused",
        timestamp: Date.now(),
      });

      return {
        success: true,
        message: `Enrichment paused for search ${args.searchId}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("Pause test failed:", errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  },
});

/**
 * Test the resume enrichment mutation (admin only)
 * Usage: Call with a searchId to resume its enrichment
 */
export const testResumeEnrichment = mutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    try {
      const search = await ctx.db.get(args.searchId);
      if (!search) {
        return {
          success: false,
          error: "Search not found",
        };
      }

      // Get current user (would be admin in real usage)
      const user = await ctx.auth.getUserIdentity();
      if (!user) {
        return {
          success: false,
          error: "Not authenticated",
        };
      }

      // Resume the search
      await ctx.db.patch(args.searchId, {
        enrichmentPaused: false,
        pausedBy: undefined,
        pausedAt: undefined,
      });

      console.log("Resume Enrichment Test:", {
        searchId: args.searchId,
        action: "resumed",
        timestamp: Date.now(),
      });

      return {
        success: true,
        message: `Enrichment resumed for search ${args.searchId}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("Resume test failed:", errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  },
});

/**
 * Test progress broadcast with workpool metrics
 * Usage: Call with userId and searchId to send a test broadcast
 */
export const testProgressBroadcast = mutation({
  args: {
    userId: v.id("users"),
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    try {
      // Send test broadcast with workpool metrics
      await ctx.runMutation(
        internal.realtime.broadcaster.broadcastPipelineUpdate,
        {
          userId: args.userId,
          searchId: args.searchId,
          stage: "enrichment",
          progress: 45,
          message: "Test: Enriching 45 of 100 leads (45% complete)",
          data: {
            progress: {
              discovered: 100,
              enriched: 45,
              analyzed: 0,
              total: 100,
            },
            workpool: {
              totalLeads: 100,
              enqueuedJobs: 100,
              failedToEnqueue: 0,
              maxParallelism: 25,
              perApiKeyConcurrency: 5,
              estimatedMinutes: 8,
            },
            enrichmentBreakdown: {
              pending: 40,
              inProgress: 15,
              completed: 40,
              completedFallback: 5,
              failed: 0,
              percentComplete: 45,
            },
            lastEnrichedLead: {
              businessName: "Test Business Inc.",
              provider: "findymail",
              emailCount: 3,
              contactCount: 5,
            },
          },
        }
      );

      console.log("Broadcast Test Sent:", {
        userId: args.userId,
        searchId: args.searchId,
        timestamp: Date.now(),
      });

      return {
        success: true,
        message: "Test broadcast sent with workpool metrics",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("Broadcast test failed:", errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  },
});

/**
 * Get test data summary for a search
 * Useful for debugging and understanding current state
 */
export const getTestDataSummary = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);

    if (!search) {
      return {
        success: false,
        error: "Search not found",
      };
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_search", (q) => q.eq("searchId", args.searchId))
      .collect();

    const statusCounts = {
      pending: leads.filter(l => l.enrichmentStatus === "pending").length,
      inProgress: leads.filter(l => l.enrichmentStatus === "in_progress").length,
      completed: leads.filter(l => l.enrichmentStatus === "completed").length,
      completedFallback: leads.filter(l => l.enrichmentStatus === "completed_fallback").length,
      failed: leads.filter(l => l.enrichmentStatus === "failed").length,
    };

    return {
      success: true,
      search: {
        _id: search._id,
        name: search.name,
        status: search.status,
        enrichmentPaused: search.enrichmentPaused || false,
        pausedBy: search.pausedBy,
        pausedAt: search.pausedAt,
      },
      leads: {
        total: leads.length,
        statusBreakdown: statusCounts,
      },
    };
  },
});
