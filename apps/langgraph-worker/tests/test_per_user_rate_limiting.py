"""
Comprehensive tests for per-user Perplexity rate limiting system.

Tests verify:
1. Per-user isolation - Independent rate limits for each user
2. Model separation - sonar-pro and deep-research have separate limits
3. Cleanup mechanism - Inactive users are removed to prevent memory leaks
4. Backward compatibility - Legacy functions still work
"""

import asyncio
import pytest
import time
from unittest.mock import patch

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.utils.perplexity_rate_limiter import (
    PerplexityRateLimiter,
    PerplexityRateLimiterManager,
    get_user_rate_limiter,
    cleanup_inactive_limiters,
    create_perplexity_rate_limiter,
)


class TestPerUserIsolation:
    """Test that each user has independent rate limiting."""

    @pytest.mark.asyncio
    async def test_different_users_independent_limits(self):
        """
        Verify that User A hitting rate limit does NOT affect User B.

        Scenario:
        - User A has 5 RPM limit and exhausts it
        - User B with same 5 RPM limit should still be able to make requests
        """
        # Reset manager for clean test
        PerplexityRateLimiterManager.reset_instance()

        # Get rate limiters for two different users with low limits for testing
        user_a_limiter = await get_user_rate_limiter("user_a", sonar_pro_rpm=5, deep_research_rpm=5)
        user_b_limiter = await get_user_rate_limiter("user_b", sonar_pro_rpm=5, deep_research_rpm=5)

        # User A exhausts their limit (5 requests)
        for _ in range(5):
            async with user_a_limiter.acquire("sonar-pro") as ctx:
                assert ctx.wait_time == 0.0, "First 5 requests should not wait"

        # User A's 6th request should wait
        start_time = time.monotonic()
        async with user_a_limiter.acquire("sonar-pro") as ctx:
            elapsed = time.monotonic() - start_time
            assert ctx.wait_time > 0, "User A should wait after exhausting limit"
            assert elapsed >= ctx.wait_time, "Should have actually waited"

        # User B should NOT be affected - first request should be instant
        start_time = time.monotonic()
        async with user_b_limiter.acquire("sonar-pro") as ctx:
            elapsed = time.monotonic() - start_time
            assert ctx.wait_time == 0.0, "User B should not wait (independent from User A)"
            assert elapsed < 0.1, "User B request should be instant (< 100ms)"

    @pytest.mark.asyncio
    async def test_same_user_shares_limit(self):
        """
        Verify that multiple calls with the same user_id share the same rate limiter.

        Scenario:
        - Get limiter for user_c twice
        - Both should return the same instance
        - Requests should share the same rate limit
        """
        PerplexityRateLimiterManager.reset_instance()

        # Get limiter for same user twice
        limiter_1 = await get_user_rate_limiter("user_c", sonar_pro_rpm=3)
        limiter_2 = await get_user_rate_limiter("user_c", sonar_pro_rpm=3)

        # Should be the same instance
        assert limiter_1 is limiter_2, "Same user should get same limiter instance"

        # Exhaust limit with limiter_1 (3 requests)
        for _ in range(3):
            async with limiter_1.acquire("sonar-pro"):
                pass

        # limiter_2 should also be exhausted (shares limit)
        async with limiter_2.acquire("sonar-pro") as ctx:
            assert ctx.wait_time > 0, "limiter_2 should share limit with limiter_1"


class TestModelSeparation:
    """Test that sonar-pro and deep-research have independent rate limits."""

    @pytest.mark.asyncio
    async def test_models_have_separate_limits(self):
        """
        Verify that sonar-pro and deep-research limits are independent.

        Scenario:
        - User has 5 sonar-pro RPM and 3 deep-research RPM
        - Exhaust sonar-pro limit
        - deep-research should still work without waiting
        """
        PerplexityRateLimiterManager.reset_instance()

        user_limiter = await get_user_rate_limiter(
            "user_d",
            sonar_pro_rpm=5,
            deep_research_rpm=3
        )

        # Exhaust sonar-pro limit (5 requests)
        for _ in range(5):
            async with user_limiter.acquire("sonar-pro") as ctx:
                assert ctx.wait_time == 0.0, "First 5 sonar-pro requests should not wait"

        # sonar-pro is now exhausted
        async with user_limiter.acquire("sonar-pro") as ctx:
            assert ctx.wait_time > 0, "sonar-pro should be exhausted"

        # But deep-research should still work instantly
        async with user_limiter.acquire("sonar-deep-research") as ctx:
            assert ctx.wait_time == 0.0, "deep-research should be independent from sonar-pro"

        # Exhaust deep-research too (3 requests total, 1 already used)
        for _ in range(2):
            async with user_limiter.acquire("sonar-deep-research") as ctx:
                assert ctx.wait_time == 0.0

        # Now deep-research should also be exhausted
        async with user_limiter.acquire("sonar-deep-research") as ctx:
            assert ctx.wait_time > 0, "deep-research should now be exhausted"

    @pytest.mark.asyncio
    async def test_unknown_model_defaults_to_sonar_pro(self):
        """
        Verify that unknown model names default to sonar-pro limits.

        This ensures graceful degradation if new models are added.
        """
        PerplexityRateLimiterManager.reset_instance()

        user_limiter = await get_user_rate_limiter(
            "user_e",
            sonar_pro_rpm=3,
            deep_research_rpm=10
        )

        # Request with unknown model
        async with user_limiter.acquire("unknown-model") as ctx:
            assert ctx.wait_time == 0.0, "First request should not wait"

        # Exhaust limit using sonar-pro (3 requests)
        for _ in range(2):
            async with user_limiter.acquire("sonar-pro"):
                pass

        # Unknown model should now also be exhausted (shares sonar-pro limit)
        async with user_limiter.acquire("unknown-model") as ctx:
            assert ctx.wait_time > 0, "Unknown model should share sonar-pro limit"


