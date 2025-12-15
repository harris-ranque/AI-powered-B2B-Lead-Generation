"""
API Error Classification Module for LangGraph Worker

Provides standardized API error classification that matches the TypeScript
types in @genni/shared-types for consistent error handling across the platform.
"""

from dataclasses import dataclass, asdict
from enum import Enum
from typing import Optional, Dict, Any
import time


class ApiProvider(str, Enum):
    """API provider identifiers matching TypeScript ApiProvider type"""
    GOOGLE_PLACES = "google_places"
    FINDYMAIL = "findymail"
    PERPLEXITY = "perplexity"
    TAVILY = "tavily"
    OPENAI = "openai"
    FASTSPRING = "fastspring"
    UNKNOWN = "unknown"


class ApiErrorCategory(str, Enum):
    """Error categories matching TypeScript ApiErrorCategory type"""
    AUTHENTICATION = "authentication"
    AUTHORIZATION = "authorization"
    QUOTA_EXHAUSTED = "quota_exhausted"
    RATE_LIMITED = "rate_limited"
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    INVALID_REQUEST = "invalid_request"
    NOT_FOUND = "not_found"
    SERVER_ERROR = "server_error"
    TIMEOUT = "timeout"
    NETWORK_ERROR = "network_error"
    UNKNOWN = "unknown"


class ErrorSeverity(str, Enum):
    """Error severity levels matching TypeScript ErrorSeverity type"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class ErrorAction(str, Enum):
    """Suggested actions matching TypeScript ErrorAction type"""
    RETRY = "retry"
    WAIT = "wait"
    CHECK_API_KEY = "check_api_key"
    ADD_CREDITS = "add_credits"
    UPGRADE_PLAN = "upgrade_plan"
    CHECK_BILLING = "check_billing"
    CONTACT_SUPPORT = "contact_support"
    NONE = "none"


@dataclass
class StandardizedApiError:
    """
    Standardized API error matching TypeScript ApiError interface.
    Used for consistent error handling across Python and TypeScript codebases.
    """
    error_code: str
    provider: ApiProvider
    category: ApiErrorCategory
    user_message: str
    severity: ErrorSeverity
    retryable: bool
    suggested_action: ErrorAction
    technical_message: Optional[str] = None
    action_label: Optional[str] = None
    action_url: Optional[str] = None
    retry_after_ms: Optional[int] = None
    original_status: Optional[int] = None
    original_message: Optional[str] = None
    timestamp: Optional[int] = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = int(time.time() * 1000)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization and API responses"""
        result = {
            "errorCode": self.error_code,
            "provider": self.provider.value if isinstance(self.provider, ApiProvider) else self.provider,
            "category": self.category.value if isinstance(self.category, ApiErrorCategory) else self.category,
            "userMessage": self.user_message,
            "severity": self.severity.value if isinstance(self.severity, ErrorSeverity) else self.severity,
            "retryable": self.retryable,
            "suggestedAction": self.suggested_action.value if isinstance(self.suggested_action, ErrorAction) else self.suggested_action,
            "timestamp": self.timestamp,
        }

        if self.technical_message:
            result["technicalMessage"] = self.technical_message
        if self.action_label:
            result["actionLabel"] = self.action_label
        if self.action_url:
            result["actionUrl"] = self.action_url
        if self.retry_after_ms:
            result["retryAfterMs"] = self.retry_after_ms
        if self.original_status:
            result["originalStatus"] = self.original_status
        if self.original_message:
            result["originalMessage"] = self.original_message

        return result


# ============================================
# API Error Codes (matching TypeScript)
# ============================================

