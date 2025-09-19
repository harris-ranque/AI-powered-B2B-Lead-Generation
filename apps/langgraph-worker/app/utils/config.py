"""
Configuration management for Genni LangGraph Worker
"""
import os
from functools import lru_cache
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    """Application settings"""
    
    # API Configuration
    # Prefer LANGGRAPH_API_KEY to align with Convex backend, fall back to API_KEY
    api_key: str = os.getenv("LANGGRAPH_API_KEY") or os.getenv("API_KEY", "default-secure-key-change-in-production")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    
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
        # Auto-construct webhook URL from Convex URL if not explicitly set
        if not self.webhook_url and self.convex_url:
            # Convert site URL to HTTP endpoint
            # e.g., "https://happy-horse-123.convex.site" -> "https://happy-horse-123.convex.site/webhooks/langgraph/email-completed"
            base_url = self.convex_url.rstrip('/')
            self.webhook_url = f"{base_url}/webhooks/langgraph/email-completed"
    
    # Server Configuration
    port: int = int(os.getenv("PORT_OPTIONAL", os.getenv("PORT", "8080")))
    environment: str = os.getenv("ENVIRONMENT", "development")
    debug: bool = os.getenv("DEBUG_OPTIONAL", "false").lower() == "true"
    
    # LangGraph Configuration
    langgraph_verbose: bool = os.getenv("LANGGRAPH_VERBOSE_OPTIONAL", "true").lower() == "true"
    max_execution_time: int = int(os.getenv("MAX_EXECUTION_TIME_OPTIONAL", "300"))  # 5 minutes
    
    # Model Configuration
    default_model: str = os.getenv("DEFAULT_MODEL_OPTIONAL", "gpt-4o-mini")
    temperature: float = float(os.getenv("TEMPERATURE_OPTIONAL", "0.7"))
    max_tokens: int = int(os.getenv("MAX_TOKENS_OPTIONAL", "8000"))
    
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
    """Validate that required settings are present"""
    settings = get_settings()
    
    required_fields = {
        "openai_api_key": "OpenAI API key is required"
    }
    
    missing = []
    for field, message in required_fields.items():
        if not getattr(settings, field):
            missing.append(message)
    
    # Check that either webhook_url or convex_url is provided
    if not settings.webhook_url and not settings.convex_url:
        missing.append("Either WEBHOOK_URL or CONVEX_URL is required for result callbacks")
    
    if missing:
        raise ValueError(f"Missing required configuration: {', '.join(missing)}")
    
    return settings
