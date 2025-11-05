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