class API_ERROR_CODES:
    """API error codes matching TypeScript API_ERROR_CODES"""
    # Google Places
    GOOGLE_QUOTA_EXHAUSTED = "GOOGLE_QUOTA_EXHAUSTED"
    GOOGLE_AUTH_FAILED = "GOOGLE_AUTH_FAILED"
    GOOGLE_REQUEST_DENIED = "GOOGLE_REQUEST_DENIED"
    GOOGLE_INVALID_REQUEST = "GOOGLE_INVALID_REQUEST"
    GOOGLE_ZERO_RESULTS = "GOOGLE_ZERO_RESULTS"
    GOOGLE_SERVER_ERROR = "GOOGLE_SERVER_ERROR"

    # FindyMail
    FINDYMAIL_AUTH_FAILED = "FINDYMAIL_AUTH_FAILED"
    FINDYMAIL_CREDITS_EXHAUSTED = "FINDYMAIL_CREDITS_EXHAUSTED"
    FINDYMAIL_RATE_LIMITED = "FINDYMAIL_RATE_LIMITED"
    FINDYMAIL_INVALID_REQUEST = "FINDYMAIL_INVALID_REQUEST"
    FINDYMAIL_SERVER_ERROR = "FINDYMAIL_SERVER_ERROR"

    # Perplexity
    PERPLEXITY_AUTH_FAILED = "PERPLEXITY_AUTH_FAILED"
    PERPLEXITY_CREDITS_EXHAUSTED = "PERPLEXITY_CREDITS_EXHAUSTED"
    PERPLEXITY_RATE_LIMITED = "PERPLEXITY_RATE_LIMITED"
    PERPLEXITY_RATE_EXCEEDED = "PERPLEXITY_RATE_EXCEEDED"
    PERPLEXITY_TIMEOUT = "PERPLEXITY_TIMEOUT"
    PERPLEXITY_SERVER_ERROR = "PERPLEXITY_SERVER_ERROR"

    # OpenAI
    OPENAI_AUTH_FAILED = "OPENAI_AUTH_FAILED"
    OPENAI_QUOTA_EXHAUSTED = "OPENAI_QUOTA_EXHAUSTED"
    OPENAI_RATE_LIMITED = "OPENAI_RATE_LIMITED"
    OPENAI_CONTEXT_LENGTH = "OPENAI_CONTEXT_LENGTH"
    OPENAI_SERVER_ERROR = "OPENAI_SERVER_ERROR"

    # Tavily
    TAVILY_AUTH_FAILED = "TAVILY_AUTH_FAILED"
    TAVILY_CREDITS_EXHAUSTED = "TAVILY_CREDITS_EXHAUSTED"
    TAVILY_RATE_LIMITED = "TAVILY_RATE_LIMITED"
    TAVILY_SERVER_ERROR = "TAVILY_SERVER_ERROR"

    # Generic
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
    NETWORK_ERROR = "NETWORK_ERROR"
    TIMEOUT_ERROR = "TIMEOUT_ERROR"


# ============================================
# Error Messages (matching TypeScript)
# ============================================

ERROR_MESSAGES: Dict[str, Dict[str, Any]] = {
    # Perplexity
    API_ERROR_CODES.PERPLEXITY_AUTH_FAILED: {
        "user_message": "Perplexity API key is invalid or expired. Please update your API key in Settings.",
        "severity": ErrorSeverity.ERROR,
        "retryable": False,
        "suggested_action": ErrorAction.CHECK_API_KEY,
        "action_label": "Update API Key",
        "action_url": "/settings/api-keys",
    },
    API_ERROR_CODES.PERPLEXITY_CREDITS_EXHAUSTED: {
        "user_message": "Perplexity billing limit reached. Please check your Perplexity account.",
        "severity": ErrorSeverity.ERROR,
        "retryable": False,
        "suggested_action": ErrorAction.CHECK_BILLING,
        "action_label": "Check Billing",
        "action_url": "https://www.perplexity.ai/settings/api",
    },
    API_ERROR_CODES.PERPLEXITY_RATE_LIMITED: {
        "user_message": "Perplexity is temporarily rate limited. Retrying automatically...",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.WAIT,
    },
    API_ERROR_CODES.PERPLEXITY_RATE_EXCEEDED: {
        "user_message": "Perplexity rate limit exceeded. Research quality may be reduced.",
        "severity": ErrorSeverity.WARNING,
        "retryable": False,
        "suggested_action": ErrorAction.UPGRADE_PLAN,
        "action_label": "Upgrade Plan",
    },
    API_ERROR_CODES.PERPLEXITY_TIMEOUT: {
        "user_message": "Perplexity request timed out. Retrying...",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.RETRY,
    },
    API_ERROR_CODES.PERPLEXITY_SERVER_ERROR: {
        "user_message": "Perplexity service is temporarily unavailable. Retrying...",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.RETRY,
    },

    # OpenAI
    API_ERROR_CODES.OPENAI_AUTH_FAILED: {
        "user_message": "OpenAI API key is invalid or expired. Please update your API key in Settings.",
        "severity": ErrorSeverity.ERROR,
        "retryable": False,
        "suggested_action": ErrorAction.CHECK_API_KEY,
        "action_label": "Update API Key",
        "action_url": "/settings/api-keys",
    },
    API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED: {
        "user_message": "OpenAI billing limit reached. Please check your OpenAI account billing.",
        "severity": ErrorSeverity.ERROR,
        "retryable": False,
        "suggested_action": ErrorAction.CHECK_BILLING,
        "action_label": "Check Billing",
        "action_url": "https://platform.openai.com/account/billing",
    },
    API_ERROR_CODES.OPENAI_RATE_LIMITED: {
        "user_message": "OpenAI is temporarily rate limited. Retrying automatically...",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.WAIT,
    },
    API_ERROR_CODES.OPENAI_CONTEXT_LENGTH: {
        "user_message": "Request too large for OpenAI model. Reducing input size...",
        "severity": ErrorSeverity.WARNING,
        "retryable": False,
        "suggested_action": ErrorAction.NONE,
    },
    API_ERROR_CODES.OPENAI_SERVER_ERROR: {
        "user_message": "OpenAI service is temporarily unavailable. Retrying...",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.RETRY,
    },

    # Generic
    API_ERROR_CODES.UNKNOWN_ERROR: {
        "user_message": "An unexpected error occurred. Please try again.",
        "severity": ErrorSeverity.ERROR,
        "retryable": True,
        "suggested_action": ErrorAction.RETRY,
    },
    API_ERROR_CODES.NETWORK_ERROR: {
        "user_message": "Network connection error. Please check your internet connection.",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.RETRY,
    },
    API_ERROR_CODES.TIMEOUT_ERROR: {
        "user_message": "Request timed out. Retrying...",
        "severity": ErrorSeverity.WARNING,
        "retryable": True,
        "suggested_action": ErrorAction.RETRY,
    },
}


