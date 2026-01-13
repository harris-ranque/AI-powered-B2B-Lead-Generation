/**
 * Analytics module for tracking events
 *
 * NOTE: PostHog Node SDK cannot be used in Convex (Node.js specific).
 * Analytics should be handled from the frontend or via HTTP actions.
 * This module provides stub implementations for backward compatibility.
 */

type AnalyticsProperties = Record<string, unknown>;

/**
 * Stub implementation - analytics should be sent from frontend
 */
export function captureAnalyticsEvent(
  distinctId: string | null | undefined,
  event: string,
  properties: AnalyticsProperties = {},
): void {
  // Log to console for debugging in development
  if (process.env.NODE_ENV === "development") {
    console.log("Analytics event:", {
      distinctId: distinctId || "anonymous",
      event,
      properties,
    });
  }
  // In production, analytics should be handled by the frontend
  // using PostHog's browser SDK or via HTTP actions
}

/**
 * Stub implementation - analytics should be sent from frontend
 */
export function captureAnalyticsException(
  distinctId: string | null | undefined,
  event: string,
  error: unknown,
  properties: AnalyticsProperties = {},
): void {
  captureAnalyticsEvent(distinctId, event, {
    ...properties,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Track lead enrichment completion performance metrics
 * Frontend should send these events to PostHog for analytics
 */
export function trackEnrichmentCompleted(properties: {
  searchId: string;
  leadId: string;
  provider: "findymail" | "icypeas";
  durationMs: number;
  rolesFound: number;
  emailFound: boolean;
  retryAttempt: number;
  apiKeyHash?: string;
}): void {
  captureAnalyticsEvent(null, "lead_enrichment_completed", properties);
}

/**
 * Track lead enrichment failure metrics
 * Frontend should send these events to PostHog for analytics
 */
export function trackEnrichmentFailed(properties: {
  searchId: string;
  leadId: string;
  provider: "findymail" | "icypeas";
  durationMs: number;
  errorType: string;
  retryAttempt: number;
}): void {
  captureAnalyticsEvent(null, "lead_enrichment_failed", properties);
}

/**
 * Track enrichment batch start metrics
 * Frontend should send these events to PostHog for analytics
 */
export function trackEnrichmentBatchStarted(properties: {
  searchId: string;
  totalLeads: number;
  workpoolParallelism: number;
  apiKeysUsed: number;
}): void {
  captureAnalyticsEvent(null, "enrichment_batch_started", properties);
}
