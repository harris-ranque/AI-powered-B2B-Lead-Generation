import { action, internalAction, internalMutation } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";

/**
 * LangGraph Worker Health Check System
 *
 * Periodically checks the health of the LangGraph worker service
 * and updates system configuration to enable/disable AI analysis pipeline.
 */

// Health check action that calls the LangGraph worker
export const checkLangGraphHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    const langgraphUrl = process.env.LANGGRAPH_URL;
    const apiKey = process.env.LANGGRAPH_API_KEY;

    console.log("[HealthCheck] Starting LangGraph health check...");

    // If configuration is missing, mark as unavailable
    if (!langgraphUrl || !apiKey) {
      console.error("[HealthCheck] LangGraph configuration missing");
      await ctx.runMutation(internal.langgraph.health.updateHealthStatus, {
        status: "unavailable",
        error: "LangGraph URL or API key not configured",
        services: null,
        performance: null,
      });
      return {
        success: false,
        error: "Configuration missing",
      };
    }

    try {
      // Call the /health endpoint with authentication
      console.log(`[HealthCheck] Calling ${langgraphUrl}/health`);

      const response = await fetch(`${langgraphUrl}/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(
          `Health check failed with status ${response.status}: ${response.statusText}`,
        );
      }

      const healthData = (await response.json()) as {
        status: string;
        validation?: {
          status: string;
          errors?: string[];
        };
        services?: {
          fastapi?: string;
          langgraph?: string;
          openai?: string;
          convex?: string;
        };
        performance?: {
          active_tasks?: number;
          queue_size?: number;
          memory_usage_mb?: number;
          memory_percent?: number;
        };
      };

      console.log("[HealthCheck] Health check response:", healthData);

      // Determine overall status based on health data
      let overallStatus: "healthy" | "degraded" | "unavailable" = "healthy";

      // Check if any services are not configured or not connected
      if (
        healthData.services?.openai === "not configured" ||
        healthData.services?.convex === "not configured"
      ) {
        overallStatus = "degraded";
      }

      // Check if validation failed
      if (
        healthData.validation?.status === "failed" &&
        healthData.validation?.errors &&
        healthData.validation.errors.length > 0
      ) {
        overallStatus = "degraded";
      }

      // Update health status in database
      await ctx.runMutation(internal.langgraph.health.updateHealthStatus, {
        status: overallStatus,
        error: null,
        services: {
          fastapi: healthData.services?.fastapi || "unknown",
          langgraph: healthData.services?.langgraph || "unknown",
          openai: healthData.services?.openai || "unknown",
          convex: healthData.services?.convex || "unknown",
        },
        performance: {
          activeTasksCount: healthData.performance?.active_tasks || 0,
          queueSize: healthData.performance?.queue_size || 0,
          memoryUsageMb: healthData.performance?.memory_usage_mb || 0,
          memoryPercent: healthData.performance?.memory_percent || 0,
        },
      });

      console.log(`[HealthCheck] Health check completed with status: ${overallStatus}`);

      return {
        success: true,
        status: overallStatus,
        services: healthData.services,
        performance: healthData.performance,
      };
    } catch (error) {
      console.error("[HealthCheck] Health check failed:", error);

      // Update health status to unavailable
      await ctx.runMutation(internal.langgraph.health.updateHealthStatus, {
        status: "unavailable",
        error: error instanceof Error ? error.message : "Health check failed",
        services: null,
        performance: null,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Internal mutation to update health status in system configuration
export const updateHealthStatus = internalMutation({
  args: {
    status: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("unavailable"),
    ),
    error: v.union(v.string(), v.null()),
    services: v.union(
      v.object({
        fastapi: v.string(),
        langgraph: v.string(),
        openai: v.string(),
        convex: v.string(),
      }),
      v.null(),
    ),
    performance: v.union(
      v.object({
        activeTasksCount: v.number(),
        queueSize: v.number(),
        memoryUsageMb: v.number(),
        memoryPercent: v.number(),
      }),
      v.null(),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get current system configuration
    const systemConfig = await ctx.db.query("systemConfiguration").unique();

    if (!systemConfig) {
      console.error("[HealthCheck] System configuration not found");
      return;
    }

    // Get current orchestration settings
    const currentSettings = systemConfig.orchestrationSettings || {
      leadGenerationEnabled: true,
      maintenanceMode: false,
      maxConcurrentSearches: 10,
    };

    // Get current health status or initialize
    const currentHealth = currentSettings.langGraphHealth || {
      status: "unknown" as const,
      lastCheckedAt: 0,
      lastSuccessAt: 0,
      consecutiveFailures: 0,
      lastError: null,
      services: null,
      performance: null,
    };

    // Update consecutive failures
    let consecutiveFailures = currentHealth.consecutiveFailures;
    let lastSuccessAt = currentHealth.lastSuccessAt;

    if (args.status === "healthy") {
      consecutiveFailures = 0;
      lastSuccessAt = now;
    } else if (args.status === "unavailable") {
      consecutiveFailures += 1;
    }

    // Auto-pause lead generation if we have 3 consecutive failures
    let leadGenerationEnabled = currentSettings.leadGenerationEnabled;
    let pauseReason = currentSettings.pauseReason;

    if (consecutiveFailures >= 3 && leadGenerationEnabled) {
      console.warn(
        `[HealthCheck] Auto-pausing lead generation after ${consecutiveFailures} consecutive failures`,
      );
      leadGenerationEnabled = false;
      pauseReason = `LangGraph worker health check failed ${consecutiveFailures} times: ${args.error}`;
    }

    // Auto-resume if health is restored and was auto-paused
    if (
      args.status === "healthy" &&
      !leadGenerationEnabled &&
      pauseReason?.includes("LangGraph worker health check failed")
    ) {
      console.log(
        "[HealthCheck] Auto-resuming lead generation after health restoration",
      );
      leadGenerationEnabled = true;
      pauseReason = undefined;
    }

    // Update system configuration with new health status
    await ctx.db.patch(systemConfig._id, {
      orchestrationSettings: {
        ...currentSettings,
        leadGenerationEnabled,
        pauseReason,
        langGraphHealth: {
          status: args.status,
          lastCheckedAt: now,
          lastSuccessAt,
          consecutiveFailures,
          lastError: args.error,
          services: args.services,
          performance: args.performance,
        },
      },
    });

    console.log(
      `[HealthCheck] Updated health status: ${args.status}, consecutive failures: ${consecutiveFailures}, lead generation: ${leadGenerationEnabled ? "enabled" : "disabled"}`,
    );
  },
});

// Query to get current LangGraph health status (admin only)
export const getLangGraphHealth = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    // Get system configuration
    const systemConfig: any = await ctx.runQuery(
      api.admin.queries.getSystemConfiguration,
      {},
    );

    if (!systemConfig?.orchestrationSettings?.langGraphHealth) {
      return {
        status: "unknown" as const,
        lastCheckedAt: 0,
        lastSuccessAt: 0,
        consecutiveFailures: 0,
        lastError: "Health check not yet run",
        services: null,
        performance: null,
      };
    }

    return systemConfig.orchestrationSettings.langGraphHealth;
  },
});
