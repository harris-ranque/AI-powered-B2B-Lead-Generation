/**
 * API Error Handling Types
 *
 * Unified error types, codes, and messages for all API integrations.
 */

// Core types
export type {
  ApiProvider,
  ApiErrorCategory,
  ErrorAction,
  ErrorSeverity,
  ApiError,
  ApiErrorSummary,
  ApiErrorLogEntry,
} from "./types";

export { isApiError, extractApiError } from "./types";

// Error codes
export { API_ERROR_CODES, ERROR_CODES_BY_PROVIDER, isUserActionableError, isRetryableError } from "./codes";
export type { ApiErrorCode } from "./codes";

// Error messages
export { ERROR_MESSAGES, getErrorMessage, getProviderDisplayName } from "./messages";
export type { ErrorMessageTemplate } from "./messages";
