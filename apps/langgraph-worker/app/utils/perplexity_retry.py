"""
Perplexity API Retry Utilities with Exponential Backoff.

Provides retry logic for Perplexity API calls with:
- Exponential backoff with jitter
- Retry-After header parsing
- Error classification (retryable vs non-retryable)
- Comprehensive logging and analytics

Based on patterns from webhook.py and findymail.ts.
"""

import asyncio
import random
import re
from dataclasses import dataclass
from datetime import datetime
from functools import wraps
from typing import Any, Callable, Optional, TypeVar, Union

import aiohttp
import sentry_sdk

from .logger import setup_logger
from .analytics import capture_event

logger = setup_logger(__name__)

T = TypeVar("T")


class PerplexityAPIError(Exception):
    """Base exception for Perplexity API errors."""

    def __init__(
        self,
        status_code: int,
        message: str,
        retry_after: Optional[int] = None,
        is_retryable: bool = False,
    ):
        self.status_code = status_code
        self.message = message
        self.retry_after = retry_after
        self.is_retryable = is_retryable
        super().__init__(f"Perplexity API error {status_code}: {message}")


class RateLimitError(PerplexityAPIError):
    """Raised when Perplexity returns 429 Too Many Requests."""

    def __init__(self, message: str, retry_after: Optional[int] = None):
        super().__init__(
            status_code=429,
            message=message,
            retry_after=retry_after,
            is_retryable=True,
        )


class RateLimitExhaustedError(Exception):
    """Raised when all retries are exhausted due to rate limiting."""

    def __init__(self, message: str, total_attempts: int, total_wait_time: float):
        self.total_attempts = total_attempts
        self.total_wait_time = total_wait_time
        super().__init__(message)


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_retries: int = 4
    base_delay_ms: int = 2000  # 2 seconds
    max_delay_ms: int = 30000  # 30 seconds
    jitter_min: float = 0.8
    jitter_max: float = 1.2
    timeout_retry_once: bool = True  # Retry timeouts once with extended timeout

    def calculate_delay(self, attempt: int) -> float:
        """
        Calculate delay with exponential backoff and jitter.

        Args:
            attempt: Current attempt number (0-indexed)

        Returns:
            Delay in seconds
        """
        # Exponential backoff: base_delay * 2^attempt
        base_delay = self.base_delay_ms * (2 ** attempt)

        # Apply jitter to prevent thundering herd
        jitter = random.uniform(self.jitter_min, self.jitter_max)
        delay_ms = min(base_delay * jitter, self.max_delay_ms)

        return delay_ms / 1000  # Convert to seconds


# Default retry configuration
DEFAULT_RETRY_CONFIG = RetryConfig()


def parse_retry_after(header_value: Optional[str]) -> Optional[int]:
    """
    Parse Retry-After header value.

    Handles both formats:
    - Integer seconds: "60"
    - HTTP date: "Wed, 21 Oct 2025 07:28:00 GMT"

    Args:
        header_value: Value of Retry-After header

    Returns:
        Seconds to wait, or None if not parseable
    """
    if not header_value:
        return None

    # Try parsing as integer seconds
    try:
        return int(header_value)
    except ValueError:
        pass

    # Try parsing as HTTP date
    try:
        # Parse HTTP date format
        date_formats = [
            "%a, %d %b %Y %H:%M:%S GMT",
            "%A, %d-%b-%y %H:%M:%S GMT",
            "%a %b %d %H:%M:%S %Y",
        ]
        for fmt in date_formats:
            try:
                retry_time = datetime.strptime(header_value, fmt)
                delta = retry_time - datetime.utcnow()
                return max(0, int(delta.total_seconds()))
            except ValueError:
                continue
    except Exception:
        pass

    return None


def classify_error(status_code: int, error_body: str = "") -> tuple[bool, str]:
    """
    Classify HTTP error as retryable or not.

    Args:
        status_code: HTTP status code
        error_body: Response body text

    Returns:
        Tuple of (is_retryable, reason)
    """
    if status_code == 429:
        return True, "rate_limit"

    if status_code in (502, 503, 504):
        return True, "server_error"

    if status_code >= 500:
        return True, "server_error"

    if status_code == 408:
        return True, "timeout"

    # Check for specific retryable error messages
    error_lower = error_body.lower()
    if any(keyword in error_lower for keyword in ["timeout", "timed out", "connection"]):
        return True, "network_error"

    # Client errors are not retryable
    if 400 <= status_code < 500:
        return False, "client_error"

    return False, "unknown"