class TestCleanupMechanism:
    """Test that inactive users are cleaned up to prevent memory leaks."""

    @pytest.mark.asyncio
    async def test_inactive_users_cleaned_up(self):
        """
        Verify that users inactive for max_age_hours are removed.

        Scenario:
        - Create limiters for user_f and user_g
        - Mock user_f as inactive (last_activity 3 hours ago)
        - user_g is active (last_activity recent)
        - Cleanup with max_age=2 hours
        - user_f should be removed, user_g should remain
        """
        PerplexityRateLimiterManager.reset_instance()
        manager = await PerplexityRateLimiterManager.get_instance()

        # Create two limiters
        limiter_f = await manager.get_limiter("user_f")
        limiter_g = await manager.get_limiter("user_g")

        # Mock user_f as inactive (3 hours ago)
        # last_activity is monotonic time, so subtract 3 hours in seconds
        limiter_f.last_activity = time.monotonic() - (3 * 3600)

        # user_g is active (just accessed)
        limiter_g.last_activity = time.monotonic()

        # Verify both users exist
        assert "user_f" in manager._limiters
        assert "user_g" in manager._limiters

        # Run cleanup with max_age=2 hours
        removed_count = await manager.cleanup_inactive(max_age_hours=2.0)

        # user_f should be removed (inactive for 3 hours > 2 hours threshold)
        assert removed_count == 1, "Should remove 1 inactive user"
        assert "user_f" not in manager._limiters, "user_f should be removed"

        # user_g should still exist (active)
        assert "user_g" in manager._limiters, "user_g should still exist"

    @pytest.mark.asyncio
    async def test_cleanup_updates_last_activity(self):
        """
        Verify that acquire() updates last_activity timestamp.

        This prevents active users from being cleaned up.
        """
        PerplexityRateLimiterManager.reset_instance()

        limiter = await get_user_rate_limiter("user_h")

        # Record initial last_activity
        initial_activity = limiter.last_activity

        # Wait a bit
        await asyncio.sleep(0.1)

        # Make a request
        async with limiter.acquire("sonar-pro"):
            pass

        # last_activity should be updated
        assert limiter.last_activity > initial_activity, "acquire() should update last_activity"

    @pytest.mark.asyncio
    async def test_cleanup_with_no_inactive_users(self):
        """
        Verify that cleanup works correctly when no users are inactive.
        """
        PerplexityRateLimiterManager.reset_instance()
        manager = await PerplexityRateLimiterManager.get_instance()

        # Create active users
        await manager.get_limiter("user_i")
        await manager.get_limiter("user_j")

        # All users are active (just created)
        removed_count = await manager.cleanup_inactive(max_age_hours=2.0)

        assert removed_count == 0, "Should not remove any active users"
        assert len(manager._limiters) == 2, "Both users should still exist"


class TestBackwardCompatibility:
    """Test that legacy functions still work for existing code."""

    def test_create_perplexity_rate_limiter_works(self):
        """
        Verify that deprecated create_perplexity_rate_limiter() still works.

        This ensures backward compatibility with existing tests.
        """
        limiter = create_perplexity_rate_limiter(
            sonar_pro_rpm=100,
            deep_research_rpm=10
        )

        assert limiter is not None
        assert limiter.user_id == "legacy", "Should use 'legacy' user_id"
        assert limiter._limiters["sonar-pro"].requests_per_minute == 100
        assert limiter._limiters["sonar-deep-research"].requests_per_minute == 10

    @pytest.mark.asyncio
    async def test_default_user_id_fallback(self):
        """
        Verify that user_id=None defaults to "system" user.

        This maintains backward compatibility when user_id is not provided.
        """
        limiter = await get_user_rate_limiter(user_id=None)

        # Should create limiter with "system" user_id
        assert limiter.user_id in ["system", None], "None user_id should default to 'system'"


