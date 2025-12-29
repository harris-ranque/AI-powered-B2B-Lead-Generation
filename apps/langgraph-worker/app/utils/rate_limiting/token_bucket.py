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

    Attributes:
        config: Provider configuration with rate limits
        effective_rpm: Current effective requests per minute (can be adjusted)
        current_tokens: Current number of tokens in the bucket
        last_refill_time: Timestamp of last token refill
    """
    config: ProviderConfig
    current_tokens: float = field(init=False)
    last_refill_time: float = field(init=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
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

        Args:
            tokens: Number of tokens to acquire (default 1)
            timeout: Maximum time to wait in seconds (None = wait indefinitely)

        Returns:
            Total wait time in seconds (0.0 if no wait needed)

        Raises:
            asyncio.TimeoutError: If timeout exceeded while waiting for tokens
        """
        start_time = time.monotonic()
        total_wait = 0.0

        async with self._lock:
            while True:
                # Refill bucket based on elapsed time
                self._refill()

                if self.current_tokens >= tokens:
                    # Have enough tokens, consume and return
                    self.current_tokens -= tokens
                    self.metrics.record_request(total_wait, tokens)
                    return total_wait

                # Calculate wait time for required tokens
                tokens_needed = tokens - self.current_tokens
                wait_time = tokens_needed / self._refill_rate_per_second

                # Check timeout
                if timeout is not None:
                    elapsed = time.monotonic() - start_time
                    if elapsed + wait_time > timeout:
                        raise asyncio.TimeoutError(
                            f"Rate limit timeout: need {tokens_needed:.2f} tokens, "
                            f"would wait {wait_time:.2f}s but timeout is {timeout - elapsed:.2f}s"
                        )

                # Release lock while waiting to allow rate adjustments
                # Use a copy of wait_time to avoid race conditions
                wait_duration = min(wait_time, 1.0)  # Wait max 1 second at a time

        # Wait outside the lock
        await asyncio.sleep(wait_duration)
        total_wait += wait_duration

        # Re-acquire lock and continue the loop
        async with self._lock:
            pass  # Will loop back to check tokens again

        # Recursive call to continue waiting if needed
        # This allows rate adjustments to take effect during long waits
        return total_wait + await self.acquire(tokens, timeout - total_wait if timeout else None)

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

    def adjust_rate(self, new_rpm: int) -> None:
        """
        Dynamically adjust the rate limit.

        Called when we learn the actual API tier from 429 responses,
        or when recovering after successful requests.

        Args:
            new_rpm: New requests per minute limit
        """
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

    def reset(self) -> None:
        """Reset bucket to initial state (full tokens, default rate)."""
        self._effective_rpm = self.config.default_rpm
        self._max_bucket_size = self.config.max_bucket_size
        self._refill_rate_per_second = self._effective_rpm / 60.0
        self.current_tokens = float(self._max_bucket_size)
        self.last_refill_time = time.monotonic()
        self.metrics = TokenBucketMetrics()


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
