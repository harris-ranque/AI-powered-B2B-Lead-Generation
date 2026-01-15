/**
 * API Error Hook
 *
 * Centralized API error handling with toast notifications, navigation to action URLs,
 * and PostHog analytics tracking.
 *
 * Usage:
 * ```typescript
 * const { handleApiError, showApiErrorToast, ApiErrorAlert } = useApiError();
 *
 * try {
 *   await someConvexAction();
 * } catch (error) {
 *   handleApiError(error, 'search_creation');
 * }
 * ```
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAnalytics } from "./useAnalytics";
import {
  type ApiError,
  type ApiErrorCategory,
  type ErrorAction,
  type ErrorSeverity,
  extractApiError,
  isApiError,
} from "@genni/shared-types";

/**
 * Extended error info with retry countdown state
 */
export interface ApiErrorState {
  error: ApiError;
  retryCountdown?: number;
  dismissed: boolean;
}

/**
 * Options for handling API errors
 */
export interface HandleApiErrorOptions {
  /** If true, don't show toast (useful when using inline error component) */
  silent?: boolean;
  /** Custom operation name for analytics */
  operationType?: string;
  /** Additional context for analytics */
  context?: Record<string, unknown>;
  /** Callback after error is handled */
  onError?: (apiError: ApiError) => void;
  /** Callback if action button is clicked */
  onAction?: (action: ErrorAction) => void;
}

/**
 * Toast style configuration based on severity
 */
const TOAST_SEVERITY_STYLES: Record<
  ErrorSeverity,
  "info" | "warning" | "error"
> = {
  info: "info",
  warning: "warning",
  error: "error",
  critical: "error",
};

/**
 * Provider-specific icons for toast messages
 */
const PROVIDER_ICONS: Record<string, string> = {
  google_maps: "🗺️",
  google_places: "📍",
  findymail: "📧",
  perplexity: "🔍",
  tavily: "🔎",
  openai: "🤖",
  fastspring: "💳",
  instantly: "⚡",
  internal: "⚙️",
};

/**
 * Action URLs for navigation
 */
const ACTION_URLS: Record<ErrorAction, string | null> = {
  check_api_key: "/settings?tab=api-keys",
  add_credits: "/subscribe",
  wait_retry: null, // No navigation, handled by retry countdown
  manual_retry: null, // No navigation, handled by retry button
  contact_support: "/contact",
  upgrade_plan: "/subscribe",
  check_connection: null, // No navigation
  fix_input: null, // No navigation
  none: null,
};

/**
 * Hook for centralized API error handling
 */
