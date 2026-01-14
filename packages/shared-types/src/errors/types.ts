/**
 * Unified API Error Types
 *
 * Provides consistent error classification across all API integrations.
 * Used by Convex backend, LangGraph worker, and React frontend.
 */

/**
 * API provider identification
 */
export type ApiProvider =
  | "google_maps"
  | "google_places"
  | "findymail"
  | "perplexity"
  | "tavily"
  | "openai"
  | "fastspring"
  | "instantly"
  | "internal";

/**
 * Error categories for classification
 */
export type ApiErrorCategory =
  | "authentication" // 401 - Invalid/expired API key
  | "authorization" // 403 - Insufficient permissions
  | "quota_exhausted" // 402, OVER_QUERY_LIMIT - Account credits/quota depleted
  | "subscription_paused" // 423 - Subscription paused (user action needed)
  | "rate_limited" // 429 - Transient rate limiting (retryable)
  | "rate_limit_exceeded" // 429 - Persistent rate limiting (user action needed)
  | "invalid_request" // 400 - Malformed request
  | "not_found" // 404 - Resource not found
  | "no_results" // API succeeded but no data found
  | "server_error" // 5xx - Server-side errors (retryable)
  | "timeout" // Timeout errors
  | "network" // Network connectivity issues
  | "validation" // Input validation errors
  | "unknown"; // Unclassified errors

/**
 * Action types for user guidance
 */
export type ErrorAction =
  | "check_api_key" // Go to settings and verify API key
  | "add_credits" // Purchase more credits/upgrade plan
  | "wait_retry" // Wait and retry automatically
  | "manual_retry" // Click to retry
  | "contact_support" // Contact support for help
  | "upgrade_plan" // Upgrade subscription
  | "check_connection" // Verify internet connection
  | "fix_input" // Fix invalid input
  | "none"; // No action available

/**
 * Severity levels for UI treatment
 */
export type ErrorSeverity = "info" | "warning" | "error" | "critical";

/**
 * Standardized API error structure
 * Used across all layers: backend, worker, frontend
 */
export interface ApiError {
  // Identification
  errorCode: string; // Machine-readable code (e.g., "FINDYMAIL_CREDITS_EXHAUSTED")
  provider: ApiProvider; // Which API provider
  category: ApiErrorCategory; // Classification

  // User communication
  userMessage: string; // Human-readable message for user
  technicalMessage?: string; // Technical details (dev mode only)

  // Behavior hints
  severity: ErrorSeverity;
  retryable: boolean;
  retryAfterMs?: number; // If retryable, suggested wait time in milliseconds

  // Action guidance
  suggestedAction: ErrorAction;
  actionUrl?: string; // Deep link for action (e.g., "/settings/api-keys")
  actionLabel?: string; // Button text for action

  // Context (optional)
  timestamp?: number;
  correlationId?: string;
  operationType?: string; // What operation failed

  // Original error data (for debugging)
  originalStatus?: number;
  originalMessage?: string;
}

/**
 * Minimal API error for serialization (webhook payloads, etc.)
 */
export interface ApiErrorSummary {
  errorCode: string;
  provider: ApiProvider;
  category: ApiErrorCategory;
  userMessage: string;
  retryable: boolean;
  suggestedAction: ErrorAction;
}

/**
 * Error log entry for database storage
 */
export interface ApiErrorLogEntry {
  userId: string;
  searchId?: string;
  leadId?: string;
  errorCode: string;
  provider: string;
  category: string;
  severity: string;
  userMessage: string;
  technicalMessage?: string;
  originalStatus?: number;
  operationType?: string;
  correlationId?: string;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: "retry" | "user" | "system";
  createdAt: number;
}

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "errorCode" in error &&
    "provider" in error &&
    "category" in error &&
    "userMessage" in error
  );
}

/**
 * Extract ApiError from various error formats
 */
export function extractApiError(error: unknown): ApiError | null {
  // Direct ApiError
  if (isApiError(error)) {
    return error;
  }

  // Nested in 'apiError' property
  if (
    typeof error === "object" &&
    error !== null &&
    "apiError" in error &&
    isApiError((error as any).apiError)
  ) {
    return (error as any).apiError;
  }

  // Nested in 'data.apiError' (Convex error format)
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as any).data === "object" &&
    (error as any).data !== null &&
    "apiError" in (error as any).data &&
    isApiError((error as any).data.apiError)
  ) {
    return (error as any).data.apiError;
  }

  return null;
}