def get_error_message(error_code: str) -> Dict[str, Any]:
    """Get error message configuration for an error code"""
    return ERROR_MESSAGES.get(error_code, ERROR_MESSAGES[API_ERROR_CODES.UNKNOWN_ERROR])


# ============================================
# Perplexity Error Classification
# ============================================

def classify_perplexity_error(
    http_status: int,
    error_message: str = "",
    retry_after: Optional[int] = None
) -> StandardizedApiError:
    """
    Classify Perplexity API errors into standardized format.

    Args:
        http_status: HTTP status code from Perplexity API
        error_message: Error message from response
        retry_after: Optional Retry-After header value in seconds

    Returns:
        StandardizedApiError with appropriate classification
    """
    base = {
        "provider": ApiProvider.PERPLEXITY,
        "original_status": http_status,
        "original_message": error_message,
    }

    if http_status == 401:
        msg = get_error_message(API_ERROR_CODES.PERPLEXITY_AUTH_FAILED)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.PERPLEXITY_AUTH_FAILED,
            category=ApiErrorCategory.AUTHENTICATION,
            **base,
            **msg
        )

    if http_status == 402:
        msg = get_error_message(API_ERROR_CODES.PERPLEXITY_CREDITS_EXHAUSTED)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.PERPLEXITY_CREDITS_EXHAUSTED,
            category=ApiErrorCategory.QUOTA_EXHAUSTED,
            **base,
            **msg
        )

    if http_status == 429:
        # Check if it's quota vs transient rate limiting
        error_lower = error_message.lower()
        is_quota_exceeded = any(term in error_lower for term in ["quota", "billing", "limit exceeded"])

        if is_quota_exceeded:
            msg = get_error_message(API_ERROR_CODES.PERPLEXITY_RATE_EXCEEDED)
            return StandardizedApiError(
                error_code=API_ERROR_CODES.PERPLEXITY_RATE_EXCEEDED,
                category=ApiErrorCategory.RATE_LIMIT_EXCEEDED,
                **base,
                **msg
            )

        msg = get_error_message(API_ERROR_CODES.PERPLEXITY_RATE_LIMITED)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.PERPLEXITY_RATE_LIMITED,
            category=ApiErrorCategory.RATE_LIMITED,
            retry_after_ms=retry_after * 1000 if retry_after else 5000,
            **base,
            **msg
        )

    if http_status == 408:
        msg = get_error_message(API_ERROR_CODES.PERPLEXITY_TIMEOUT)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.PERPLEXITY_TIMEOUT,
            category=ApiErrorCategory.TIMEOUT,
            retry_after_ms=2000,
            **base,
            **msg
        )

    if http_status >= 500:
        msg = get_error_message(API_ERROR_CODES.PERPLEXITY_SERVER_ERROR)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.PERPLEXITY_SERVER_ERROR,
            category=ApiErrorCategory.SERVER_ERROR,
            retry_after_ms=5000,
            **base,
            **msg
        )

    # Unknown error
    msg = get_error_message(API_ERROR_CODES.UNKNOWN_ERROR)
    return StandardizedApiError(
        error_code=API_ERROR_CODES.UNKNOWN_ERROR,
        category=ApiErrorCategory.SERVER_ERROR if http_status >= 500 else ApiErrorCategory.UNKNOWN,
        technical_message=error_message,
        **base,
        **msg
    )


