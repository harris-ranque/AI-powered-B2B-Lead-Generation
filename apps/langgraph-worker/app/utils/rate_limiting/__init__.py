"""
Adaptive Rate Limiting System for API Calls.

This module provides a unified rate limiting solution for all external API calls
(Perplexity, OpenAI, FindyMail) with the following features:

- Token Bucket Algorithm: Smooth rate limiting with controlled burst capacity
- Adaptive Learning: Learns actual API tier from 429 responses
- Request Queue: Serializes requests to prevent thundering herd
- BYOK Support: Per-API-key bucket isolation
- Circuit Breaker: Protects against cascading failures

Quick Start:
    from app.utils.rate_limiting import rate_limited_request, Provider

    # Simple usage
    result = await rate_limited_request(
        Provider.OPENAI,
        lambda: llm.ainvoke(messages),
        model="gpt-4o"
    )

    # With BYOK and tracking
    result = await rate_limited_request(
        Provider.PERPLEXITY,
        lambda: perplexity_client.research(query),
        model="sonar-pro",
        api_key=user_api_key,
        correlation_id=request_id,
        priority=1
    )

Configuration:
    Set environment variables to customize behavior:
    - RATE_LIMITING_ENABLED: Enable/disable rate limiting (default: true)
    - PERPLEXITY_DEFAULT_RPM: Starting RPM for Perplexity (default: 50)
    - OPENAI_DEFAULT_RPM: Starting RPM for OpenAI (default: 100)
    - See config.py for full list of configuration options
"""

# Core types
from .types import (
    Provider,
    ProviderConfig,
    RateLimitState,
    RateLimitTier,
    RequestContext,
    RateLimitResult,
    get_tier_limit,
    detect_tier_from_rpm,
    PERPLEXITY_TIER_LIMITS,
    OPENAI_TIER_LIMITS,
)

# Token bucket
from .token_bucket import (
    TokenBucket,
    TokenBucketMetrics,
    TokenBucketContext,
)

# Configuration
from .config import (
    RateLimitingConfig,
    get_rate_limit_config,
    reset_config,
)

# Adaptive rate limiter
from .adaptive import (
    AdaptiveRateLimiter,
    CircuitBreakerOpenError,
)

# Request queue
from .request_queue import (
    ProviderRequestQueue,
    RequestQueueManager,
    QueueFullError,
    QueuedRequest,
    QueueMetrics,
)

# Manager and convenience functions
from .manager import (
    RateLimitManager,
    get_rate_limit_manager,
    rate_limited_request,
    rate_limited_llm_call,
    shutdown_rate_limiting,
    reset_rate_limiting,
)


__all__ = [
    # Core types
    "Provider",
    "ProviderConfig",
    "RateLimitState",
    "RateLimitTier",
    "RequestContext",
    "RateLimitResult",
    "get_tier_limit",
    "detect_tier_from_rpm",
    "PERPLEXITY_TIER_LIMITS",
    "OPENAI_TIER_LIMITS",
    # Token bucket
    "TokenBucket",
    "TokenBucketMetrics",
    "TokenBucketContext",
    # Configuration
    "RateLimitingConfig",
    "get_rate_limit_config",
    "reset_config",
    # Adaptive rate limiter
    "AdaptiveRateLimiter",
    "CircuitBreakerOpenError",
    # Request queue
    "ProviderRequestQueue",
    "RequestQueueManager",
    "QueueFullError",
    "QueuedRequest",
    "QueueMetrics",
    # Manager
    "RateLimitManager",
    "get_rate_limit_manager",
    "rate_limited_request",
    "rate_limited_llm_call",
    "shutdown_rate_limiting",
    "reset_rate_limiting",
]
