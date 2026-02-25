"""
Adaptive Rate Limiter that learns actual API limits from 429 responses.

Algorithm:
1. Start with conservative estimate (not max tier)
2. On 429: Halve the rate limit, record the adjustment
3. On success streak: Slowly increase rate (10% every 5 min of success)
4. Track per-API-key for BYOK support
"""

import asyncio
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from .types import (
    Provider,
    ProviderConfig,
    RateLimitState,
    RateLimitTier,
    detect_tier_from_rpm,
)
from .token_bucket import TokenBucket
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


@dataclass
class AdaptiveRateLimiter:
    """
    Adaptive rate limiter that learns actual API limits from 429 responses.

    Features:
    - Per-API-key bucket isolation (BYOK support)
    - Automatic rate reduction on 429 errors
    - Gradual rate recovery after success streaks
    - Tier detection from rate limit patterns

    Usage:
        limiter = AdaptiveRateLimiter(Provider.PERPLEXITY, config)

        # Before making request
        wait_time = await limiter.acquire(api_key="user_key", model="sonar-pro")

        # After successful request
        await limiter.record_success(api_key="user_key", model="sonar-pro")

        # After 429 error
        await limiter.record_429(api_key="user_key", model="sonar-pro", retry_after=60)
    """
    provider: Provider
    config: ProviderConfig

    # Per-key state tracking (key = "{api_key_hash}:{model}")
    _states: Dict[str, RateLimitState] = field(default_factory=dict)
    _buckets: Dict[str, TokenBucket] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # Circuit breaker state
    _circuit_open: Dict[str, datetime] = field(default_factory=dict)

    def _hash_key(self, api_key: Optional[str]) -> str:
        """
        Hash API key for secure storage.

        Uses first 16 chars of SHA256 hash.
        Returns "system" for None (system API key).
        """
        if not api_key:
            return "system"
        return hashlib.sha256(api_key.encode()).hexdigest()[:16]

    def _get_bucket_key(self, api_key: Optional[str], model: Optional[str]) -> str:
        """Generate unique key for bucket lookup."""
        key_hash = self._hash_key(api_key)
        model_key = model or "default"
        return f"{key_hash}:{model_key}"

    async def get_or_create_bucket(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> Tuple[TokenBucket, RateLimitState]:
        """
        Get or create a token bucket for the given API key and model.

        Creates new bucket with conservative initial rate if not exists.

        Args:
            api_key: User's BYOK API key (None for system key)
            model: Model name for model-specific limits

        Returns:
            Tuple of (TokenBucket, RateLimitState)
        """
        bucket_key = self._get_bucket_key(api_key, model)

        async with self._lock:
            if bucket_key not in self._buckets:
                # Get model-specific config
                config = get_rate_limit_config()
                provider_config = config.get_provider_config(self.provider, model)

                # Start at 50% of default to avoid immediate 429s
                initial_rpm = provider_config.default_rpm // 2
                initial_rpm = max(initial_rpm, provider_config.min_rpm)

                # Create bucket with conservative config
                bucket_config = ProviderConfig(
                    provider=self.provider,
                    default_rpm=initial_rpm,
                    min_rpm=provider_config.min_rpm,
                    max_rpm=provider_config.max_rpm,
                    max_bucket_size=max(5, initial_rpm // 6),
                    adaptive_enabled=provider_config.adaptive_enabled,
                    recovery_window_seconds=provider_config.recovery_window_seconds,
                    halve_on_429=provider_config.halve_on_429,
                    recovery_increment=provider_config.recovery_increment,
                    success_threshold=provider_config.success_threshold,
                )

                self._buckets[bucket_key] = TokenBucket(config=bucket_config)
                self._states[bucket_key] = RateLimitState(
                    provider=self.provider,
                    api_key_hash=self._hash_key(api_key),
                    learned_rpm=initial_rpm,
                )

                logger.info(
                    f"[AdaptiveRateLimit] Created bucket: provider={self.provider.value}, "
                    f"key={bucket_key}, initial_rpm={initial_rpm}"
                )

            return self._buckets[bucket_key], self._states[bucket_key]

    def _is_circuit_open(self, bucket_key: str) -> bool:
        """Check if circuit breaker is open for this bucket."""
        config = get_rate_limit_config()
        if not config.circuit_breaker_enabled:
            return False

        if bucket_key not in self._circuit_open:
            return False

        open_time = self._circuit_open[bucket_key]
        cooldown = timedelta(seconds=config.circuit_breaker_cooldown_seconds)

        if datetime.utcnow() - open_time > cooldown:
            # Circuit has cooled down, close it
            del self._circuit_open[bucket_key]
            logger.info(f"[AdaptiveRateLimit] Circuit closed for {bucket_key}")
            return False

        return True

    async def acquire(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        tokens: int = 1,
        timeout: Optional[float] = None
    ) -> float:
        """
        Acquire rate limit permission.

        Waits if rate limit would be exceeded.

        Args:
            api_key: User's BYOK API key (None for system key)
            model: Model name for model-specific limits
            tokens: Number of tokens to acquire (default 1)
            timeout: Maximum wait time in seconds

        Returns:
            Wait time in seconds (0.0 if no wait needed)

        Raises:
            asyncio.TimeoutError: If timeout exceeded
            CircuitBreakerOpenError: If circuit breaker is open
        """
        bucket_key = self._get_bucket_key(api_key, model)

        # Check circuit breaker
        if self._is_circuit_open(bucket_key):
            cooldown = get_rate_limit_config().circuit_breaker_cooldown_seconds
            remaining = cooldown - (datetime.utcnow() - self._circuit_open[bucket_key]).seconds
            raise CircuitBreakerOpenError(
                f"Circuit breaker open for {self.provider.value}, retry in {remaining}s"
            )

        bucket, state = await self.get_or_create_bucket(api_key, model)

        wait_time = await bucket.acquire(tokens, timeout)

        if wait_time > 0:
            logger.debug(
                f"[AdaptiveRateLimit] Waited {wait_time:.2f}s for {self.provider.value} "
                f"(key={bucket_key}, effective_rpm={bucket.effective_rpm})"
            )

        return wait_time

    async def record_success(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None
    ) -> None:
        """
        Record a successful request.

        May trigger rate increase if:
        1. Success streak threshold met (count-based recovery)
        2. Sufficient time elapsed since last 429 (time-based recovery)

        Args:
            api_key: User's BYOK API key (None for system key)
            model: Model name for model-specific limits
        """
        bucket, state = await self.get_or_create_bucket(api_key, model)
        now = datetime.utcnow()

        state.total_requests += 1
        state.successful_requests_since_429 += 1
        state.last_updated = now

        # A successful request breaks the consecutive 429 streak.
        if state.consecutive_429_count > 0:
            state.consecutive_429_count = 0

        # Check if we should attempt rate increase
        config = self.config
        global_config = get_rate_limit_config()
        recovery_cooldown = timedelta(seconds=config.recovery_window_seconds)
        time_since_last_adjustment = now - state.last_rate_adjustment_at
        adjusted_outside_cooldown = time_since_last_adjustment > recovery_cooldown

        # Count-based recovery: increase after N successes and cooldown from
        # the most recent rate adjustment. This also enables startup ramp-up
        # for keys that haven't hit a 429 yet.
        count_based_recovery = (
            config.adaptive_enabled
            and state.successful_requests_since_429 >= config.success_threshold
            and adjusted_outside_cooldown
            and state.learned_rpm < config.max_rpm
        )

        # Time-based recovery: increase after time elapsed regardless of success count
        # This prevents being stuck at low rates when request volume is low
        time_based_recovery = (
            config.adaptive_enabled
            and global_config.time_based_recovery_enabled
            and state.last_429_at is not None
            and now - state.last_429_at > timedelta(seconds=global_config.time_based_recovery_seconds)
            and adjusted_outside_cooldown
            and state.learned_rpm < config.max_rpm
        )

        should_increase = count_based_recovery or time_based_recovery
        recovery_reason = "count_based" if count_based_recovery else "time_based" if time_based_recovery else None

        if should_increase:
            current_rpm = bucket.effective_rpm
            new_rpm = min(
                int(current_rpm * (1 + config.recovery_increment)),
                config.max_rpm
            )

            if new_rpm > current_rpm:
                await bucket.adjust_rate(new_rpm)
                state.learned_rpm = new_rpm
                state.successful_requests_since_429 = 0
                state.last_rate_adjustment_at = now

                logger.info(
                    f"[AdaptiveRateLimit] Increased rate for {self.provider.value}: "
                    f"{current_rpm} -> {new_rpm} RPM (key={self._get_bucket_key(api_key, model)}, "
                    f"reason={recovery_reason})"
                )

                capture_event(
                    "rate_limit_increased",
                    {
                        "provider": self.provider.value,
                        "model": model,
                        "old_rpm": current_rpm,
                        "new_rpm": new_rpm,
                        "total_requests": state.total_requests,
                        "success_streak": state.successful_requests_since_429,
                        "recovery_reason": recovery_reason,
                    }
                )

    async def record_429(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        retry_after: Optional[int] = None,
        response_headers: Optional[Dict[str, str]] = None
    ) -> Optional[int]:
        """
        Record a 429 rate limit error.

        Triggers rate decrease and updates state.
        May open circuit breaker on consecutive 429s.

        Args:
            api_key: User's BYOK API key (None for system key)
            model: Model name for model-specific limits
            retry_after: Seconds to wait from Retry-After header
            response_headers: Full response headers for additional signals

        Returns:
            Suggested retry_after value (from header or calculated)
        """
        bucket, state = await self.get_or_create_bucket(api_key, model)
        bucket_key = self._get_bucket_key(api_key, model)

        state.total_429s += 1
        state.consecutive_429_count += 1
        state.successful_requests_since_429 = 0
        state.last_429_at = datetime.utcnow()
        state.last_updated = datetime.utcnow()

        # Calculate new rate limit
        current_rpm = bucket.effective_rpm
        config = self.config

        if config.halve_on_429:
            # Halve the rate on 429
            new_rpm = max(config.min_rpm, current_rpm // 2)
        else:
            # More gradual decrease (25%)
            new_rpm = max(config.min_rpm, int(current_rpm * 0.75))

        # If consecutive 429s, be more aggressive
        if state.consecutive_429_count > 1:
            new_rpm = max(config.min_rpm, new_rpm // 2)

        await bucket.adjust_rate(new_rpm)
        state.learned_rpm = new_rpm
        state.last_rate_adjustment_at = datetime.utcnow()

        # Attempt tier detection
        detected_tier = detect_tier_from_rpm(self.provider, new_rpm, model)
        if detected_tier != RateLimitTier.UNKNOWN:
            state.learned_tier = detected_tier

        logger.warning(
            f"[AdaptiveRateLimit] 429 received for {self.provider.value}: "
            f"{current_rpm} -> {new_rpm} RPM (key={bucket_key}, "
            f"consecutive={state.consecutive_429_count}, total={state.total_429s})"
        )

        # Check circuit breaker threshold
        circuit_config = get_rate_limit_config()
        if (
            circuit_config.circuit_breaker_enabled
            and state.consecutive_429_count >= circuit_config.circuit_breaker_threshold
        ):
            self._circuit_open[bucket_key] = datetime.utcnow()
            logger.error(
                f"[AdaptiveRateLimit] Circuit breaker OPENED for {self.provider.value} "
                f"(key={bucket_key}, consecutive_429s={state.consecutive_429_count})"
            )

        capture_event(
            "rate_limit_429_detected",
            {
                "provider": self.provider.value,
                "model": model,
                "old_rpm": current_rpm,
                "new_rpm": new_rpm,
                "retry_after": retry_after,
                "consecutive_429s": state.consecutive_429_count,
                "total_429s": state.total_429s,
                "detected_tier": detected_tier.value,
                "circuit_open": bucket_key in self._circuit_open,
            }
        )

        return retry_after

    def get_stats(self, api_key: Optional[str] = None) -> Dict:
        """
        Get rate limiting statistics.

        Args:
            api_key: If provided, only return stats for this key.
                     If None, return stats for all keys.

        Returns:
            Dictionary of statistics per bucket
        """
        key_hash = self._hash_key(api_key) if api_key else None
        stats = {}

        for bucket_key, state in self._states.items():
            # Filter by key hash if specified
            if key_hash is not None and not bucket_key.startswith(key_hash):
                continue

            bucket = self._buckets.get(bucket_key)
            stats[bucket_key] = {
                "provider": state.provider.value,
                "learned_rpm": state.learned_rpm,
                "learned_tier": state.learned_tier.value,
                "total_requests": state.total_requests,
                "total_429s": state.total_429s,
                "consecutive_429s": state.consecutive_429_count,
                "successful_since_429": state.successful_requests_since_429,
                "last_429_at": state.last_429_at.isoformat() if state.last_429_at else None,
                "last_updated": state.last_updated.isoformat(),
                "circuit_open": bucket_key in self._circuit_open,
                "bucket_stats": bucket.get_stats() if bucket else None,
            }

        return stats

    async def reset(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        """
        Reset rate limiter state.

        Args:
            api_key: If provided with model, reset specific bucket.
                     If None, reset all buckets.
            model: Model to reset (requires api_key)
        """
        async with self._lock:
            if api_key is not None and model is not None:
                # Reset specific bucket
                bucket_key = self._get_bucket_key(api_key, model)
                if bucket_key in self._buckets:
                    await self._buckets[bucket_key].reset()
                    self._states[bucket_key] = RateLimitState(
                        provider=self.provider,
                        api_key_hash=self._hash_key(api_key),
                    )
                    if bucket_key in self._circuit_open:
                        del self._circuit_open[bucket_key]
            else:
                # Reset all buckets (await each reset)
                for bucket in self._buckets.values():
                    await bucket.reset()
                self._buckets.clear()
                self._states.clear()
                self._circuit_open.clear()


class CircuitBreakerOpenError(Exception):
    """Raised when circuit breaker is open and requests are blocked."""
    pass
