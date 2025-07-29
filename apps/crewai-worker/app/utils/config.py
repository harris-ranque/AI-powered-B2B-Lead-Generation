"""
Configuration management for Genni CrewAI Worker
"""
import os
from functools import lru_cache
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    """Application settings"""
    
    # API Configuration
    api_key: str = os.getenv("API_KEY", "default-secure-key-change-in-production")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    
    # Webhook Configuration
    webhook_url: str = os.getenv("WEBHOOK_URL", "")
    
    # Server Configuration
    port: int = int(os.getenv("PORT", "8080"))
    environment: str = os.getenv("ENVIRONMENT", "development")
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # CrewAI Configuration
    crew_verbose: bool = os.getenv("CREW_VERBOSE", "true").lower() == "true"
    max_execution_time: int = int(os.getenv("MAX_EXECUTION_TIME", "300"))  # 5 minutes
    
    # Model Configuration
    default_model: str = os.getenv("DEFAULT_MODEL", "gpt-4o-mini")
    temperature: float = float(os.getenv("TEMPERATURE", "0.7"))
    max_tokens: int = int(os.getenv("MAX_TOKENS", "2000"))
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()

def validate_required_settings():
    """Validate that required settings are present"""
    settings = get_settings()
    
    required_fields = {
        "openai_api_key": "OpenAI API key is required",
        "webhook_url": "Webhook URL is required for result callbacks"
    }
    
    missing = []
    for field, message in required_fields.items():
        if not getattr(settings, field):
            missing.append(message)
    
    if missing:
        raise ValueError(f"Missing required configuration: {', '.join(missing)}")
    
    return settings