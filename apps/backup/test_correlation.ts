import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  createCorrelationContext,
  createChildContext,
  OPERATION_TYPES,
  startPerformanceTracking,
  endPerformanceTracking,
  withTimeout,
} from "./correlation";
import { logWithCorrelationPersistent } from "./logging";

/**
 * Correlation Logging System Test Suite
 *
 * Demonstrates the complete correlation logging system with:
 * - Parent/child operation tracking
 * - Performance measurement
 * - Error handling with context
 * - Cross-operation tracing
 */

// Test comprehensive correlation logging workflow
export const testCorrelationLogging = internalAction({
  args: {
    userId: v.id("users"),
    searchId: v.optional(v.id("searches")),
  },
  handler: async (ctx, args) => {
    // Create root correlation context
    const rootCorrelation = createCorrelationContext(
      OPERATION_TYPES.SEARCH_CREATE,
      args.userId,
      args.searchId
        ? {
            searchId: args.searchId,
            metadata: {
              testRun: true,
              timestamp: Date.now(),
              testType: "comprehensive_workflow",
            },
          }
        : {
            metadata: {
              testRun: true,
              timestamp: Date.now(),
              testType: "comprehensive_workflow",
            },
          },
    );

    const rootPerf = startPerformanceTracking();

    await logWithCorrelationPersistent(
      ctx,
      "info",
      rootCorrelation,
      "Starting comprehensive correlation logging test",
    );

    try {
      // Simulate step 1: Search creation
      const step1Correlation = createChildContext(
        rootCorrelation,
        OPERATION_TYPES.SEARCH_ORCHESTRATE,
      );
      const step1Perf = startPerformanceTracking();

      await logWithCorrelationPersistent(
        ctx,
        "info",
        step1Correlation,
        "Step 1: Search orchestration started",
      );

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 100));

      const step1PerfData = endPerformanceTracking(step1Perf);
      await logWithCorrelationPersistent(
        ctx,
        "info",
        step1Correlation,
        "Step 1: Search orchestration completed",
        { stepDuration: step1PerfData?.duration },
        undefined,
        step1PerfData,
      );

      // Simulate step 2: Google Maps discovery (parallel operations)
      const step2Correlation = createChildContext(
        rootCorrelation,
        OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY,
      );
      const step2Perf = startPerformanceTracking();

      await logWithCorrelationPersistent(
        ctx,
        "info",
        step2Correlation,
        "Step 2: Google Maps discovery started",
        { location: "San Francisco", radius: 5000 },
      );

      // Simulate API call with timeout
      try {
        await withTimeout(
          new Promise((resolve) => setTimeout(resolve, 200)),
          1000,
          step2Correlation,
          "Google Maps API call",
        );

        const step2PerfData = endPerformanceTracking(step2Perf);
        await logWithCorrelationPersistent(
          ctx,
          "info",
          step2Correlation,
          "Step 2: Google Maps discovery completed",
          { leadsFound: 15 },
          undefined,
          step2PerfData,
        );
      } catch (error) {
        const step2PerfData = endPerformanceTracking(step2Perf);
        await logWithCorrelationPersistent(
          ctx,
          "error",
          step2Correlation,
          "Step 2: Google Maps discovery failed",
          undefined,
          error as Error,
          step2PerfData,
        );
        throw error;
      }

      // Simulate step 3: Lead enrichment (batch processing)
      const step3Correlation = createChildContext(
        rootCorrelation,
        OPERATION_TYPES.LEAD_ENRICHMENT,
        { batchId: "batch_001" },
      );
      const step3Perf = startPerformanceTracking();

      await logWithCorrelationPersistent(
        ctx,
        "info",
        step3Correlation,
        "Step 3: Lead enrichment started",
        { batchSize: 15, batchId: "batch_001" },
      );

      // Simulate individual lead processing
      for (let i = 0; i < 3; i++) {
        const leadCorrelation = createChildContext(
          step3Correlation,
          OPERATION_TYPES.FINDYMAIL_API,
          { leadId: `lead_${i}` },
        );
        const leadPerf = startPerformanceTracking();

        await logWithCorrelationPersistent(
          ctx,
          "debug",
          leadCorrelation,
          `Processing lead ${i + 1}/3`,
          { leadIndex: i },
        );

        // Simulate lead processing time
        await new Promise((resolve) => setTimeout(resolve, 50));

        const leadPerfData = endPerformanceTracking(leadPerf);
        await logWithCorrelationPersistent(
          ctx,
          "debug",
          leadCorrelation,
          `Lead ${i + 1} enrichment completed`,
          { emailFound: true },
          undefined,
          leadPerfData,
        );
      }

      const step3PerfData = endPerformanceTracking(step3Perf);
      await logWithCorrelationPersistent(
        ctx,
        "info",
        step3Correlation,
        "Step 3: Lead enrichment completed",
        { enrichedCount: 3 },
        undefined,
        step3PerfData,
      );

      // Simulate step 4: AI Analysis
      const step4Correlation = createChildContext(
        rootCorrelation,
        OPERATION_TYPES.AI_ANALYSIS,
      );
      const step4Perf = startPerformanceTracking();

      await logWithCorrelationPersistent(
        ctx,
        "info",
        step4Correlation,
        "Step 4: AI analysis started",
      );

      // Simulate potential error scenario (20% chance)
      if (Math.random() < 0.2) {
        const analysisError = new Error("LangGraph API rate limit exceeded");
        const step4PerfData = endPerformanceTracking(step4Perf);
        await logWithCorrelationPersistent(
          ctx,
          "error",
          step4Correlation,
          "Step 4: AI analysis failed",
          { retryable: true },
          analysisError,
          step4PerfData,
        );

        // Log retry attempt
        const retryCorrelation = createChildContext(
          step4Correlation,
          OPERATION_TYPES.RETRY_OPERATION,
        );
        await logWithCorrelationPersistent(
          ctx,
          "warn",
          retryCorrelation,
          "Retrying AI analysis after rate limit error",
        );

        // Simulate retry success
        await new Promise((resolve) => setTimeout(resolve, 300));
        const retryPerfData = endPerformanceTracking(step4Perf);
        await logWithCorrelationPersistent(
          ctx,
          "info",
          retryCorrelation,
          "AI analysis retry successful",
          { attempt: 2 },
          undefined,
          retryPerfData,
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const step4PerfData = endPerformanceTracking(step4Perf);
        await logWithCorrelationPersistent(
          ctx,
          "info",
          step4Correlation,
          "Step 4: AI analysis completed",
          { relevanceScore: 0.85 },
          undefined,
          step4PerfData,
        );
      }

      // Complete the root operation
      const rootPerfData = endPerformanceTracking(rootPerf);
      await logWithCorrelationPersistent(
        ctx,
        "info",
        rootCorrelation,
        "Comprehensive correlation test completed successfully",
        {
          totalSteps: 4,
          totalDuration: rootPerfData?.duration,
        },
        undefined,
        rootPerfData,
      );

      return {
        success: true,
        correlationId: rootCorrelation.correlationId,
        message: "Comprehensive correlation logging test completed",
        summary: {
          rootCorrelationId: rootCorrelation.correlationId,
          totalDuration: rootPerfData?.duration,
          stepsCompleted: 4,
        },
      };
    } catch (error) {
      const rootPerfData = endPerformanceTracking(rootPerf);
      await logWithCorrelationPersistent(
        ctx,
        "error",
        rootCorrelation,
        "Comprehensive correlation test failed",
        undefined,
        error as Error,
        rootPerfData,
      );

      return {
        success: false,
        correlationId: rootCorrelation.correlationId,
        error: error instanceof Error ? error.message : "Unknown error",
        duration: rootPerfData?.duration,
      };
    }
  },
});

