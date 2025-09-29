"""
Configuration management for Genni LangGraph Worker
"""
import os
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse, urlunparse

from pydantic_settings import BaseSettings
from pydantic import Field


def _ensure_convex_webhook_path(url: str) -> str:
    """Ensure Convex webhook URLs use the correct path format (no /api/http prefix needed)."""
    if not url:
        return url

    parsed = urlparse(url)
    path = parsed.path or ""
    if not path.startswith("/"):
        path = f"/{path}"

    # Remove any incorrect /api/http prefix if present
    if path.startswith("/api/http/"):
        path = path.replace("/api/http/", "/", 1)
    elif path.startswith("/api/"):
        # Only remove /api/ if it's not part of the correct webhook path
        if not path.startswith("/api/webhooks/"):
            path = path.replace("/api/", "/", 1)

    # Ensure webhooks paths start with /webhooks/
    if not path.startswith("/webhooks/") and not path.startswith("/api/"):
        if path.startswith("/"):
            path = f"/webhooks{path}"
        else:
            path = f"/webhooks/{path}"

    # Collapse any accidental duplicate slashes
    while "//" in path:
        path = path.replace("//", "/")

    normalized = parsed._replace(path=path)
    return urlunparse(normalized)

class Settings(BaseSettings):
    """Application settings"""

    # API Configuration
    # Standardized to LANGGRAPH_API_KEY for consistency with Convex backend
    api_key: str = Field(default="")
    openai_api_key: str = Field(default="")
    
    # Research API Configuration
    tavily_api_key: Optional[str] = os.getenv("TAVILY_API_KEY", None)
    exa_api_key: Optional[str] = os.getenv("EXA_API_KEY", None)
    perplexity_api_key: Optional[str] = os.getenv("PERPLEXITY_API_KEY", None)
    
    # Tavily-specific Configuration
    tavily_max_results: int = int(os.getenv("TAVILY_MAX_RESULTS", "5"))
    tavily_topic: str = os.getenv("TAVILY_TOPIC", "general")  # general, news, finance
    tavily_include_answer: bool = os.getenv("TAVILY_INCLUDE_ANSWER", "true").lower() == "true"
    tavily_include_raw_content: bool = os.getenv("TAVILY_INCLUDE_RAW_CONTENT", "false").lower() == "true"
    tavily_search_depth: str = os.getenv("TAVILY_SEARCH_DEPTH", "basic")  # basic, advanced
    tavily_timeout: float = float(os.getenv("TAVILY_TIMEOUT", "5.0"))
    tavily_include_images: bool = os.getenv("TAVILY_INCLUDE_IMAGES", "false").lower() == "true"
    
    # Convex Configuration
    convex_url: str = os.getenv("CONVEX_URL", "")
    
    # Webhook Configuration (auto-constructed from Convex URL if not provided)
    webhook_url: str = ""
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # Load API key from environment - LANGGRAPH_API_KEY only (standardized)
        if not self.api_key:
            self.api_key = os.getenv("LANGGRAPH_API_KEY", "")

        # Load OpenAI API key from environment
        if not self.openai_api_key:
            self.openai_api_key = os.getenv("OPENAI_API_KEY", "")

        # Normalize explicit webhook value first to ensure correct path format
        if self.webhook_url:
            self.webhook_url = _ensure_convex_webhook_path(self.webhook_url.rstrip('/'))

        # Auto-construct webhook URL from Convex URL if not explicitly set
        if not self.webhook_url and self.convex_url:
            base_url = self.convex_url.rstrip('/')
            # Convert .convex.cloud to .convex.site for HTTP endpoints
            if '.convex.cloud' in base_url:
                base_url = base_url.replace('.convex.cloud', '.convex.site')
            if base_url.endswith("/api"):
                base_url = base_url[:-4]
            constructed = f"{base_url}/webhooks/langgraph/email-completed"
            self.webhook_url = _ensure_convex_webhook_path(constructed)
    
    # Server Configuration
    port: int = int(os.getenv("PORT_OPTIONAL", os.getenv("PORT", "8080")))
    environment: str = os.getenv("ENVIRONMENT", "development")
    debug: bool = os.getenv("DEBUG_OPTIONAL", "false").lower() == "true"
    
    # LangGraph Configuration
    langgraph_verbose: bool = os.getenv("CREW_VERBOSE_OPTIONAL", os.getenv("LANGGRAPH_VERBOSE_OPTIONAL", "true")).lower() == "true"
    max_execution_time: int = int(os.getenv("MAX_EXECUTION_TIME_OPTIONAL", "300"))  # 5 minutes
    
    # Model Configuration
    default_model: str = os.getenv("DEFAULT_MODEL", "gpt-5-nano")

    @property
    def temperature(self) -> float:
        """Get temperature with fallback handling"""
        temp_str = os.getenv("TEMPERATURE_OPTIONAL", os.getenv("TEMPERATURE", "0.7"))
        try:
            if temp_str == "" or temp_str is None:
                return 0.7
            return float(temp_str)
        except (ValueError, TypeError):
            return 0.7

    @property
    def max_tokens(self) -> int:
        """Get max_tokens with fallback handling"""
        tokens_str = os.getenv("MAX_TOKENS_OPTIONAL", os.getenv("MAX_TOKENS", "2000"))
        try:
            if tokens_str == "" or tokens_str is None:
                return 2000
            return int(tokens_str)
        except (ValueError, TypeError):
            return 2000
    
    # Sentry Configuration
    sentry_dsn: Optional[str] = os.getenv("SENTRY_DSN", None)
    sentry_traces_sample_rate: float = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
    sentry_enable_logs: bool = os.getenv("SENTRY_ENABLE_LOGS", "true").lower() == "true"
    
    # Research Configuration
    default_research_tier: str = os.getenv("DEFAULT_RESEARCH_TIER", "tavily")
    confidence_threshold_tier2: int = int(os.getenv("CONFIDENCE_THRESHOLD_TIER2", "60"))
    confidence_threshold_tier3: int = int(os.getenv("CONFIDENCE_THRESHOLD_TIER3", "40"))
    premium_research_min_value: float = float(os.getenv("PREMIUM_RESEARCH_MIN_VALUE", "1000"))
    max_research_time: int = int(os.getenv("MAX_RESEARCH_TIME", "30"))
    enable_competitor_discovery: bool = os.getenv("ENABLE_COMPETITOR_DISCOVERY", "true").lower() == "true"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()