# ============================================
# OpenAI Error Classification
# ============================================

def classify_openai_error(
    http_status: int,
    error_message: str = "",
    error_type: Optional[str] = None
) -> StandardizedApiError:
    """
    Classify OpenAI API errors into standardized format.

    Args:
        http_status: HTTP status code from OpenAI API
        error_message: Error message from response
        error_type: OpenAI error type (e.g., "insufficient_quota")

    Returns:
        StandardizedApiError with appropriate classification
    """
    base = {
        "provider": ApiProvider.OPENAI,
        "original_status": http_status,
        "original_message": error_message,
    }

    error_lower = error_message.lower()

    # Check for quota/billing issues
    if error_type == "insufficient_quota" or "quota" in error_lower or "billing" in error_lower:
        msg = get_error_message(API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.OPENAI_QUOTA_EXHAUSTED,
            category=ApiErrorCategory.QUOTA_EXHAUSTED,
            **base,
            **msg
        )

    # Context length exceeded
    if "context length" in error_lower:
        msg = get_error_message(API_ERROR_CODES.OPENAI_CONTEXT_LENGTH)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.OPENAI_CONTEXT_LENGTH,
            category=ApiErrorCategory.INVALID_REQUEST,
            **base,
            **msg
        )

    if http_status == 401:
        msg = get_error_message(API_ERROR_CODES.OPENAI_AUTH_FAILED)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.OPENAI_AUTH_FAILED,
            category=ApiErrorCategory.AUTHENTICATION,
            **base,
            **msg
        )

    if http_status == 429:
        msg = get_error_message(API_ERROR_CODES.OPENAI_RATE_LIMITED)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.OPENAI_RATE_LIMITED,
            category=ApiErrorCategory.RATE_LIMITED,
            retry_after_ms=10000,  # OpenAI rate limits can be longer
            **base,
            **msg
        )

    if http_status >= 500:
        msg = get_error_message(API_ERROR_CODES.OPENAI_SERVER_ERROR)
        return StandardizedApiError(
            error_code=API_ERROR_CODES.OPENAI_SERVER_ERROR,
            category=ApiErrorCategory.SERVER_ERROR,
            retry_after_ms=5000,
            **base,
            **msg
        )

    # Unknown error
    msg = get_error_message(API_ERROR_CODES.UNKNOWN_ERROR)
    return StandardizedApiError(
        error_code=API_ERROR_CODES.UNKNOWN_ERROR,
        category=ApiErrorCategory.SERVER_ERROR if http_status >= 500 else ApiErrorCategory.UNKNOWN,
        technical_message=error_message,
        **base,
        **msg
    )


# ============================================
# Helper Functions
# ============================================

def should_block_pipeline(api_error: StandardizedApiError) -> bool:
    """
    Check if an API error should block the pipeline.
    Matches the TypeScript shouldBlockPipeline function.

    User-actionable errors like auth failed or credits exhausted
    should stop the pipeline immediately with a clear message.
    """
    blocking_categories = [
        ApiErrorCategory.AUTHENTICATION,
        ApiErrorCategory.AUTHORIZATION,
        ApiErrorCategory.QUOTA_EXHAUSTED,
        ApiErrorCategory.RATE_LIMIT_EXCEEDED,
    ]
    return api_error.category in blocking_categories


def is_user_actionable_error(api_error: StandardizedApiError) -> bool:
    """
    Check if an error requires user action (not just wait/retry).
    Matches the TypeScript isUserActionableApiError function.
    """
    actionable_categories = [
        ApiErrorCategory.AUTHENTICATION,
        ApiErrorCategory.AUTHORIZATION,
        ApiErrorCategory.QUOTA_EXHAUSTED,
        ApiErrorCategory.RATE_LIMIT_EXCEEDED,
    ]
    return api_error.category in actionable_categories


class ApiErrorException(Exception):
    """
    Exception wrapper for StandardizedApiError.
    Use this to throw errors that should be surfaced to users.
    """
    def __init__(self, api_error: StandardizedApiError):
        self.api_error = api_error
        super().__init__(api_error.user_message)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses"""
        return self.api_error.to_dict()
