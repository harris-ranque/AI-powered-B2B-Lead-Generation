"""
Environment-based configuration for the rate limiting system.

All settings can be overridden via environment variables, allowing
runtime configuration without code changes.
"""

import os
from dataclasses import dataclass, field
from typing import Dict, Optional

from .types import Provider, ProviderConfig


def get_env_int(key: str, default: int) -> int:
    """Get environment variable as integer with default fallback."""
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def get_env_float(key: str, default: float) -> float:
    """Get environment variable as float with default fallback."""
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def get_env_bool(key: str, default: bool) -> bool:
    """Get environment variable as boolean with default fallback."""
    value = os.environ.get(key)
    if value is None:
        return default
    return value.lower() in ('true', '1', 'yes', 'on')


@dataclass
class RateLimitingConfig:
    """
    Runtime configuration for the rate limiting system.

    All values have sensible defaults that can be overridden
    via environment variables.
    """

    # Global settings
    enabled: bool = True
    adaptive_enabled: bool = True
    queue_enabled: bool = True

    # Perplexity settings (start conservative - Tier 0)
    perplexity_default_rpm: int = 50
    perplexity_min_rpm: int = 10
    perplexity_max_rpm: int = 2000
    perplexity_sonar_pro_rpm: int = 50
    perplexity_deep_research_rpm: int = 5
    # Model-specific concurrency (per API key) - Perplexity has no explicit concurrency limit
    perplexity_sonar_pro_concurrent: int = 5  # Higher for sonar-pro (faster responses, higher RPM)
    perplexity_deep_research_concurrent: int = 2  # Lower for deep-research (slower, stricter limits)
    perplexity_per_key_concurrent: bool = True  # Enable per-API-key queue isolation

    # OpenAI settings (start conservative)
    openai_default_rpm: int = 100
    openai_min_rpm: int = 10
    openai_max_rpm: int = 10000
    openai_max_concurrent: int = 5  # Allow some parallelism

    # FindyMail settings
    findymail_default_rpm: int = 60
    findymail_min_rpm: int = 5
    findymail_max_rpm: int = 300
    findymail_concurrent_limit: int = 5
    findymail_max_concurrent: int = 5

    # Adaptive learning settings
    halve_on_429: bool = True
    recovery_increment: float = 0.10  # 10% increase on recovery
    success_threshold: int = 15  # Successes before rate increase attempt (reduced from 50)
    recovery_cooldown_seconds: int = 120  # 2 minutes (reduced from 5 minutes)
    # Time-based recovery: recover rate after elapsed time regardless of success count
    time_based_recovery_enabled: bool = True
    time_based_recovery_seconds: int = 180  # Recover after 3 min since last 429

    # Queue settings
    max_queue_size: int = 1000
    queue_timeout_seconds: float = 60.0

    # Circuit breaker settings
    circuit_breaker_enabled: bool = True
    circuit_breaker_threshold: int = 10  # Consecutive 429s before opening
    circuit_breaker_cooldown_seconds: int = 60

    @classmethod
    def from_env(cls) -> "RateLimitingConfig":
        """Load configuration from environment variables."""
        return cls(
            # Global
            enabled=get_env_bool('RATE_LIMITING_ENABLED', True),
            adaptive_enabled=get_env_bool('RATE_LIMITING_ADAPTIVE', True),
            queue_enabled=get_env_bool('RATE_LIMITING_QUEUE', True),

            # Perplexity
            perplexity_default_rpm=get_env_int('PERPLEXITY_DEFAULT_RPM', 50),
            perplexity_min_rpm=get_env_int('PERPLEXITY_MIN_RPM', 10),
            perplexity_max_rpm=get_env_int('PERPLEXITY_MAX_RPM', 2000),
            perplexity_sonar_pro_rpm=get_env_int('PERPLEXITY_SONAR_PRO_RPM', 50),
            perplexity_deep_research_rpm=get_env_int('PERPLEXITY_DEEP_RESEARCH_RPM', 5),
            perplexity_sonar_pro_concurrent=get_env_int('PERPLEXITY_SONAR_PRO_CONCURRENT', 5),
            perplexity_deep_research_concurrent=get_env_int('PERPLEXITY_DEEP_RESEARCH_CONCURRENT', 2),
            perplexity_per_key_concurrent=get_env_bool('PERPLEXITY_PER_KEY_CONCURRENT', True),

            # OpenAI
            openai_default_rpm=get_env_int('OPENAI_DEFAULT_RPM', 100),
            openai_min_rpm=get_env_int('OPENAI_MIN_RPM', 10),
            openai_max_rpm=get_env_int('OPENAI_MAX_RPM', 10000),
            openai_max_concurrent=get_env_int('OPENAI_MAX_CONCURRENT', 5),

            # FindyMail
            findymail_default_rpm=get_env_int('FINDYMAIL_DEFAULT_RPM', 60),
            findymail_min_rpm=get_env_int('FINDYMAIL_MIN_RPM', 5),
            findymail_max_rpm=get_env_int('FINDYMAIL_MAX_RPM', 300),
            findymail_concurrent_limit=get_env_int('FINDYMAIL_CONCURRENT_LIMIT', 5),
            findymail_max_concurrent=get_env_int('FINDYMAIL_MAX_CONCURRENT', 5),

            # Adaptive
            halve_on_429=get_env_bool('RATE_LIMIT_HALVE_ON_429', True),
            recovery_increment=get_env_float('RATE_LIMIT_RECOVERY_INCREMENT', 0.10),
            success_threshold=get_env_int('RATE_LIMIT_SUCCESS_THRESHOLD', 15),
            recovery_cooldown_seconds=get_env_int('RATE_LIMIT_RECOVERY_COOLDOWN', 120),
            time_based_recovery_enabled=get_env_bool('RATE_LIMIT_TIME_RECOVERY_ENABLED', True),
            time_based_recovery_seconds=get_env_int('RATE_LIMIT_TIME_RECOVERY_SECONDS', 180),

            # Queue
            max_queue_size=get_env_int('RATE_LIMIT_MAX_QUEUE', 1000),
            queue_timeout_seconds=get_env_float('RATE_LIMIT_QUEUE_TIMEOUT', 60.0),

            # Circuit breaker
            circuit_breaker_enabled=get_env_bool('RATE_LIMIT_CIRCUIT_BREAKER', True),
            circuit_breaker_threshold=get_env_int('RATE_LIMIT_CIRCUIT_BREAKER_THRESHOLD', 10),
            circuit_breaker_cooldown_seconds=get_env_int('RATE_LIMIT_CIRCUIT_BREAKER_COOLDOWN', 60),
        )

    def get_provider_config(self, provider: Provider, model: Optional[str] = None) -> ProviderConfig:
        """
        Get provider-specific configuration.

        Args:
            provider: The API provider
            model: Optional model name for model-specific config

        Returns:
            ProviderConfig for the specified provider
        """
        if provider == Provider.PERPLEXITY:
            # Model-specific defaults for Perplexity
            if model == "sonar-deep-research":
                default_rpm = self.perplexity_deep_research_rpm
            else:
                default_rpm = self.perplexity_sonar_pro_rpm

            return ProviderConfig(
                provider=provider,
                default_rpm=default_rpm,
                min_rpm=self.perplexity_min_rpm,
                max_rpm=self.perplexity_max_rpm,
                max_bucket_size=max(10, default_rpm // 6),
                adaptive_enabled=self.adaptive_enabled,
                recovery_window_seconds=self.recovery_cooldown_seconds,
                halve_on_429=self.halve_on_429,
                recovery_increment=self.recovery_increment,
                success_threshold=self.success_threshold,
            )

        elif provider == Provider.OPENAI:
            return ProviderConfig(
                provider=provider,
                default_rpm=self.openai_default_rpm,
                min_rpm=self.openai_min_rpm,
                max_rpm=self.openai_max_rpm,
                max_bucket_size=max(10, self.openai_default_rpm // 6),
                adaptive_enabled=self.adaptive_enabled,
                recovery_window_seconds=self.recovery_cooldown_seconds,
                halve_on_429=self.halve_on_429,
                recovery_increment=self.recovery_increment,
                success_threshold=self.success_threshold,
            )

        elif provider == Provider.FINDYMAIL:
            return ProviderConfig(
                provider=provider,
                default_rpm=self.findymail_default_rpm,
                min_rpm=self.findymail_min_rpm,
                max_rpm=self.findymail_max_rpm,
                max_bucket_size=self.findymail_concurrent_limit,
                adaptive_enabled=self.adaptive_enabled,
                recovery_window_seconds=60,  # FindyMail recovers faster
                halve_on_429=self.halve_on_429,
                recovery_increment=self.recovery_increment,
                success_threshold=20,  # Lower threshold for FindyMail
            )

        else:
            # Default fallback config
            return ProviderConfig(
                provider=provider,
                default_rpm=100,
                min_rpm=10,
                max_rpm=1000,
            )

    def get_max_concurrent(self, provider: Provider, model: Optional[str] = None) -> int:
        """
        Get maximum concurrent requests for a provider/model combination.

        Args:
            provider: API provider
            model: Optional model name for model-specific limits (e.g., sonar-deep-research)

        Returns:
            Maximum concurrent requests allowed
        """
        if provider == Provider.PERPLEXITY:
            # Model-specific concurrency for Perplexity
            if model == "sonar-deep-research":
                return self.perplexity_deep_research_concurrent
            else:
                # Default to sonar-pro concurrency for other models
                return self.perplexity_sonar_pro_concurrent
        elif provider == Provider.OPENAI:
            return self.openai_max_concurrent
        elif provider == Provider.FINDYMAIL:
            return self.findymail_max_concurrent
        return 1  # Default to serial

    def to_dict(self) -> Dict:
        """Convert config to dictionary for logging."""
        return {
            "enabled": self.enabled,
            "adaptive_enabled": self.adaptive_enabled,
            "queue_enabled": self.queue_enabled,
            "perplexity": {
                "default_rpm": self.perplexity_default_rpm,
                "sonar_pro_rpm": self.perplexity_sonar_pro_rpm,
                "deep_research_rpm": self.perplexity_deep_research_rpm,
                "sonar_pro_concurrent": self.perplexity_sonar_pro_concurrent,
                "deep_research_concurrent": self.perplexity_deep_research_concurrent,
                "per_key_concurrent": self.perplexity_per_key_concurrent,
            },
            "openai": {
                "default_rpm": self.openai_default_rpm,
                "max_concurrent": self.openai_max_concurrent,
            },
            "findymail": {
                "default_rpm": self.findymail_default_rpm,
                "concurrent_limit": self.findymail_concurrent_limit,
            },
            "adaptive": {
                "halve_on_429": self.halve_on_429,
                "recovery_increment": self.recovery_increment,
                "success_threshold": self.success_threshold,
                "cooldown_seconds": self.recovery_cooldown_seconds,
                "time_based_recovery_enabled": self.time_based_recovery_enabled,
                "time_based_recovery_seconds": self.time_based_recovery_seconds,
            },
            "circuit_breaker": {
                "enabled": self.circuit_breaker_enabled,
                "threshold": self.circuit_breaker_threshold,
                "cooldown_seconds": self.circuit_breaker_cooldown_seconds,
            },
        }


# Global configuration instance (lazy loaded)
_config: Optional[RateLimitingConfig] = None


def get_rate_limit_config() -> RateLimitingConfig:
    """
    Get the global rate limiting configuration.

    Loads from environment on first access.
    """
    global _config
    if _config is None:
        _config = RateLimitingConfig.from_env()
    return _config


def reset_config() -> None:
    """Reset configuration (for testing)."""
    global _config
    _config = None
