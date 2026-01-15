"""
Unified Rate Limit Manager.

Provides a single interface for rate-limited API requests, combining:
- Adaptive rate limiting (learns from 429s)
- Request queuing (prevents thundering herd)
- Per-API-key isolation (BYOK support)
- Circuit breaker protection

Usage:
    from app.utils.rate_limiting import rate_limited_request, Provider

    # Simple usage
    result = await rate_limited_request(
        Provider.OPENAI,
        lambda: llm.ainvoke(messages),
        model="gpt-4o"
    )

    # With BYOK and priority
    result = await rate_limited_request(
        Provider.PERPLEXITY,
        lambda: perplexity_client.research(query),
        model="sonar-pro",
        api_key=user_api_key,
        priority=1,
        correlation_id=request_id
    )
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional, TypeVar

from .types import Provider, ProviderConfig, RequestContext
from .adaptive import AdaptiveRateLimiter, CircuitBreakerOpenError
from .request_queue import RequestQueueManager, QueueFullError
from .config import get_rate_limit_config

# Import logger and analytics from parent utils
try:
    from ..logger import setup_logger
    from ..analytics import capture_event
except ImportError:
    # Fallback for testing
    import logging
    def setup_logger(name):
        return logging.getLogger(name)
    def capture_event(event_name, properties):
        pass

logger = setup_logger(__name__)

T = TypeVar('T')


@dataclass
class RateLimitManager:
    """
    Unified rate limit manager for all API providers.

    Combines adaptive rate limiting with request queuing to provide
    robust protection against 429 errors and thundering herd.

    Features:
    - Per-provider rate limiting with adaptive learning
    - Request queue to serialize/control concurrency
    - BYOK support with per-key isolation
    - Circuit breaker for repeated failures
    - Comprehensive metrics and observability

    Usage:
        manager = RateLimitManager()
        await manager.initialize()

        result = await manager.execute(
            Provider.PERPLEXITY,
            lambda: api_call(),
            model="sonar-pro",
            api_key=user_key
        )
    """

    _rate_limiters: Dict[Provider, AdaptiveRateLimiter] = field(default_factory=dict)
    _queue_manager: RequestQueueManager = field(default_factory=RequestQueueManager)
    _initialized: bool = field(default=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def initialize(self) -> None:
        """
        Initialize the rate limit manager.

        Creates rate limiters and queues for all configured providers.
        """
        if self._initialized:
            return

        async with self._lock:
            if self._initialized:
                return

            config = get_rate_limit_config()

            # Create rate limiters for each provider
            for provider in Provider:
                provider_config = config.get_provider_config(provider)
                self._rate_limiters[provider] = AdaptiveRateLimiter(
                    provider=provider,
                    config=provider_config
                )

            self._initialized = True
            logger.info(
                f"[RateLimitManager] Initialized with config: {config.to_dict()}"
            )

    async def shutdown(self) -> None:
        """Shutdown the manager gracefully."""
        await self._queue_manager.shutdown()
        self._initialized = False
        logger.info("[RateLimitManager] Shutdown complete")

    def get_rate_limiter(self, provider: Provider) -> AdaptiveRateLimiter:
        """Get the rate limiter for a provider."""
        if not self._initialized:
            raise RuntimeError("RateLimitManager not initialized. Call initialize() first.")
        return self._rate_limiters[provider]

    async def execute(
        self,
        provider: Provider,
        func: Callable[[], Awaitable[T]],
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        priority: int = 0,
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
        on_429: Optional[Callable[[int], Awaitable[None]]] = None
    ) -> T:
        """
        Execute a rate-limited request.

        This method:
        1. Acquires rate limit permission (may wait)
        2. Submits to request queue (serializes requests)
        3. Executes the function
        4. Records success or handles 429 errors

        Args:
            provider: API provider to use
            func: Async function to execute
            model: Model name for model-specific limits
            api_key: User's BYOK API key (None for system key)
            priority: Request priority (higher = more important)
            timeout: Maximum total wait time
            correlation_id: For tracing and debugging
            on_429: Optional callback when 429 is detected

        Returns:
            Result of the function execution

        Raises:
            CircuitBreakerOpenError: If circuit breaker is open
            QueueFullError: If request queue is at capacity
            asyncio.TimeoutError: If timeout exceeded
        """
        if not self._initialized:
            await self.initialize()

        config = get_rate_limit_config()
        if not config.enabled:
            # Rate limiting disabled, execute directly
            return await func()

        rate_limiter = self._rate_limiters[provider]
        context = RequestContext(
            provider=provider,
            api_key=api_key,
            model=model,
            priority=priority,
            correlation_id=correlation_id
        )

        # Wrap the function with rate limiting
        async def rate_limited_func() -> T:
            # Acquire rate limit permission
            wait_time = await rate_limiter.acquire(
                api_key=api_key,
                model=model,
                timeout=timeout
            )

            if wait_time > 0:
                logger.debug(
                    f"[RateLimitManager] Waited {wait_time:.2f}s for {provider.value} "
                    f"(correlation_id={correlation_id})"
                )

            try:
                # Execute the function
                result = await func()

                # Record success
                await rate_limiter.record_success(api_key=api_key, model=model)

                return result

            except Exception as e:
                # Check for 429 error
                if self._is_rate_limit_error(e):
                    retry_after = self._extract_retry_after(e)

                    await rate_limiter.record_429(
                        api_key=api_key,
                        model=model,
                        retry_after=retry_after
                    )

                    if on_429:
                        await on_429(retry_after or 60)

                    capture_event(
                        "rate_limit_hit",
                        {
                            "provider": provider.value,
                            "model": model,
                            "retry_after": retry_after,
                            "correlation_id": correlation_id,
                        }
                    )

                raise

        # Submit to queue if queue is enabled
        if config.queue_enabled:
            return await self._queue_manager.submit(
                provider=provider,
                func=rate_limited_func,
                context=context,
                priority=priority,
                timeout=timeout
            )
        else:
            return await rate_limited_func()

    def _is_rate_limit_error(self, error: Exception) -> bool:
        """Check if an error is a rate limit (429) error."""
        error_str = str(error).lower()

        # Check for common rate limit indicators
        if "429" in error_str:
            return True
        if "rate limit" in error_str:
            return True
        if "too many requests" in error_str:
            return True
        if "quota exceeded" in error_str:
            return True

        # Check for specific API error types
        error_type = type(error).__name__.lower()
        if "ratelimit" in error_type:
            return True

        return False

    def _extract_retry_after(self, error: Exception) -> Optional[int]:
        """Extract retry-after value from error if available."""
        # Check for retry_after attribute
        if hasattr(error, 'retry_after'):
            return int(error.retry_after)

        # Check for response headers
        if hasattr(error, 'response') and hasattr(error.response, 'headers'):
            headers = error.response.headers
            if 'retry-after' in headers:
                try:
                    return int(headers['retry-after'])
                except (ValueError, TypeError):
                    pass
            if 'x-ratelimit-reset' in headers:
                try:
                    import time
                    reset_time = int(headers['x-ratelimit-reset'])
                    return max(0, reset_time - int(time.time()))
                except (ValueError, TypeError):
                    pass

        # Parse from error message
        error_str = str(error)
        import re
        patterns = [
            r'retry.?after[:\s]+(\d+)',
            r'wait[:\s]+(\d+)\s*seconds?',
            r'(\d+)\s*seconds?\s*(?:before|until|to)',
        ]
        for pattern in patterns:
            match = re.search(pattern, error_str, re.IGNORECASE)
            if match:
                return int(match.group(1))

        return None

    def get_stats(self, provider: Optional[Provider] = None) -> Dict:
        """
        Get rate limiting statistics.

        Args:
            provider: If specified, return stats for only this provider.
                     If None, return stats for all providers.

        Returns:
            Dictionary of statistics
        """
        stats = {}

        if provider:
            if provider in self._rate_limiters:
                stats[provider.value] = {
                    "rate_limiter": self._rate_limiters[provider].get_stats(),
                }
        else:
            for p, limiter in self._rate_limiters.items():
                stats[p.value] = {
                    "rate_limiter": limiter.get_stats(),
                }

        # Add queue stats
        stats["queues"] = self._queue_manager.get_all_stats()

        return stats


# Global singleton instance
_manager: Optional[RateLimitManager] = None


async def get_rate_limit_manager() -> RateLimitManager:
    """
    Get the global rate limit manager instance.

    Initializes on first access.
    """
    global _manager
    if _manager is None:
        _manager = RateLimitManager()
        await _manager.initialize()
    return _manager


async def rate_limited_request(
    provider: Provider,
    func: Callable[[], Awaitable[T]],
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    priority: int = 0,
    timeout: Optional[float] = None,
    correlation_id: Optional[str] = None,
    on_429: Optional[Callable[[int], Awaitable[None]]] = None
) -> T:
    """
    Convenience function for making rate-limited API requests.

    This is the primary interface for rate limiting in the application.

    Args:
        provider: API provider to use
        func: Async function to execute
        model: Model name for model-specific limits
        api_key: User's BYOK API key (None for system key)
        priority: Request priority (higher = more important)
        timeout: Maximum total wait time
        correlation_id: For tracing and debugging
        on_429: Optional callback when 429 is detected

    Returns:
        Result of the function execution

    Example:
        result = await rate_limited_request(
            Provider.OPENAI,
            lambda: llm.ainvoke(messages),
            model="gpt-4o",
            correlation_id=request_id
        )
    """
    manager = await get_rate_limit_manager()
    return await manager.execute(
        provider=provider,
        func=func,
        model=model,
        api_key=api_key,
        priority=priority,
        timeout=timeout,
        correlation_id=correlation_id,
        on_429=on_429
    )


async def shutdown_rate_limiting() -> None:
    """Shutdown the rate limiting system gracefully."""
    global _manager
    if _manager:
        await _manager.shutdown()
        _manager = None


def reset_rate_limiting() -> None:
    """Reset the rate limiting system (for testing)."""
    global _manager
    _manager = None


async def rate_limited_llm_call(
    llm_func: Callable[[], Awaitable[T]],
    model: str = "gpt-4o",
    api_key: Optional[str] = None,
    priority: int = 0,
    timeout: Optional[float] = None,
    correlation_id: Optional[str] = None,
) -> T:
    """
    Rate-limited wrapper for LangChain LLM calls (OpenAI).

    Use this to wrap any LangChain LLM invocation to apply rate limiting
    and prevent thundering herd issues with OpenAI API.

    Args:
        llm_func: Async function that makes the LLM call (e.g., lambda: llm.ainvoke(messages))
        model: OpenAI model name for model-specific limits
        api_key: User's BYOK API key (None for system key)
        priority: Request priority (higher = more important)
        timeout: Maximum total wait time
        correlation_id: For tracing and debugging

    Returns:
        Result of the LLM call

    Example:
        # Wrap a LangChain LLM call
        result = await rate_limited_llm_call(
            lambda: llm.ainvoke(messages),
            model="gpt-4o",
            correlation_id=f"agent:{lead_id}"
        )

        # Or with structured output
        result = await rate_limited_llm_call(
            lambda: llm.with_structured_output(Schema).ainvoke(messages),
            model="gpt-4o-mini"
        )
    """
    return await rate_limited_request(
        Provider.OPENAI,
        llm_func,
        model=model,
        api_key=api_key,
        priority=priority,
        timeout=timeout,
        correlation_id=correlation_id,
    )
