/**
 * API Error Classification Module
 *
 * Classifies external API errors into standardized ApiError format
 * for consistent handling across the backend and frontend.
 */

import { ConvexError } from "convex/values";
import type {
  ApiError,
  ApiProvider,
  ApiErrorCategory,
  ErrorSeverity,
  ErrorAction,
  ApiErrorCode,
} from "@genni/shared-types";
import {
  API_ERROR_CODES,
  ERROR_MESSAGES,
  getErrorMessage,
} from "@genni/shared-types";

// ============================================
// Google Maps/Places Error Classification
// ============================================

/**
 * Classify Google Maps/Places API errors
 * @param status - Places API status string (OK, ZERO_RESULTS, OVER_QUERY_LIMIT, etc.)
 * @param errorMessage - Optional error message from response
 * @param httpStatus - Optional HTTP status code
 */
export function classifyGoogleError(
  status: string,
  errorMessage?: string,
  httpStatus?: number
): ApiError {
  const base = {
    provider: "google_places" as ApiProvider,
    timestamp: Date.now(),
    originalStatus: httpStatus,
    originalMessage: errorMessage,
  };

  switch (status) {
    case "OVER_QUERY_LIMIT":
    case "RESOURCE_EXHAUSTED":
      return {
        ...base,
        errorCode: API_ERROR_CODES.GOOGLE_QUOTA_EXHAUSTED,
        category: "quota_exhausted",
        ...getErrorMessage(API_ERROR_CODES.GOOGLE_QUOTA_EXHAUSTED),
      };

    case "REQUEST_DENIED":
      // Check if it's an auth error or permission error
      const isAuthError =
        errorMessage?.toLowerCase().includes("api key") ||
        errorMessage?.toLowerCase().includes("invalid key");

      if (isAuthError) {
        return {
          ...base,
          errorCode: API_ERROR_CODES.GOOGLE_AUTH_FAILED,
          category: "authentication",
          ...getErrorMessage(API_ERROR_CODES.GOOGLE_AUTH_FAILED),
        };
      }

      return {
        ...base,
        errorCode: API_ERROR_CODES.GOOGLE_REQUEST_DENIED,
        category: "authorization",
        userMessage:
          "Google Maps API request was denied. Please check your API key permissions.",
        severity: "error" as ErrorSeverity,
        retryable: false,
        suggestedAction: "check_api_key" as ErrorAction,
        actionLabel: "Check API Key",
        actionUrl: "/settings/api-keys",
      };

    case "INVALID_REQUEST":
      return {
        ...base,
        errorCode: API_ERROR_CODES.GOOGLE_INVALID_REQUEST,
        category: "invalid_request",
        ...getErrorMessage(API_ERROR_CODES.GOOGLE_INVALID_REQUEST),
      };

    case "ZERO_RESULTS":
      return {
        ...base,
        errorCode: API_ERROR_CODES.GOOGLE_ZERO_RESULTS,
        category: "not_found",
        ...getErrorMessage(API_ERROR_CODES.GOOGLE_ZERO_RESULTS),
      };

    case "UNKNOWN_ERROR":
    default:
      // Check HTTP status for server errors
      if (httpStatus && httpStatus >= 500) {
        return {
          ...base,
          errorCode: API_ERROR_CODES.GOOGLE_SERVER_ERROR,
          category: "server_error",
          ...getErrorMessage(API_ERROR_CODES.GOOGLE_SERVER_ERROR),
        };
      }

      return {
        ...base,
        errorCode: API_ERROR_CODES.UNKNOWN_ERROR,
        category: "unknown",
        ...getErrorMessage(API_ERROR_CODES.UNKNOWN_ERROR),
        technicalMessage: errorMessage,
      };
  }
}

// ============================================
// FindyMail Error Classification
// ============================================

/**
 * Classify FindyMail API errors
 * @param httpStatus - HTTP status code
 * @param errorBody - Response body or error message
 */
