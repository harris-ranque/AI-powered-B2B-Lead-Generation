"""
Core types for the adaptive rate limiting system.

This module defines the fundamental data structures used across the rate limiting system:
- Provider enum for supported API providers
- RateLimitTier for API tier classification
- Configuration and state dataclasses
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional


class Provider(str, Enum):
    """Supported API providers for rate limiting."""
    PERPLEXITY = "perplexity"
    OPENAI = "openai"
    FINDYMAIL = "findymail"


class RateLimitTier(str, Enum):
    """
    API tier levels with associated rate limits.

    Different providers have different tier systems:
    - Perplexity: Tiers 0-5 based on spending
    - OpenAI: Tiers 0-5 based on spending
    - FindyMail: Single tier (API-wide limits)
    """
    UNKNOWN = "unknown"
    FREE = "free"
    TIER_0 = "tier_0"
    TIER_1 = "tier_1"
    TIER_2 = "tier_2"
    TIER_3 = "tier_3"
    TIER_4 = "tier_4"
    TIER_5 = "tier_5"


@dataclass
class ProviderConfig:
    """
    Configuration for a specific API provider's rate limiting.

    Attributes:
        provider: The API provider this config applies to
        default_rpm: Default requests per minute (conservative start)
        min_rpm: Minimum RPM floor (never go below this)
        max_rpm: Maximum RPM ceiling (never exceed this)
        max_bucket_size: Maximum tokens in the bucket (burst capacity)
        adaptive_enabled: Whether to learn from 429 responses
        recovery_window_seconds: Time before attempting rate increase after 429
        halve_on_429: Whether to halve rate on 429 (vs 25% decrease)
        recovery_increment: Percentage to increase rate on recovery (0.1 = 10%)
        success_threshold: Number of successes before attempting rate increase
    """
    provider: Provider
    default_rpm: int
    min_rpm: int = 10
    max_rpm: int = 10000
    max_bucket_size: int = 60
    adaptive_enabled: bool = True
    recovery_window_seconds: int = 300
    halve_on_429: bool = True
    recovery_increment: float = 0.10
    success_threshold: int = 50


@dataclass
class RateLimitState:
    """
    Current state of rate limiting for an API key.

    Tracks learned limits and statistics for adaptive rate limiting.
    Each unique (provider, api_key, model) tuple has its own state.

    Attributes:
        provider: The API provider
        api_key_hash: SHA256 hash of API key (first 16 chars) for security
        learned_rpm: Currently learned/effective RPM limit
        learned_tier: Detected API tier based on rate limit patterns
        last_429_at: Timestamp of most recent 429 error
        consecutive_429_count: Count of consecutive 429s (resets on success)
        successful_requests_since_429: Successes since last 429
        total_requests: Total requests made
        total_429s: Total 429 errors received
        last_rate_adjustment_at: Timestamp of latest RPM adjustment
        last_updated: Timestamp of last state update
    """
    provider: Provider
    api_key_hash: str
    learned_rpm: Optional[int] = None
    learned_tier: RateLimitTier = RateLimitTier.UNKNOWN
    last_429_at: Optional[datetime] = None
    consecutive_429_count: int = 0
    successful_requests_since_429: int = 0
    total_requests: int = 0
    total_429s: int = 0
    last_rate_adjustment_at: datetime = field(default_factory=datetime.utcnow)
    last_updated: datetime = field(default_factory=datetime.utcnow)


@dataclass
class RequestContext:
    """
    Context for a rate-limited request.

    Passed to the rate limiter to determine which bucket to use
    and how to prioritize the request.

    Attributes:
        provider: API provider to use
        api_key: User's BYOK API key (None for system key)
        model: Model name for model-specific limits (e.g., "sonar-pro", "gpt-4o")
        estimated_tokens: Estimated tokens for token-based limits (optional)
        priority: Request priority (higher = more priority, processed first)
        correlation_id: For tracing and debugging
    """
    provider: Provider
    api_key: Optional[str] = None
    model: Optional[str] = None
    estimated_tokens: Optional[int] = None
    priority: int = 0
    correlation_id: Optional[str] = None


@dataclass
class RateLimitResult:
    """
    Result of a rate limit check.

    Attributes:
        allowed: Whether the request is allowed
        wait_time_seconds: How long the request had to wait (0 if no wait)
        retry_after_seconds: Suggested retry time if not allowed
        current_rpm: Current effective RPM limit
        queue_depth: Number of requests waiting in queue
    """
    allowed: bool
    wait_time_seconds: float = 0.0
    retry_after_seconds: Optional[float] = None
    current_rpm: Optional[int] = None
    queue_depth: int = 0


# Perplexity tier mapping (RPM limits by model)
PERPLEXITY_TIER_LIMITS: Dict[RateLimitTier, Dict[str, int]] = {
    RateLimitTier.TIER_0: {"sonar-pro": 50, "sonar-deep-research": 5},
    RateLimitTier.TIER_1: {"sonar-pro": 150, "sonar-deep-research": 10},
    RateLimitTier.TIER_2: {"sonar-pro": 500, "sonar-deep-research": 20},
    RateLimitTier.TIER_3: {"sonar-pro": 1000, "sonar-deep-research": 40},
    RateLimitTier.TIER_4: {"sonar-pro": 4000, "sonar-deep-research": 60},
    RateLimitTier.TIER_5: {"sonar-pro": 4000, "sonar-deep-research": 100},
}

# OpenAI tier mapping (approximate - varies by model)
OPENAI_TIER_LIMITS: Dict[RateLimitTier, Dict[str, int]] = {
    RateLimitTier.FREE: {"gpt-4o": 500, "gpt-4o-mini": 500, "default": 500},
    RateLimitTier.TIER_1: {"gpt-4o": 500, "gpt-4o-mini": 500, "default": 500},
    RateLimitTier.TIER_2: {"gpt-4o": 5000, "gpt-4o-mini": 5000, "default": 5000},
    RateLimitTier.TIER_3: {"gpt-4o": 5000, "gpt-4o-mini": 5000, "default": 5000},
    RateLimitTier.TIER_4: {"gpt-4o": 10000, "gpt-4o-mini": 10000, "default": 10000},
    RateLimitTier.TIER_5: {"gpt-4o": 10000, "gpt-4o-mini": 10000, "default": 10000},
}


def get_tier_limit(provider: Provider, tier: RateLimitTier, model: Optional[str] = None) -> Optional[int]:
    """
    Get the RPM limit for a provider/tier/model combination.

    Args:
        provider: API provider
        tier: Rate limit tier
        model: Model name (optional, uses default if not specified)

    Returns:
        RPM limit for the combination, or None if not found
    """
    if provider == Provider.PERPLEXITY:
        tier_limits = PERPLEXITY_TIER_LIMITS.get(tier)
        if tier_limits:
            return tier_limits.get(model or "sonar-pro")
    elif provider == Provider.OPENAI:
        tier_limits = OPENAI_TIER_LIMITS.get(tier)
        if tier_limits:
            return tier_limits.get(model or "default", tier_limits.get("default"))
    return None


def detect_tier_from_rpm(provider: Provider, effective_rpm: int, model: Optional[str] = None) -> RateLimitTier:
    """
    Attempt to detect API tier based on effective rate limit.

    Compares the effective RPM against known tier limits to determine
    which tier the API key likely belongs to.

    Args:
        provider: API provider
        effective_rpm: Currently effective RPM limit
        model: Model name for model-specific detection

    Returns:
        Detected tier, or UNKNOWN if can't determine
    """
    tier_mapping = None
    if provider == Provider.PERPLEXITY:
        tier_mapping = PERPLEXITY_TIER_LIMITS
    elif provider == Provider.OPENAI:
        tier_mapping = OPENAI_TIER_LIMITS

    if not tier_mapping:
        return RateLimitTier.UNKNOWN

    model_key = model or ("sonar-pro" if provider == Provider.PERPLEXITY else "default")

    # Find the highest tier that matches or is below the effective RPM
    detected_tier = RateLimitTier.UNKNOWN
    for tier in [RateLimitTier.TIER_0, RateLimitTier.TIER_1, RateLimitTier.TIER_2,
                 RateLimitTier.TIER_3, RateLimitTier.TIER_4, RateLimitTier.TIER_5]:
        tier_limits = tier_mapping.get(tier)
        if tier_limits and model_key in tier_limits:
            if tier_limits[model_key] <= effective_rpm:
                detected_tier = tier

    return detected_tier