// Test correlation trace retrieval
export const testCorrelationTrace = internalMutation({
  args: {
    correlationId: v.string(),
  },
  handler: async (ctx, args): Promise<any> => {
    try {
      // Get the full correlation trace
      const trace: any = await ctx.runQuery(
        internal["lib/logging"].getCorrelationTrace,
        {
          correlationId: args.correlationId,
        },
      );

      // Get operation metrics
      const metrics: any = await ctx.runQuery(
        internal["lib/logging"].getOperationMetrics,
        {
          operationType: OPERATION_TYPES.SEARCH_CREATE,
          timeRange: {
            start: Date.now() - 60 * 60 * 1000, // Last hour
            end: Date.now(),
          },
        },
      );

      return {
        success: true,
        trace,
        metrics,
        analysis: {
          totalOperations: trace.summary?.totalOperations || 0,
          totalLogs: trace.summary?.totalLogs || 0,
          duration: trace.summary?.timeSpan?.duration || 0,
          operationTypes: trace.summary?.operationTypes || [],
          errorCount: trace.summary?.errorCount || 0,
          hasErrors: (trace.summary?.errorCount || 0) > 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Test performance monitoring
export const testPerformanceMonitoring = internalMutation({
  args: {
    timeRangeHours: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const timeRangeHours = args.timeRangeHours || 1;
    const now = Date.now();
    const timeRange = {
      start: now - timeRangeHours * 60 * 60 * 1000,
      end: now,
    };

    try {
      // Get metrics for different operation types
      const operationTypes = [
        OPERATION_TYPES.SEARCH_CREATE,
        OPERATION_TYPES.SEARCH_ORCHESTRATE,
        OPERATION_TYPES.GOOGLE_MAPS_DISCOVERY,
        OPERATION_TYPES.LEAD_ENRICHMENT,
        OPERATION_TYPES.AI_ANALYSIS,
      ];

      const metricsResults = [];

      for (const operationType of operationTypes) {
        const metrics: any = await ctx.runQuery(
          internal["lib/logging"].getOperationMetrics,
          {
            operationType,
            timeRange,
          },
        );
        metricsResults.push(metrics);
      }

      // Calculate aggregate statistics
      const aggregateStats = {
        totalOperations: metricsResults.reduce(
          (sum, m) => sum + m.totalOperations,
          0,
        ),
        totalSuccessful: metricsResults.reduce(
          (sum, m) => sum + m.successfulOperations,
          0,
        ),
        totalErrors: metricsResults.reduce(
          (sum, m) => sum + m.errorOperations,
          0,
        ),
        overallSuccessRate: 0,
        overallErrorRate: 0,
        avgDurationAcrossOperations: 0,
        slowestOperation: { type: "", duration: 0 },
        fastestOperation: { type: "", duration: Infinity },
      };

      if (aggregateStats.totalOperations > 0) {
        aggregateStats.overallSuccessRate =
          aggregateStats.totalSuccessful / aggregateStats.totalOperations;
        aggregateStats.overallErrorRate =
          aggregateStats.totalErrors / aggregateStats.totalOperations;
      }

      // Find performance extremes
      for (const metrics of metricsResults) {
        if (
          metrics.performance.avgDuration >
          aggregateStats.slowestOperation.duration
        ) {
          aggregateStats.slowestOperation = {
            type: metrics.operationType,
            duration: metrics.performance.avgDuration,
          };
        }
        if (
          metrics.performance.avgDuration <
            aggregateStats.fastestOperation.duration &&
          metrics.performance.avgDuration > 0
        ) {
          aggregateStats.fastestOperation = {
            type: metrics.operationType,
            duration: metrics.performance.avgDuration,
          };
        }
      }

      const validDurations = metricsResults
        .map((m) => m.performance.avgDuration)
        .filter((d) => d > 0);

      if (validDurations.length > 0) {
        aggregateStats.avgDurationAcrossOperations =
          validDurations.reduce((sum, d) => sum + d, 0) / validDurations.length;
      }

      return {
        success: true,
        timeRange,
        timeRangeHours,
        operationMetrics: metricsResults,
        aggregateStats,
        recommendations: generatePerformanceRecommendations(
          metricsResults,
          aggregateStats,
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Helper function to generate performance recommendations
function generatePerformanceRecommendations(
  metricsResults: any[],
  aggregateStats: any,
): string[] {
  const recommendations = [];

  // Error rate recommendations
  if (aggregateStats.overallErrorRate > 0.1) {
    recommendations.push(
      `High error rate detected (${(aggregateStats.overallErrorRate * 100).toFixed(1)}%). Consider investigating recent failures.`,
    );
  }

  // Performance recommendations
  if (aggregateStats.slowestOperation.duration > 5000) {
    recommendations.push(
      `${aggregateStats.slowestOperation.type} is taking ${aggregateStats.slowestOperation.duration}ms on average. Consider optimization.`,
    );
  }

  // Volume recommendations
  const highVolumeOps = metricsResults.filter((m) => m.totalOperations > 100);
  if (highVolumeOps.length > 0) {
    recommendations.push(
      `High volume operations detected: ${highVolumeOps.map((m) => m.operationType).join(", ")}. Monitor for capacity constraints.`,
    );
  }

  // Success rate recommendations
  const lowSuccessOps = metricsResults.filter(
    (m) => m.successRate < 0.9 && m.totalOperations > 10,
  );
  if (lowSuccessOps.length > 0) {
    recommendations.push(
      `Operations with low success rates: ${lowSuccessOps.map((m) => `${m.operationType} (${(m.successRate * 100).toFixed(1)}%)`).join(", ")}`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "System performance appears healthy. No immediate actions required.",
    );
  }

  return recommendations;
}