def validate_required_settings():
    """Validate that required settings are present and secure"""
    settings = get_settings()

    missing = []

    # Validate API key (LANGGRAPH_API_KEY)
    if not settings.api_key:
        missing.append("LANGGRAPH_API_KEY is required for webhook authentication")
    elif settings.api_key == "default-secure-key-change-in-production":
        raise ValueError(
            "LANGGRAPH_API_KEY is still set to the default insecure value. "
            "Please set a secure API key in your environment."
        )
    elif len(settings.api_key) < 32:
        raise ValueError(
            f"LANGGRAPH_API_KEY is too short ({len(settings.api_key)} chars). "
            "For security, please use at least 32 characters."
        )

    # Validate OpenAI API key
    if not settings.openai_api_key:
        missing.append("OPENAI_API_KEY is required for AI operations")
    elif settings.openai_api_key == "test-openai-key":
        raise ValueError(
            "OPENAI_API_KEY is still set to a test value. "
            "Please set your actual OpenAI API key."
        )

    # Check that either webhook_url or convex_url is provided
    if not settings.webhook_url and not settings.convex_url:
        missing.append("Either WEBHOOK_URL or CONVEX_URL is required for result callbacks")

    if missing:
        raise ValueError(f"Missing required configuration: {', '.join(missing)}")

    return settings
