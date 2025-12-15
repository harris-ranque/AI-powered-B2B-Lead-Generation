/**
 * API Error Messages
 *
 * User-friendly message templates for all API error codes.
 * Includes suggested actions and URLs for resolution.
 */

import type { ErrorAction, ErrorSeverity } from "./types";
import type { ApiErrorCode } from "./codes";
import { API_ERROR_CODES } from "./codes";

/**
 * Error message template structure
 */
export interface ErrorMessageTemplate {
  userMessage: string;
  suggestedAction: ErrorAction;
  severity: ErrorSeverity;
  actionLabel?: string;
  actionUrl?: string;
  retryable: boolean;
}

/**
 * User-friendly message templates for each error code
 */
export const ERROR_MESSAGES: Record<ApiErrorCode, ErrorMessageTemplate> = {
  // ============================================
  // Google Maps/Places Errors
  // ============================================
  [API_ERROR_CODES.GOOGLE_AUTH_FAILED]: {
    userMessage:
      "Google Maps API key is invalid or expired. Please update your API key in Settings.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Update API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.GOOGLE_QUOTA_EXHAUSTED]: {
    userMessage:
      "Google Maps API daily quota has been reached. The quota resets at midnight Pacific time.",
    suggestedAction: "wait_retry",
    severity: "error",
    actionLabel: "View Usage",
    actionUrl: "/settings/usage",
    retryable: false,
  },
  [API_ERROR_CODES.GOOGLE_RATE_LIMITED]: {
    userMessage: "Google Maps API is temporarily rate limited. Retrying automatically...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },
  [API_ERROR_CODES.GOOGLE_INVALID_REQUEST]: {
    userMessage: "Invalid search parameters. Please check your search location and criteria.",
    suggestedAction: "fix_input",
    severity: "warning",
    actionLabel: "Edit Search",
    retryable: false,
  },
  [API_ERROR_CODES.GOOGLE_REQUEST_DENIED]: {
    userMessage:
      "Google Maps API request was denied. Your API key may not have the required permissions.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Check API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.GOOGLE_ZERO_RESULTS]: {
    userMessage: "No businesses found matching your search criteria. Try expanding your search area.",
    suggestedAction: "fix_input",
    severity: "info",
    actionLabel: "Modify Search",
    retryable: false,
  },
  [API_ERROR_CODES.GOOGLE_SERVER_ERROR]: {
    userMessage: "Google Maps service is temporarily unavailable. Retrying...",
    suggestedAction: "wait_retry",
    severity: "warning",
    retryable: true,
  },

  // ============================================
  // FindyMail Errors
  // ============================================
  [API_ERROR_CODES.FINDYMAIL_AUTH_FAILED]: {
    userMessage:
      "FindyMail API key is invalid or expired. Please update your API key in Settings.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Update API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.FINDYMAIL_CREDITS_EXHAUSTED]: {
    userMessage:
      "Your FindyMail account is out of credits. Please add credits to continue email enrichment.",
    suggestedAction: "add_credits",
    severity: "error",
    actionLabel: "Add FindyMail Credits",
    actionUrl: "https://app.findymail.com/dashboard/billing",
    retryable: false,
  },
  [API_ERROR_CODES.FINDYMAIL_RATE_LIMITED]: {
    userMessage: "FindyMail API is temporarily rate limited. Retrying automatically...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },
  [API_ERROR_CODES.FINDYMAIL_SERVER_ERROR]: {
    userMessage: "FindyMail service is temporarily unavailable. Retrying...",
    suggestedAction: "wait_retry",
    severity: "warning",
    retryable: true,
  },
  [API_ERROR_CODES.FINDYMAIL_INVALID_REQUEST]: {
    userMessage: "Invalid request to FindyMail. Please check your input data.",
    suggestedAction: "fix_input",
    severity: "warning",
    retryable: false,
  },

  // ============================================
  // Perplexity Errors
  // ============================================
  [API_ERROR_CODES.PERPLEXITY_AUTH_FAILED]: {
    userMessage:
      "Perplexity API key is invalid or expired. Please update your API key in Settings.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Update API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.PERPLEXITY_CREDITS_EXHAUSTED]: {
    userMessage:
      "Your Perplexity account has reached its billing limit. Business intelligence research may be limited.",
    suggestedAction: "add_credits",
    severity: "error",
    actionLabel: "Check Perplexity Billing",
    actionUrl: "https://www.perplexity.ai/settings/billing",
    retryable: false,
  },
  [API_ERROR_CODES.PERPLEXITY_RATE_LIMITED]: {
    userMessage: "Perplexity API is temporarily rate limited. Retrying automatically...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },
  [API_ERROR_CODES.PERPLEXITY_RATE_EXCEEDED]: {
    userMessage:
      "Perplexity API rate limit exceeded. Research quality may be temporarily reduced.",
    suggestedAction: "upgrade_plan",
    severity: "warning",
    actionLabel: "Upgrade Perplexity Plan",
    actionUrl: "https://www.perplexity.ai/settings/billing",
    retryable: false,
  },
  [API_ERROR_CODES.PERPLEXITY_SERVER_ERROR]: {
    userMessage: "Perplexity service is temporarily unavailable. Retrying...",
    suggestedAction: "wait_retry",
    severity: "warning",
    retryable: true,
  },
  [API_ERROR_CODES.PERPLEXITY_TIMEOUT]: {
    userMessage: "Perplexity research timed out. Retrying with extended timeout...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },

  // ============================================
  // Tavily Errors
  // ============================================
  [API_ERROR_CODES.TAVILY_AUTH_FAILED]: {
    userMessage: "Tavily API key is invalid or expired. Please update your API key in Settings.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Update API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.TAVILY_CREDITS_EXHAUSTED]: {
    userMessage: "Your Tavily account has reached its usage limit.",
    suggestedAction: "add_credits",
    severity: "warning",
    actionLabel: "Check Tavily Billing",
    actionUrl: "https://app.tavily.com/billing",
    retryable: false,
  },
  [API_ERROR_CODES.TAVILY_RATE_LIMITED]: {
    userMessage: "Tavily API is temporarily rate limited. Retrying automatically...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },
  [API_ERROR_CODES.TAVILY_SERVER_ERROR]: {
    userMessage: "Tavily service is temporarily unavailable. Retrying...",
    suggestedAction: "wait_retry",
    severity: "warning",
    retryable: true,
  },

  // ============================================
  // OpenAI Errors
  // ============================================
  [API_ERROR_CODES.OPENAI_AUTH_FAILED]: {
    userMessage: "OpenAI API key is invalid or expired. Please update your API key in Settings.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Update API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED]: {
    userMessage:
      "Your OpenAI account has reached its billing limit. Email generation may be affected.",
    suggestedAction: "add_credits",
    severity: "error",
    actionLabel: "Check OpenAI Billing",
    actionUrl: "https://platform.openai.com/account/billing",
    retryable: false,
  },
  [API_ERROR_CODES.OPENAI_RATE_LIMITED]: {
    userMessage: "OpenAI API is temporarily rate limited. Retrying automatically...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },
  [API_ERROR_CODES.OPENAI_SERVER_ERROR]: {
    userMessage: "OpenAI service is temporarily unavailable. Retrying...",
    suggestedAction: "wait_retry",
    severity: "warning",
    retryable: true,
  },
  [API_ERROR_CODES.OPENAI_CONTEXT_LENGTH]: {
    userMessage: "The request exceeded OpenAI's context limit. Reducing request size...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },

  // ============================================
  // FastSpring (Billing) Errors
  // ============================================
  [API_ERROR_CODES.FASTSPRING_AUTH_FAILED]: {
    userMessage: "Payment service authentication failed. Please try again or contact support.",
    suggestedAction: "contact_support",
    severity: "error",
    actionLabel: "Contact Support",
    actionUrl: "/support",
    retryable: false,
  },
  [API_ERROR_CODES.FASTSPRING_PAYMENT_FAILED]: {
    userMessage:
      "Payment could not be processed. Please check your payment method and try again.",
    suggestedAction: "manual_retry",
    severity: "error",
    actionLabel: "Update Payment Method",
    actionUrl: "/settings/billing",
    retryable: false,
  },
  [API_ERROR_CODES.FASTSPRING_ORDER_NOT_FOUND]: {
    userMessage: "Order not found. Please contact support if this issue persists.",
    suggestedAction: "contact_support",
    severity: "warning",
    actionLabel: "Contact Support",
    actionUrl: "/support",
    retryable: false,
  },
  [API_ERROR_CODES.FASTSPRING_SERVER_ERROR]: {
    userMessage: "Payment service is temporarily unavailable. Please try again in a moment.",
    suggestedAction: "manual_retry",
    severity: "warning",
    actionLabel: "Retry",
    retryable: true,
  },

  // ============================================
  // Instantly Errors
  // ============================================
  [API_ERROR_CODES.INSTANTLY_AUTH_FAILED]: {
    userMessage:
      "Instantly API key is invalid or expired. Please update your API key in Settings.",
    suggestedAction: "check_api_key",
    severity: "error",
    actionLabel: "Update API Key",
    actionUrl: "/settings/api-keys",
    retryable: false,
  },
  [API_ERROR_CODES.INSTANTLY_RATE_LIMITED]: {
    userMessage: "Instantly API is temporarily rate limited. Retrying automatically...",
    suggestedAction: "wait_retry",
    severity: "info",
    retryable: true,
  },
  [API_ERROR_CODES.INSTANTLY_SERVER_ERROR]: {
    userMessage: "Instantly service is temporarily unavailable. Retrying...",
    suggestedAction: "wait_retry",
    severity: "warning",
    retryable: true,
  },

  // ============================================
  // Generic/Common Errors
  // ============================================
  [API_ERROR_CODES.NETWORK_ERROR]: {
    userMessage: "Network connection error. Please check your internet connection and try again.",
    suggestedAction: "check_connection",
    severity: "warning",
    actionLabel: "Retry",
    retryable: true,
  },
  [API_ERROR_CODES.TIMEOUT_ERROR]: {
    userMessage:
      "Request timed out. The service may be experiencing high load. Please try again.",
    suggestedAction: "manual_retry",
    severity: "warning",
    actionLabel: "Retry",
    retryable: true,
  },
  [API_ERROR_CODES.VALIDATION_ERROR]: {
    userMessage: "Invalid input. Please check your data and try again.",
    suggestedAction: "fix_input",
    severity: "warning",
    actionLabel: "Fix Input",
    retryable: false,
  },
  [API_ERROR_CODES.UNKNOWN_ERROR]: {
    userMessage:
      "An unexpected error occurred. Please try again or contact support if the issue persists.",
    suggestedAction: "contact_support",
    severity: "error",
    actionLabel: "Contact Support",
    actionUrl: "/support",
    retryable: false,
  },
};

/**
 * Get the error message template for an error code
 */
export function getErrorMessage(errorCode: ApiErrorCode): ErrorMessageTemplate {
  return ERROR_MESSAGES[errorCode] || ERROR_MESSAGES[API_ERROR_CODES.UNKNOWN_ERROR];
}

/**
 * Get a user-friendly provider name for display
 */
export function getProviderDisplayName(provider: string): string {
  const displayNames: Record<string, string> = {
    google_maps: "Google Maps",
    google_places: "Google Places",
    findymail: "FindyMail",
    perplexity: "Perplexity",
    tavily: "Tavily",
    openai: "OpenAI",
    fastspring: "Payment Service",
    instantly: "Instantly",
    internal: "System",
  };
  return displayNames[provider] || provider;
}
