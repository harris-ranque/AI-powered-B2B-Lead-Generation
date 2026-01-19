"""
Token Bucket Rate Limiter implementation.

The token bucket algorithm provides smooth rate limiting with controlled burst capacity:
- Tokens are added to the bucket at a constant rate (refill rate)
- Each request consumes tokens from the bucket
- If insufficient tokens, the request waits until enough tokens accumulate
- Bucket has a maximum capacity (burst limit)

Why Token Bucket over Sliding Window:
1. Smoother request distribution - allows controlled bursts
2. Self-regulating - naturally smooths traffic over time
3. Easy to adjust dynamically - just change refill rate
4. Better handling of variable request patterns
"""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Optional

from .types import ProviderConfig


@dataclass
class TokenBucketMetrics:
    """Metrics for observability and debugging."""
    total_requests: int = 0
    total_wait_time_seconds: float = 0.0
    requests_that_waited: int = 0
    max_wait_time_seconds: float = 0.0
    tokens_consumed: int = 0

    def record_request(self, wait_time: float, tokens: int = 1) -> None:
        """Record metrics for a request."""
        self.total_requests += 1
        self.tokens_consumed += tokens
        if wait_time > 0:
            self.requests_that_waited += 1
            self.total_wait_time_seconds += wait_time
            self.max_wait_time_seconds = max(self.max_wait_time_seconds, wait_time)

    @property
    def avg_wait_time_seconds(self) -> float:
        """Average wait time for requests that had to wait."""
        if self.requests_that_waited == 0:
            return 0.0
        return self.total_wait_time_seconds / self.requests_that_waited

    @property
    def wait_percentage(self) -> float:
        """Percentage of requests that had to wait."""
        if self.total_requests == 0:
            return 0.0
        return (self.requests_that_waited / self.total_requests) * 100

    def to_dict(self) -> dict:
        """Convert metrics to dictionary for logging/analytics."""
        return {
            "total_requests": self.total_requests,
            "total_wait_time_seconds": round(self.total_wait_time_seconds, 3),
            "requests_that_waited": self.requests_that_waited,
            "max_wait_time_seconds": round(self.max_wait_time_seconds, 3),
            "avg_wait_time_seconds": round(self.avg_wait_time_seconds, 3),
            "wait_percentage": round(self.wait_percentage, 2),
            "tokens_consumed": self.tokens_consumed,
        }