async def perplexity_request_with_retry(
    request_fn: Callable[[], T],
    config: Optional[RetryConfig] = None,
    operation_name: str = "perplexity_request",
) -> T:
    """
    Execute a Perplexity API request with exponential backoff retry.

    Args:
        request_fn: Async function that makes the API request
        config: Retry configuration (uses defaults if not provided)
        operation_name: Name for logging/analytics

    Returns:
        Result of the request function

    Raises:
        RateLimitExhaustedError: If all retries exhausted due to rate limiting
        PerplexityAPIError: If non-retryable error occurs
    """
    config = config or DEFAULT_RETRY_CONFIG
    total_wait_time = 0.0
    last_error: Optional[Exception] = None

    for attempt in range(config.max_retries + 1):
        try:
            result = await request_fn()

            # Log successful retry
            if attempt > 0:
                logger.info(
                    f"[Retry] {operation_name} succeeded on attempt {attempt + 1} "
                    f"after {total_wait_time:.2f}s total wait"
                )
                capture_event(
                    "perplexity_retry_success",
                    {
                        "operation": operation_name,
                        "attempt": attempt + 1,
                        "total_wait_time_ms": total_wait_time * 1000,
                    },
                )

            return result

        except RateLimitError as e:
            last_error = e

            # Use Retry-After header if available, otherwise calculate backoff
            if e.retry_after:
                delay = float(e.retry_after)
            else:
                delay = config.calculate_delay(attempt)

            # Check if we have retries left
            if attempt < config.max_retries:
                logger.warning(
                    f"[Retry] {operation_name} rate limited (attempt {attempt + 1}/{config.max_retries + 1}), "
                    f"waiting {delay:.2f}s before retry"
                )

                # Add Sentry breadcrumb
                sentry_sdk.add_breadcrumb(
                    category="rate_limit",
                    message=f"Perplexity rate limited: {operation_name}",
                    data={
                        "attempt": attempt + 1,
                        "delay": delay,
                        "retry_after": e.retry_after,
                    },
                    level="warning",
                )

                await asyncio.sleep(delay)
                total_wait_time += delay
            else:
                # All retries exhausted
                logger.error(
                    f"[Retry] {operation_name} rate limit exhausted after {attempt + 1} attempts, "
                    f"total wait: {total_wait_time:.2f}s"
                )
                capture_event(
                    "perplexity_rate_limit_exhausted",
                    {
                        "operation": operation_name,
                        "total_attempts": attempt + 1,
                        "total_wait_time_ms": total_wait_time * 1000,
                    },
                )
                raise RateLimitExhaustedError(
                    f"Rate limit exhausted for {operation_name} after {attempt + 1} attempts",
                    total_attempts=attempt + 1,
                    total_wait_time=total_wait_time,
                )

        except PerplexityAPIError as e:
            last_error = e

            if not e.is_retryable:
                logger.error(
                    f"[Retry] {operation_name} non-retryable error: {e.status_code} - {e.message}"
                )
                raise

            # Retryable server error
            if attempt < config.max_retries:
                delay = config.calculate_delay(attempt)
                logger.warning(
                    f"[Retry] {operation_name} server error {e.status_code} "
                    f"(attempt {attempt + 1}/{config.max_retries + 1}), waiting {delay:.2f}s"
                )
                await asyncio.sleep(delay)
                total_wait_time += delay
            else:
                raise

        except asyncio.TimeoutError as e:
            last_error = e

            # Retry timeout once
            if config.timeout_retry_once and attempt == 0:
                delay = config.calculate_delay(0)
                logger.warning(
                    f"[Retry] {operation_name} timeout, retrying once after {delay:.2f}s"
                )
                await asyncio.sleep(delay)
                total_wait_time += delay
            else:
                logger.error(f"[Retry] {operation_name} timeout on attempt {attempt + 1}")
                raise

        except aiohttp.ClientError as e:
            last_error = e

            # Network errors are retryable
            if attempt < config.max_retries:
                delay = config.calculate_delay(attempt)
                logger.warning(
                    f"[Retry] {operation_name} network error: {type(e).__name__} "
                    f"(attempt {attempt + 1}/{config.max_retries + 1}), waiting {delay:.2f}s"
                )
                await asyncio.sleep(delay)
                total_wait_time += delay
            else:
                raise

    # Should not reach here, but just in case
    if last_error:
        raise last_error
    raise RuntimeError(f"Unexpected retry loop exit for {operation_name}")


def with_retry(
    config: Optional[RetryConfig] = None,
    operation_name: Optional[str] = None,
) -> Callable:
    """
    Decorator for adding retry logic to async functions.

    Usage:
        @with_retry(config=RetryConfig(max_retries=3))
        async def my_api_call():
            ...

    Args:
        config: Retry configuration
        operation_name: Name for logging (defaults to function name)

    Returns:
        Decorated function with retry logic
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            name = operation_name or func.__name__

            async def request_fn() -> T:
                return await func(*args, **kwargs)

            return await perplexity_request_with_retry(
                request_fn,
                config=config,
                operation_name=name,
            )

        return wrapper

    return decorator


def extract_retry_after_from_response(response: aiohttp.ClientResponse) -> Optional[int]:
    """
    Extract Retry-After value from an aiohttp response.

    Args:
        response: aiohttp ClientResponse object

    Returns:
        Seconds to wait, or None if not available
    """
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        return parse_retry_after(retry_after)

    # Try to extract from X-RateLimit-Reset header (Unix timestamp)
    reset_time = response.headers.get("X-RateLimit-Reset")
    if reset_time:
        try:
            reset_ts = int(reset_time)
            now_ts = int(datetime.utcnow().timestamp())
            return max(0, reset_ts - now_ts)
        except (ValueError, TypeError):
            pass

    return None


async def handle_perplexity_response(
    response: aiohttp.ClientResponse,
    operation_name: str = "perplexity_request",
) -> dict:
    """
    Handle Perplexity API response, raising appropriate errors.

    Args:
        response: aiohttp ClientResponse object
        operation_name: Name for logging

    Returns:
        JSON response data

    Raises:
        RateLimitError: If rate limited (429)
        PerplexityAPIError: For other API errors
    """
    if response.status == 429:
        retry_after = extract_retry_after_from_response(response)
        error_text = await response.text()
        raise RateLimitError(
            message=error_text,
            retry_after=retry_after,
        )

    if response.status != 200:
        error_text = await response.text()
        is_retryable, reason = classify_error(response.status, error_text)
        raise PerplexityAPIError(
            status_code=response.status,
            message=error_text,
            is_retryable=is_retryable,
        )

    return await response.json()
