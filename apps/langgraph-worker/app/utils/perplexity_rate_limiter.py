"""
Perplexity API Rate Limiter with per-user sliding window algorithm.

Implements separate rate limits for different Perplexity models per user:
- sonar-pro: 4000 RPM (Tier 4/5 default)
- sonar-deep-research: 100 RPM (Tier 5 default)

**Per-User Architecture:**
- Each user_id gets independent rate limiter instance
- Supports BYOK (Bring Your Own Key) with different tiers per user
- Automatic cleanup of inactive users (prevents memory leaks)

Perplexity Tier System:
| Tier | Spending   | Sonar Pro RPM | Deep Research RPM |
|------|------------|---------------|-------------------|
| 0    | $0         | 50            | 5                 |
| 1    | $50+       | 150           | 10                |
| 2    | $250+      | 500           | 20                |
| 3    | $500+      | 1000          | 40                |
| 4    | $1000+     | 4000          | 60                |
| 5    | $5000+     | 4000          | 100               |

Uses sliding window pattern for consistency.
Supports BYOK clients with per-user tier configuration.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, Optional

from .logger import setup_logger
from .analytics import capture_event

logger = setup_logger(__name__)


@dataclass
class RateLimitMetrics:
    """Metrics for rate limit monitoring and observability."""
    total_requests: int = 0
    total_wait_time_ms: float = 0.0
    requests_waited: int = 0
    max_wait_time_ms: float = 0.0

    def record_request(self, wait_time_ms: float = 0.0) -> None:
        """Record a request and its wait time."""
        self.total_requests += 1
        if wait_time_ms > 0:
            self.requests_waited += 1
            self.total_wait_time_ms += wait_time_ms
            self.max_wait_time_ms = max(self.max_wait_time_ms, wait_time_ms)

    @property
    def avg_wait_time_ms(self) -> float:
        """Average wait time for requests that had to wait."""
        if self.requests_waited == 0:
            return 0.0
        return self.total_wait_time_ms / self.requests_waited

    @property
    def wait_percentage(self) -> float:
        """Percentage of requests that had to wait."""
        if self.total_requests == 0:
            return 0.0
        return (self.requests_waited / self.total_requests) * 100


@dataclass
class ModelRateLimiter:
    """Rate limiter for a specific Perplexity model."""
    model_name: str
    requests_per_minute: int
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    request_timestamps: Deque[float] = field(default_factory=deque)
    metrics: RateLimitMetrics = field(default_factory=RateLimitMetrics)

    async def acquire(self) -> float:
        """
        Acquire permission to make a request.

        Returns:
            float: Wait time in seconds (0.0 if no wait was needed)
        """
        if self.requests_per_minute <= 0:
            return 0.0

        total_wait_time = 0.0

        while True:
            async with self.lock:
                now = time.monotonic()
                window_start = now - 60  # 60 second sliding window

                # Remove timestamps outside the window
                while self.request_timestamps and self.request_timestamps[0] < window_start:
                    self.request_timestamps.popleft()

                # Check if we're under the limit
                if len(self.request_timestamps) < self.requests_per_minute:
                    self.request_timestamps.append(now)
                    self.metrics.record_request(total_wait_time * 1000)
                    return total_wait_time

                # Calculate wait time until oldest request falls out of window
                oldest = self.request_timestamps[0]
                wait_time = max(0.0, 60 - (now - oldest))

            # Wait outside the lock to allow other operations
            if wait_time > 0:
                logger.info(
                    f"[RateLimit] {self.model_name}: waiting {wait_time:.2f}s "
                    f"({len(self.request_timestamps)}/{self.requests_per_minute} RPM)"
                )
                await asyncio.sleep(wait_time)
                total_wait_time += wait_time


class PerplexityRateLimiter:
    """
    Per-user rate limiter for Perplexity API with per-model limits.

    Each user gets independent rate limiting based on their Perplexity tier.
    Supports BYOK (Bring Your Own Key) with different subscription tiers.

    Perplexity Rate Limits by Tier:
    | Tier | Spending | Sonar Pro RPM | Deep Research RPM |
    |------|----------|---------------|-------------------|
    | 0    | $0       | 50            | 5                 |
    | 1    | $50+     | 150           | 10                |
    | 2    | $250+    | 500           | 20                |
    | 3    | $500+    | 1000          | 40                |
    | 4    | $1000+   | 4000          | 60                |
    | 5    | $5000+   | 4000          | 100               |

    Default to Tier 5 limits (most generous) - BYOK clients likely have high tiers.
    Lower-tier users who hit 429s are handled by retry logic with exponential backoff.
    """

    # Default rate limits (highest documented sonar-pro tier)
    DEFAULT_SONAR_PRO_RPM = 4000
    DEFAULT_DEEP_RESEARCH_RPM = 100

    def __init__(
        self,
        user_id: str,
        sonar_pro_rpm: Optional[int] = None,
        deep_research_rpm: Optional[int] = None,
    ):
        """
        Initialize per-user rate limiter with configurable limits.

        Args:
            user_id: Unique user identifier for this rate limiter
            sonar_pro_rpm: Requests per minute for sonar-pro model
            deep_research_rpm: Requests per minute for sonar-deep-research model
        """
        self.user_id = user_id
        self.last_activity = time.monotonic()  # For cleanup tracking
        self._limiters: Dict[str, ModelRateLimiter] = {}

        # Initialize rate limiters for each model
        self._limiters["sonar-pro"] = ModelRateLimiter(
            model_name="sonar-pro",
            requests_per_minute=sonar_pro_rpm or self.DEFAULT_SONAR_PRO_RPM,
        )
        self._limiters["sonar-deep-research"] = ModelRateLimiter(
            model_name="sonar-deep-research",
            requests_per_minute=deep_research_rpm or self.DEFAULT_DEEP_RESEARCH_RPM,
        )

        logger.info(
            f"[RateLimit] Initialized Perplexity rate limiter for user '{user_id}': "
            f"sonar-pro={self._limiters['sonar-pro'].requests_per_minute} RPM, "
            f"deep-research={self._limiters['sonar-deep-research'].requests_per_minute} RPM"
        )

    def get_limiter(self, model: str) -> ModelRateLimiter:
        """
        Get rate limiter for a specific model.

        Args:
            model: Model name (sonar-pro, sonar-deep-research)

        Returns:
            ModelRateLimiter for the specified model

        Raises:
            ValueError: If model is not recognized
        """
        if model not in self._limiters:
            # Default to sonar-pro limits for unknown models
            logger.warning(f"[RateLimit] Unknown model '{model}', using sonar-pro limits")
            return self._limiters["sonar-pro"]
        return self._limiters[model]

    def acquire(self, model: str) -> "RateLimitContext":
        """
        Acquire rate limit permission for a model.

        Usage:
            async with rate_limiter.acquire("sonar-deep-research"):
                # Make API call
                result = await client.deep_research(...)

        Args:
            model: Model name to acquire limit for

        Returns:
            Async context manager that waits for rate limit if needed
        """
        # Update last activity timestamp for cleanup tracking
        self.last_activity = time.monotonic()
        return RateLimitContext(self, model)

    def get_metrics(self, model: str) -> RateLimitMetrics:
        """Get metrics for a specific model's rate limiter."""
        return self.get_limiter(model).metrics

    def get_all_metrics(self) -> Dict[str, RateLimitMetrics]:
        """Get metrics for all rate limiters."""
        return {name: limiter.metrics for name, limiter in self._limiters.items()}