@dataclass
class TokenBucket:
    """
    Token bucket rate limiter with dynamic rate adjustment.

    The bucket starts full and tokens are consumed on each request.
    Tokens are refilled at a constant rate based on the effective RPM.
    If the bucket is empty, requests wait until tokens accumulate.

    Uses asyncio.Condition for efficient waiting - waiters sleep for the exact
    time needed and are notified early when rate adjustments occur.

    Attributes:
        config: Provider configuration with rate limits
        effective_rpm: Current effective requests per minute (can be adjusted)
        current_tokens: Current number of tokens in the bucket
        last_refill_time: Timestamp of last token refill
    """
    config: ProviderConfig
    current_tokens: float = field(init=False)
    last_refill_time: float = field(init=False)
    _condition: asyncio.Condition = field(default_factory=asyncio.Condition, repr=False)
    metrics: TokenBucketMetrics = field(default_factory=TokenBucketMetrics, repr=False)

    # Dynamic rate fields
    _effective_rpm: int = field(init=False, repr=False)
    _refill_rate_per_second: float = field(init=False, repr=False)
    _max_bucket_size: int = field(init=False, repr=False)

    def __post_init__(self):
        """Initialize bucket with full tokens."""
        self._effective_rpm = self.config.default_rpm
        self._max_bucket_size = self.config.max_bucket_size
        self._refill_rate_per_second = self._effective_rpm / 60.0
        self.current_tokens = float(self._max_bucket_size)
        self.last_refill_time = time.monotonic()

    @property
    def effective_rpm(self) -> int:
        """Current effective requests per minute."""
        return self._effective_rpm

    @property
    def refill_rate_per_second(self) -> float:
        """Current token refill rate per second."""
        return self._refill_rate_per_second

    async def acquire(self, tokens: int = 1, timeout: Optional[float] = None) -> float:
        """
        Acquire tokens from the bucket.

        Waits if insufficient tokens are available. Returns the total wait time.
        Uses efficient async waiting - sleeps for exact time needed and wakes
        early when rate adjustments occur.

        Args:
            tokens: Number of tokens to acquire (default 1)
            timeout: Maximum time to wait in seconds (None = wait indefinitely)

        Returns:
            Total wait time in seconds (0.0 if no wait needed)

        Raises:
            asyncio.TimeoutError: If timeout exceeded while waiting for tokens
        """
        start_time = time.monotonic()
        deadline = start_time + timeout if timeout is not None else None

        async with self._condition:
            while True:
                # Refill bucket based on elapsed time
                self._refill()

                if self.current_tokens >= tokens:
                    # Have enough tokens, consume and return
                    self.current_tokens -= tokens
                    total_wait = time.monotonic() - start_time
                    self.metrics.record_request(total_wait, tokens)
                    return total_wait

                # Calculate exact wait time for required tokens
                tokens_needed = tokens - self.current_tokens
                wait_time = tokens_needed / self._refill_rate_per_second

                # Check timeout deadline
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise asyncio.TimeoutError(
                            f"Rate limit timeout: need {tokens_needed:.2f} tokens, "
                            f"no time remaining"
                        )
                    if wait_time > remaining:
                        raise asyncio.TimeoutError(
                            f"Rate limit timeout: need {tokens_needed:.2f} tokens, "
                            f"would wait {wait_time:.2f}s but only {remaining:.2f}s remaining"
                        )
                    # Don't wait longer than deadline allows
                    wait_time = min(wait_time, remaining)

                # Efficient wait - will wake early if rate is adjusted (notify_all called)
                try:
                    await asyncio.wait_for(
                        self._condition.wait(),
                        timeout=wait_time
                    )
                    # Woken early by notify_all (rate adjustment) - loop and recheck
                except asyncio.TimeoutError:
                    # Expected timeout - tokens should now be available
                    pass

    def _refill(self) -> None:
        """
        Refill bucket based on elapsed time since last refill.

        Called internally while holding the lock.
        """
        now = time.monotonic()
        elapsed = now - self.last_refill_time
        self.last_refill_time = now

        # Add tokens based on elapsed time and refill rate
        tokens_to_add = elapsed * self._refill_rate_per_second
        self.current_tokens = min(
            self.current_tokens + tokens_to_add,
            float(self._max_bucket_size)
        )

    async def adjust_rate(self, new_rpm: int) -> None:
        """
        Dynamically adjust the rate limit.

        Called when we learn the actual API tier from 429 responses,
        or when recovering after successful requests. Wakes all waiters
        to recompute their wait times with the new rate.

        Args:
            new_rpm: New requests per minute limit
        """
        async with self._condition:
            # Clamp to configured bounds
            self._effective_rpm = max(
                self.config.min_rpm,
                min(new_rpm, self.config.max_rpm)
            )
            self._refill_rate_per_second = self._effective_rpm / 60.0

            # Adjust bucket size proportionally (allow ~10 seconds of burst)
            self._max_bucket_size = max(10, self._effective_rpm // 6)

            # Don't let current tokens exceed new max
            if self.current_tokens > self._max_bucket_size:
                self.current_tokens = float(self._max_bucket_size)

            # Wake all waiters to recalculate with new rate
            self._condition.notify_all()

    def get_available_tokens(self) -> float:
        """
        Get current available tokens without consuming any.

        Note: This is approximate as it doesn't acquire the lock.
        Use for metrics/debugging only.
        """
        # Calculate tokens that would be refilled
        now = time.monotonic()
        elapsed = now - self.last_refill_time
        tokens_to_add = elapsed * self._refill_rate_per_second
        return min(self.current_tokens + tokens_to_add, float(self._max_bucket_size))

    def get_stats(self) -> dict:
        """Get current bucket statistics for monitoring."""
        return {
            "effective_rpm": self._effective_rpm,
            "refill_rate_per_second": round(self._refill_rate_per_second, 3),
            "max_bucket_size": self._max_bucket_size,
            "current_tokens": round(self.get_available_tokens(), 2),
            "min_rpm": self.config.min_rpm,
            "max_rpm": self.config.max_rpm,
            "metrics": self.metrics.to_dict(),
        }

    async def reset(self) -> None:
        """Reset bucket to initial state (full tokens, default rate)."""
        async with self._condition:
            self._effective_rpm = self.config.default_rpm
            self._max_bucket_size = self.config.max_bucket_size
            self._refill_rate_per_second = self._effective_rpm / 60.0
            self.current_tokens = float(self._max_bucket_size)
            self.last_refill_time = time.monotonic()
            self.metrics = TokenBucketMetrics()
            # Wake waiters to recalculate with reset rate
            self._condition.notify_all()


class TokenBucketContext:
    """
    Async context manager for token bucket acquisition.

    Usage:
        async with TokenBucketContext(bucket, tokens=1) as ctx:
            # ctx.wait_time contains seconds waited
            await make_api_call()
    """

    def __init__(self, bucket: TokenBucket, tokens: int = 1, timeout: Optional[float] = None):
        self.bucket = bucket
        self.tokens = tokens
        self.timeout = timeout
        self.wait_time: float = 0.0

    async def __aenter__(self) -> "TokenBucketContext":
        """Acquire tokens from the bucket."""
        self.wait_time = await self.bucket.acquire(self.tokens, self.timeout)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit context (no cleanup needed)."""
        pass