export function classifyFindyMailError(
  httpStatus: number,
  errorBody?: any
): ApiError {
  const errorMessage =
    typeof errorBody === "string"
      ? errorBody
      : errorBody?.message || errorBody?.error || "";

  const base = {
    provider: "findymail" as ApiProvider,
    timestamp: Date.now(),
    originalStatus: httpStatus,
    originalMessage: errorMessage,
  };

  switch (httpStatus) {
    case 401:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FINDYMAIL_AUTH_FAILED,
        category: "authentication",
        ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_AUTH_FAILED),
      };

    case 402:
      // Payment required = credits exhausted
      return {
        ...base,
        errorCode: API_ERROR_CODES.FINDYMAIL_CREDITS_EXHAUSTED,
        category: "quota_exhausted",
        ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_CREDITS_EXHAUSTED),
      };

    case 423:
      // Subscription is paused (per FindyMail API docs)
      return {
        ...base,
        errorCode: API_ERROR_CODES.FINDYMAIL_SUBSCRIPTION_PAUSED,
        category: "subscription_paused",
        ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_SUBSCRIPTION_PAUSED),
      };

    case 429:
      // Check if it's transient rate limiting or quota exhaustion
      const isQuotaExhausted =
        errorMessage.toLowerCase().includes("quota") ||
        errorMessage.toLowerCase().includes("limit exceeded") ||
        errorMessage.toLowerCase().includes("credits");

      if (isQuotaExhausted) {
        return {
          ...base,
          errorCode: API_ERROR_CODES.FINDYMAIL_CREDITS_EXHAUSTED,
          category: "rate_limit_exceeded",
          ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_CREDITS_EXHAUSTED),
        };
      }

      // Transient rate limiting
      const retryAfterMs = parseRetryAfterHeader(errorBody);
      return {
        ...base,
        errorCode: API_ERROR_CODES.FINDYMAIL_RATE_LIMITED,
        category: "rate_limited",
        ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_RATE_LIMITED),
        retryAfterMs,
      };

    case 400:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FINDYMAIL_INVALID_REQUEST,
        category: "invalid_request",
        ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_INVALID_REQUEST),
        technicalMessage: errorMessage,
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FINDYMAIL_SERVER_ERROR,
        category: "server_error",
        ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_SERVER_ERROR),
        retryAfterMs: 5000,
      };

    default:
      return {
        ...base,
        errorCode: API_ERROR_CODES.UNKNOWN_ERROR,
        category: httpStatus >= 500 ? "server_error" : "unknown",
        ...getErrorMessage(API_ERROR_CODES.UNKNOWN_ERROR),
        retryable: httpStatus >= 500,
        technicalMessage: errorMessage,
      };
  }
}

/**
 * Create a "no contacts found" result for FindyMail
 * This is NOT an error - it's a successful API call with no results
 */
export function createFindyMailNoContactsResult(): ApiError {
  return {
    provider: "findymail" as ApiProvider,
    timestamp: Date.now(),
    errorCode: API_ERROR_CODES.FINDYMAIL_NO_CONTACTS_FOUND,
    category: "no_results",
    ...getErrorMessage(API_ERROR_CODES.FINDYMAIL_NO_CONTACTS_FOUND),
  };
}

// ============================================
// Perplexity Error Classification
// ============================================

/**
 * Classify Perplexity API errors
 * @param httpStatus - HTTP status code
 * @param errorMessage - Error message
 * @param retryAfter - Optional Retry-After header value in seconds
 */