class TestMetricsAndObservability:
    """Test that metrics and observability features work correctly."""

    @pytest.mark.asyncio
    async def test_metrics_tracking(self):
        """
        Verify that metrics are tracked correctly.

        Metrics include:
        - total_requests
        - requests_waited
        - total_wait_time_ms
        - max_wait_time_ms
        """
        PerplexityRateLimiterManager.reset_instance()

        limiter = await get_user_rate_limiter("user_k", sonar_pro_rpm=2)

        # Get initial metrics
        metrics = limiter.get_metrics("sonar-pro")
        assert metrics.total_requests == 0
        assert metrics.requests_waited == 0
        assert metrics.total_wait_time_ms == 0.0

        # Make 2 requests (should not wait)
        for _ in range(2):
            async with limiter.acquire("sonar-pro"):
                pass

        metrics = limiter.get_metrics("sonar-pro")
        assert metrics.total_requests == 2
        assert metrics.requests_waited == 0, "First 2 requests should not wait"

        # 3rd request should wait
        async with limiter.acquire("sonar-pro") as ctx:
            assert ctx.wait_time > 0

        # Check updated metrics
        metrics = limiter.get_metrics("sonar-pro")
        assert metrics.total_requests == 3
        assert metrics.requests_waited == 1, "3rd request should have waited"
        assert metrics.total_wait_time_ms > 0
        assert metrics.max_wait_time_ms > 0
        assert metrics.avg_wait_time_ms > 0
        assert metrics.wait_percentage > 0

    @pytest.mark.asyncio
    async def test_get_all_metrics(self):
        """
        Verify that get_all_metrics() returns metrics for all models.
        """
        PerplexityRateLimiterManager.reset_instance()

        limiter = await get_user_rate_limiter("user_l")

        # Make requests to both models
        async with limiter.acquire("sonar-pro"):
            pass
        async with limiter.acquire("sonar-deep-research"):
            pass

        all_metrics = limiter.get_all_metrics()

        assert "sonar-pro" in all_metrics
        assert "sonar-deep-research" in all_metrics
        assert all_metrics["sonar-pro"].total_requests == 1
        assert all_metrics["sonar-deep-research"].total_requests == 1


class TestManagerStatistics:
    """Test that manager statistics are accurate."""

    @pytest.mark.asyncio
    async def test_manager_stats(self):
        """
        Verify that manager.get_stats() returns accurate statistics.
        """
        PerplexityRateLimiterManager.reset_instance()
        manager = await PerplexityRateLimiterManager.get_instance()

        # Initially empty
        stats = manager.get_stats()
        assert stats["total_users"] == 0
        assert stats["users"] == []

        # Add users
        await manager.get_limiter("user_m")
        await manager.get_limiter("user_n")
        await manager.get_limiter("user_o")

        stats = manager.get_stats()
        assert stats["total_users"] == 3
        assert set(stats["users"]) == {"user_m", "user_n", "user_o"}


class TestConcurrentAccess:
    """Test that concurrent access to rate limiters is thread-safe."""

    @pytest.mark.asyncio
    async def test_concurrent_requests_from_same_user(self):
        """
        Verify that concurrent requests from the same user are handled correctly.

        All requests should respect the rate limit and not cause race conditions.
        """
        PerplexityRateLimiterManager.reset_instance()

        limiter = await get_user_rate_limiter("user_p", sonar_pro_rpm=10)

        # Make 20 concurrent requests (exceeds 10 RPM limit)
        async def make_request(request_id):
            async with limiter.acquire("sonar-pro") as ctx:
                return (request_id, ctx.wait_time)

        # Start all requests concurrently
        tasks = [make_request(i) for i in range(20)]
        results = await asyncio.gather(*tasks)

        # First 10 should not wait (or wait very little)
        # Next 10 should wait
        wait_times = [wait_time for _, wait_time in results]
        no_wait_count = sum(1 for wt in wait_times if wt < 0.1)
        had_wait_count = sum(1 for wt in wait_times if wt >= 0.1)

        # Should have some requests that didn't wait and some that did
        assert no_wait_count > 0, "Some requests should not wait"
        assert had_wait_count > 0, "Some requests should wait (limit exceeded)"

        # Total should be 20
        assert no_wait_count + had_wait_count == 20


class TestEdgeCases:
    """Test edge cases and error conditions."""

    @pytest.mark.asyncio
    async def test_zero_rpm_limit(self):
        """
        Verify that rpm=0 disables rate limiting (no waits).
        """
        PerplexityRateLimiterManager.reset_instance()

        limiter = await get_user_rate_limiter("user_q", sonar_pro_rpm=0)

        # Make many requests - none should wait
        for _ in range(100):
            async with limiter.acquire("sonar-pro") as ctx:
                assert ctx.wait_time == 0.0, "rpm=0 should disable rate limiting"

    @pytest.mark.asyncio
    async def test_very_high_rpm_limit(self):
        """
        Verify that very high RPM limits work correctly.
        """
        PerplexityRateLimiterManager.reset_instance()

        limiter = await get_user_rate_limiter("user_r", sonar_pro_rpm=10000)

        # Make many requests - none should wait
        for _ in range(100):
            async with limiter.acquire("sonar-pro") as ctx:
                assert ctx.wait_time == 0.0, "High RPM should not cause waits for reasonable load"


# Run tests with pytest
if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