class RateLimitContext:
    """Async context manager for rate limit acquisition."""

    def __init__(self, rate_limiter: PerplexityRateLimiter, model: str):
        self.rate_limiter = rate_limiter
        self.model = model
        self.wait_time: float = 0.0

    async def __aenter__(self) -> "RateLimitContext":
        """Acquire rate limit, waiting if necessary."""
        limiter = self.rate_limiter.get_limiter(self.model)
        self.wait_time = await limiter.acquire()

        if self.wait_time > 0:
            # Log rate limit event for observability
            capture_event(
                "perplexity_rate_limit_wait",
                {
                    "user_id": self.rate_limiter.user_id,
                    "model": self.model,
                    "wait_time_ms": self.wait_time * 1000,
                    "rpm_limit": limiter.requests_per_minute,
                    "queue_depth": len(limiter.request_timestamps),
                },
            )

        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit context (no cleanup needed)."""
        pass


class PerplexityRateLimiterManager:
    """
    Manager for per-user Perplexity rate limiters.

    Provides:
    - Per-user rate limiter instances
    - Automatic cleanup of inactive users
    - Thread-safe access to limiters
    - BYOK support with different tiers per user
    """

    _instance: Optional["PerplexityRateLimiterManager"] = None
    _instance_lock = asyncio.Lock()

    def __init__(self):
        """Initialize the rate limiter manager."""
        self._limiters: Dict[str, PerplexityRateLimiter] = {}
        self._limiter_lock = asyncio.Lock()
        logger.info("[RateLimit] Initialized PerplexityRateLimiterManager")

    @classmethod
    async def get_instance(cls) -> "PerplexityRateLimiterManager":
        """Get singleton instance of rate limiter manager."""
        async with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton instance (for testing)."""
        cls._instance = None

    async def get_limiter(
        self,
        user_id: str,
        sonar_pro_rpm: Optional[int] = None,
        deep_research_rpm: Optional[int] = None,
    ) -> PerplexityRateLimiter:
        """
        Get or create rate limiter for a specific user.

        Args:
            user_id: Unique user identifier
            sonar_pro_rpm: Override default sonar-pro RPM limit
            deep_research_rpm: Override default deep-research RPM limit

        Returns:
            PerplexityRateLimiter instance for this user
        """
        async with self._limiter_lock:
            if user_id not in self._limiters:
                self._limiters[user_id] = PerplexityRateLimiter(
                    user_id=user_id,
                    sonar_pro_rpm=sonar_pro_rpm,
                    deep_research_rpm=deep_research_rpm,
                )
                logger.info(f"[RateLimit] Created new rate limiter for user '{user_id}'")
            return self._limiters[user_id]

    async def cleanup_inactive(self, max_age_hours: float = 2.0) -> int:
        """
        Remove inactive user rate limiters to prevent memory leaks.

        Args:
            max_age_hours: Remove limiters inactive for this many hours

        Returns:
            Number of limiters removed
        """
        max_age_seconds = max_age_hours * 3600
        now = time.monotonic()
        removed_count = 0

        async with self._limiter_lock:
            inactive_users = [
                user_id
                for user_id, limiter in self._limiters.items()
                if (now - limiter.last_activity) > max_age_seconds
            ]

            for user_id in inactive_users:
                del self._limiters[user_id]
                removed_count += 1

            if removed_count > 0:
                logger.info(
                    f"[RateLimit] Cleaned up {removed_count} inactive rate limiters "
                    f"(max_age={max_age_hours}h, remaining={len(self._limiters)})"
                )

        return removed_count

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about managed rate limiters."""
        return {
            "total_users": len(self._limiters),
            "users": list(self._limiters.keys()),
        }


# Convenience functions for per-user rate limiting

async def get_user_rate_limiter(
    user_id: str,
    sonar_pro_rpm: Optional[int] = None,
    deep_research_rpm: Optional[int] = None,
) -> PerplexityRateLimiter:
    """
    Get or create per-user Perplexity rate limiter instance.

    Args:
        user_id: Unique user identifier
        sonar_pro_rpm: Override default sonar-pro RPM limit
        deep_research_rpm: Override default deep-research RPM limit

    Returns:
        PerplexityRateLimiter instance for this user
    """
    manager = await PerplexityRateLimiterManager.get_instance()
    return await manager.get_limiter(
        user_id=user_id,
        sonar_pro_rpm=sonar_pro_rpm,
        deep_research_rpm=deep_research_rpm,
    )


async def cleanup_inactive_limiters(max_age_hours: float = 2.0) -> int:
    """
    Clean up inactive user rate limiters.

    Args:
        max_age_hours: Remove limiters inactive for this many hours

    Returns:
        Number of limiters removed
    """
    manager = await PerplexityRateLimiterManager.get_instance()
    return await manager.cleanup_inactive(max_age_hours)


def create_perplexity_rate_limiter(
    sonar_pro_rpm: Optional[int] = None,
    deep_research_rpm: Optional[int] = None,
) -> PerplexityRateLimiter:
    """
    Create a new Perplexity rate limiter instance (for testing/legacy).

    DEPRECATED: Use get_user_rate_limiter() instead for per-user rate limiting.

    Args:
        sonar_pro_rpm: Requests per minute for sonar-pro
        deep_research_rpm: Requests per minute for sonar-deep-research

    Returns:
        New PerplexityRateLimiter instance
    """
    return PerplexityRateLimiter(
        user_id="legacy",
        sonar_pro_rpm=sonar_pro_rpm,
        deep_research_rpm=deep_research_rpm,
    )