export function classifyPerplexityError(
  httpStatus: number,
  errorMessage: string = "",
  retryAfter?: number
): ApiError {
  const base = {
    provider: "perplexity" as ApiProvider,
    timestamp: Date.now(),
    originalStatus: httpStatus,
    originalMessage: errorMessage,
  };

  switch (httpStatus) {
    case 401:
      return {
        ...base,
        errorCode: API_ERROR_CODES.PERPLEXITY_AUTH_FAILED,
        category: "authentication",
        ...getErrorMessage(API_ERROR_CODES.PERPLEXITY_AUTH_FAILED),
      };

    case 402:
      return {
        ...base,
        errorCode: API_ERROR_CODES.PERPLEXITY_CREDITS_EXHAUSTED,
        category: "quota_exhausted",
        ...getErrorMessage(API_ERROR_CODES.PERPLEXITY_CREDITS_EXHAUSTED),
      };

    case 429:
      // Check if it's quota vs transient rate limiting
      const isQuotaExceeded =
        errorMessage.toLowerCase().includes("quota") ||
        errorMessage.toLowerCase().includes("billing") ||
        errorMessage.toLowerCase().includes("limit exceeded");

      if (isQuotaExceeded) {
        return {
          ...base,
          errorCode: API_ERROR_CODES.PERPLEXITY_RATE_EXCEEDED,
          category: "rate_limit_exceeded",
          ...getErrorMessage(API_ERROR_CODES.PERPLEXITY_RATE_EXCEEDED),
        };
      }

      return {
        ...base,
        errorCode: API_ERROR_CODES.PERPLEXITY_RATE_LIMITED,
        category: "rate_limited",
        ...getErrorMessage(API_ERROR_CODES.PERPLEXITY_RATE_LIMITED),
        retryAfterMs: retryAfter ? retryAfter * 1000 : 5000,
      };

    case 408:
      return {
        ...base,
        errorCode: API_ERROR_CODES.PERPLEXITY_TIMEOUT,
        category: "timeout",
        ...getErrorMessage(API_ERROR_CODES.PERPLEXITY_TIMEOUT),
        retryAfterMs: 2000,
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        ...base,
        errorCode: API_ERROR_CODES.PERPLEXITY_SERVER_ERROR,
        category: "server_error",
        ...getErrorMessage(API_ERROR_CODES.PERPLEXITY_SERVER_ERROR),
        retryAfterMs: 5000,
      };

    default:
      return {
        ...base,
        errorCode: API_ERROR_CODES.UNKNOWN_ERROR,
        category: httpStatus >= 500 ? "server_error" : "unknown",
        ...getErrorMessage(API_ERROR_CODES.UNKNOWN_ERROR),
        retryable: httpStatus >= 500,
        technicalMessage: errorMessage,
      };
  }
}

// ============================================
// OpenAI Error Classification
// ============================================

/**
 * Classify OpenAI API errors
 * @param httpStatus - HTTP status code
 * @param errorMessage - Error message
 * @param errorType - OpenAI error type (e.g., "insufficient_quota")
 */
export function classifyOpenAIError(
  httpStatus: number,
  errorMessage: string = "",
  errorType?: string
): ApiError {
  const base = {
    provider: "openai" as ApiProvider,
    timestamp: Date.now(),
    originalStatus: httpStatus,
    originalMessage: errorMessage,
  };

  // Check for specific error types
  if (
    errorType === "insufficient_quota" ||
    errorMessage.toLowerCase().includes("quota") ||
    errorMessage.toLowerCase().includes("billing")
  ) {
    return {
      ...base,
      errorCode: API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED,
      category: "quota_exhausted",
      ...getErrorMessage(API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED),
    };
  }

  if (errorMessage.toLowerCase().includes("context length")) {
    return {
      ...base,
      errorCode: API_ERROR_CODES.OPENAI_CONTEXT_LENGTH,
      category: "invalid_request",
      ...getErrorMessage(API_ERROR_CODES.OPENAI_CONTEXT_LENGTH),
    };
  }

  switch (httpStatus) {
    case 401:
      return {
        ...base,
        errorCode: API_ERROR_CODES.OPENAI_AUTH_FAILED,
        category: "authentication",
        ...getErrorMessage(API_ERROR_CODES.OPENAI_AUTH_FAILED),
      };

    case 429:
      return {
        ...base,
        errorCode: API_ERROR_CODES.OPENAI_RATE_LIMITED,
        category: "rate_limited",
        ...getErrorMessage(API_ERROR_CODES.OPENAI_RATE_LIMITED),
        retryAfterMs: 10000, // OpenAI rate limits can be longer
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        ...base,
        errorCode: API_ERROR_CODES.OPENAI_SERVER_ERROR,
        category: "server_error",
        ...getErrorMessage(API_ERROR_CODES.OPENAI_SERVER_ERROR),
        retryAfterMs: 5000,
      };

    default:
      return {
        ...base,
        errorCode: API_ERROR_CODES.UNKNOWN_ERROR,
        category: httpStatus >= 500 ? "server_error" : "unknown",
        ...getErrorMessage(API_ERROR_CODES.UNKNOWN_ERROR),
        retryable: httpStatus >= 500,
        technicalMessage: errorMessage,
      };
  }
}

// ============================================
// FastSpring (Billing) Error Classification
// ============================================

/**
 * Classify FastSpring billing API errors
 * @param httpStatus - HTTP status code
 * @param errorMessage - Error message
 */