export function useApiError() {
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const [currentError, setCurrentError] = useState<ApiErrorState | null>(null);
  const [retryInterval, setRetryInterval] = useState<ReturnType<
    typeof setInterval
  > | null>(null);

  /**
   * Track API error in PostHog
   */
  const trackApiError = useCallback(
    (apiError: ApiError, operationType?: string) => {
      analytics.captureEvent("api_error_occurred", {
        error_code: apiError.errorCode,
        provider: apiError.provider,
        category: apiError.category,
        severity: apiError.severity,
        retryable: apiError.retryable,
        suggested_action: apiError.suggestedAction,
        operation_type: operationType || apiError.operationType,
        correlation_id: apiError.correlationId,
        original_status: apiError.originalStatus,
      });
    },
    [analytics]
  );

  /**
   * Navigate to action URL if available
   */
  const navigateToAction = useCallback(
    (action: ErrorAction, actionUrl?: string) => {
      // Use provided actionUrl first, then fall back to default
      const url = actionUrl || ACTION_URLS[action];
      if (url) {
        // Check if it's an external URL
        if (url.startsWith("http://") || url.startsWith("https://")) {
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          navigate(url);
        }
      }
    },
    [navigate]
  );

  /**
   * Clear current error state and retry countdown
   */
  const clearError = useCallback(() => {
    if (retryInterval) {
      clearInterval(retryInterval);
      setRetryInterval(null);
    }
    setCurrentError(null);
  }, [retryInterval]);

  /**
   * Start retry countdown for retryable errors
   */
  const startRetryCountdown = useCallback(
    (
      apiError: ApiError,
      onRetry?: () => void
    ): ReturnType<typeof setInterval> | null => {
      if (!apiError.retryable || !apiError.retryAfterMs) {
        return null;
      }

      let remaining = Math.ceil(apiError.retryAfterMs / 1000);
      setCurrentError((prev) =>
        prev ? { ...prev, retryCountdown: remaining } : null
      );

      const interval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(interval);
          setRetryInterval(null);
          setCurrentError(null);
          onRetry?.();
        } else {
          setCurrentError((prev) =>
            prev ? { ...prev, retryCountdown: remaining } : null
          );
        }
      }, 1000);

      setRetryInterval(interval);
      return interval;
    },
    []
  );

  /**
   * Show toast notification for API error
   */
  const showApiErrorToast = useCallback(
    (apiError: ApiError, options?: HandleApiErrorOptions) => {
      const icon = PROVIDER_ICONS[apiError.provider] || "⚠️";
      const toastType = TOAST_SEVERITY_STYLES[apiError.severity];

      // Build action button if applicable
      const hasAction =
        apiError.suggestedAction !== "none" &&
        apiError.suggestedAction !== "wait_retry";
      const actionLabel = apiError.actionLabel || getDefaultActionLabel(apiError.suggestedAction);

      // Show toast with appropriate severity
      const toastOptions = {
        description: apiError.userMessage,
        duration: apiError.severity === "critical" ? 10000 : 6000,
        action: hasAction
          ? {
              label: actionLabel,
              onClick: () => {
                options?.onAction?.(apiError.suggestedAction);
                navigateToAction(apiError.suggestedAction, apiError.actionUrl);
              },
            }
          : undefined,
      };

      const title = `${icon} ${getProviderDisplayName(apiError.provider)}`;

      switch (toastType) {
        case "error":
          toast.error(title, toastOptions);
          break;
        case "warning":
          toast.warning(title, toastOptions);
          break;
        case "info":
        default:
          toast.info(title, toastOptions);
          break;
      }

      // Start retry countdown if applicable
      if (apiError.retryable && apiError.retryAfterMs) {
        const seconds = Math.ceil(apiError.retryAfterMs / 1000);
        toast.info("Auto-retry", {
          description: `Retrying in ${seconds} seconds...`,
          duration: apiError.retryAfterMs + 1000,
        });
      }
    },
    [navigateToAction]
  );

  /**
   * Main error handling function
   * Extracts ApiError from any error format and handles it appropriately
   */
  const handleApiError = useCallback(
    (
      error: unknown,
      operationType?: string,
      options?: HandleApiErrorOptions
    ): ApiError | null => {
      // Try to extract structured ApiError
      const apiError = extractApiError(error);

      if (apiError) {
        // Update state
        setCurrentError({
          error: apiError,
          dismissed: false,
        });

        // Track in analytics
        trackApiError(apiError, operationType || options?.operationType);

        // Show toast unless silent
        if (!options?.silent) {
          showApiErrorToast(apiError, options);
        }

        // Call error callback
        options?.onError?.(apiError);

        // Start retry countdown if applicable
        if (apiError.retryable && apiError.retryAfterMs) {
          startRetryCountdown(apiError);
        }

        return apiError;
      }

      // Fall back to generic error handling
      const message =
        error instanceof Error ? error.message : "An unexpected error occurred";
      console.error("[useApiError] Unstructured error:", error);

      // Track as unknown error
      analytics.trackOperationFailed({
        operation: operationType || options?.operationType || "unknown",
        error_type: error instanceof Error ? error.name : "unknown",
        error_message: message,
      });

      // Show generic toast
      if (!options?.silent) {
        toast.error("Error", {
          description: message,
        });
      }

      return null;
    },
    [trackApiError, showApiErrorToast, startRetryCountdown, analytics]
  );

  /**
   * Check if error is user-actionable (requires user to take action)
   */
  const isUserActionable = useCallback((apiError: ApiError): boolean => {
    const actionableCategories: ApiErrorCategory[] = [
      "authentication",
      "authorization",
      "quota_exhausted",
      "rate_limit_exceeded",
    ];
    return actionableCategories.includes(apiError.category);
  }, []);

  /**
   * Check if error should block the pipeline
   */
  const shouldBlockPipeline = useCallback((apiError: ApiError): boolean => {
    const blockingCategories: ApiErrorCategory[] = [
      "authentication",
      "quota_exhausted",
      "rate_limit_exceeded",
    ];
    return blockingCategories.includes(apiError.category);
  }, []);

  return {
    // State
    currentError,
    isApiError,

    // Core functions
    handleApiError,
    showApiErrorToast,
    clearError,

    // Utilities
    extractApiError,
    isUserActionable,
    shouldBlockPipeline,
    navigateToAction,
    trackApiError,

    // Retry helpers
    startRetryCountdown,
  };
}

/**
 * Get human-readable provider name
 */
function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    google_maps: "Google Maps",
    google_places: "Google Places",
    findymail: "FindyMail",
    perplexity: "Perplexity",
    tavily: "Tavily",
    openai: "OpenAI",
    fastspring: "FastSpring",
    instantly: "Instantly",
    internal: "System",
  };
  return names[provider] || provider;
}

/**
 * Get default action button label
 */
function getDefaultActionLabel(action: ErrorAction): string {
  const labels: Record<ErrorAction, string> = {
    check_api_key: "Check API Key",
    add_credits: "Add Credits",
    wait_retry: "Waiting...",
    manual_retry: "Retry",
    contact_support: "Contact Support",
    upgrade_plan: "Upgrade Plan",
    check_connection: "Check Connection",
    fix_input: "Fix Input",
    none: "",
  };
  return labels[action] || "Take Action";
}

// Re-export types for convenience
export type { ApiError, ApiErrorCategory, ErrorAction, ErrorSeverity };