export function classifyFastSpringError(
  httpStatus: number,
  errorMessage: string = ""
): ApiError {
  const base = {
    provider: "fastspring" as ApiProvider,
    timestamp: Date.now(),
    originalStatus: httpStatus,
    originalMessage: errorMessage,
  };

  switch (httpStatus) {
    case 401:
    case 403:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FASTSPRING_AUTH_FAILED,
        category: "authentication",
        ...getErrorMessage(API_ERROR_CODES.FASTSPRING_AUTH_FAILED),
      };

    case 402:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FASTSPRING_PAYMENT_FAILED,
        category: "quota_exhausted",
        ...getErrorMessage(API_ERROR_CODES.FASTSPRING_PAYMENT_FAILED),
      };

    case 404:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FASTSPRING_ORDER_NOT_FOUND,
        category: "not_found",
        ...getErrorMessage(API_ERROR_CODES.FASTSPRING_ORDER_NOT_FOUND),
      };

    case 500:
    case 502:
    case 503:
    case 504:
      return {
        ...base,
        errorCode: API_ERROR_CODES.FASTSPRING_SERVER_ERROR,
        category: "server_error",
        ...getErrorMessage(API_ERROR_CODES.FASTSPRING_SERVER_ERROR),
        retryAfterMs: 5000,
      };

    default:
      return {
        ...base,
        errorCode: API_ERROR_CODES.UNKNOWN_ERROR,
        category: httpStatus >= 500 ? "server_error" : "unknown",
        ...getErrorMessage(API_ERROR_CODES.UNKNOWN_ERROR),
        retryable: httpStatus >= 500,
        technicalMessage: errorMessage,
      };
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Parse Retry-After header from response
 */
function parseRetryAfterHeader(errorBody: any): number | undefined {
  if (!errorBody) return undefined;

  // Check for retry_after in body
  if (typeof errorBody.retry_after === "number") {
    return errorBody.retry_after * 1000;
  }

  // Check for retryAfter in body
  if (typeof errorBody.retryAfter === "number") {
    return errorBody.retryAfter * 1000;
  }

  return undefined;
}

/**
 * Create a ConvexError with embedded ApiError
 * This allows the frontend to extract and display the error properly
 */
export function createApiConvexError(apiError: ApiError): ConvexError<string> {
  // Serialize ApiError data into the ConvexError message for frontend extraction
  // The frontend uses extractApiError() from shared-types to reconstruct the ApiError
  const errorData = {
    type: "api_error" as const,
    errorCode: apiError.errorCode,
    provider: apiError.provider,
    category: apiError.category,
    severity: apiError.severity,
    userMessage: apiError.userMessage,
    retryable: apiError.retryable ?? false,
    suggestedAction: apiError.suggestedAction,
    actionLabel: apiError.actionLabel,
    actionUrl: apiError.actionUrl,
    retryAfterMs: apiError.retryAfterMs,
    technicalMessage: apiError.technicalMessage,
    originalStatus: apiError.originalStatus,
    timestamp: apiError.timestamp,
  };

  // Use JSON string to embed structured data in ConvexError
  // Frontend can parse this to reconstruct ApiError
  return new ConvexError(JSON.stringify(errorData));
}

/**
 * Check if an error is a user-actionable API error
 * (i.e., requires user to do something, not just wait/retry)
 */
export function isUserActionableApiError(apiError: ApiError): boolean {
  const userActionableCategories: ApiErrorCategory[] = [
    "authentication",
    "authorization",
    "quota_exhausted",
    "rate_limit_exceeded",
  ];
  return userActionableCategories.includes(apiError.category);
}

/**
 * Check if error should block the pipeline
 * Based on user preference: block immediately on quota/credit errors
 */
export function shouldBlockPipeline(apiError: ApiError): boolean {
  const blockingCategories: ApiErrorCategory[] = [
    "authentication",
    "authorization",
    "quota_exhausted",
    "subscription_paused",
    "rate_limit_exceeded",
  ];
  return blockingCategories.includes(apiError.category);
}

// Re-export types and codes for convenience
export type { ApiError, ApiProvider, ApiErrorCategory, ErrorSeverity, ErrorAction };
export { API_ERROR_CODES };
