"""
Environment-based configuration for LangGraph Worker
Allows runtime configuration via environment variables
"""

import os
from typing import Dict, Any

def get_env_int(key: str, default: int) -> int:
    """Get environment variable as integer with default fallback"""
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default

def get_env_float(key: str, default: float) -> float:
    """Get environment variable as float with default fallback"""
    value = os.environ.get(key)
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default

def get_env_bool(key: str, default: bool) -> bool:
    """Get environment variable as boolean with default fallback"""
    value = os.environ.get(key)
    if value is None:
        return default
    return value.lower() in ('true', '1', 'yes', 'on')

def get_env_str(key: str, default: str) -> str:
    """Get environment variable as string with default fallback"""
    return os.environ.get(key, default)

# Credit Cost Configuration
CREDIT_COSTS = {
    'SEARCH': get_env_int('CREDIT_COST_SEARCH', 1),
    'LEAD_ENRICHMENT': get_env_int('CREDIT_COST_LEAD_ENRICHMENT', 2),
    'EMAIL_GENERATION': get_env_int('CREDIT_COST_EMAIL_GENERATION', 3),
    'EMAIL_SEQUENCE': get_env_int('CREDIT_COST_EMAIL_SEQUENCE', 5),
    'AI_ANALYSIS': get_env_int('CREDIT_COST_AI_ANALYSIS', 2),
    'DEEP_RESEARCH': get_env_int('CREDIT_COST_DEEP_RESEARCH', 5),
}

# Deep Research Configuration
# Triggers ONLY when Sonar Pro fails to get sufficient data (data quality-based escalation)
DEEP_RESEARCH_CONFIG = {
    # Trigger if confidence is low after Sonar Pro
    # With Sonar Pro, we expect 0.7-0.9 confidence - trigger deep research if <0.6
    'CONFIDENCE_THRESHOLD': get_env_float('DEEP_RESEARCH_CONFIDENCE_THRESHOLD', 0.6),

    # Trigger if data is incomplete after Sonar Pro
    # With Sonar Pro, we expect 0.8+ data completeness - trigger deep research if <0.7
    'DATA_COMPLETENESS_THRESHOLD': get_env_float('DEEP_RESEARCH_DATA_THRESHOLD', 0.7),

    # Trigger if missing 2+ of 5 data points after Sonar Pro
    # With Sonar Pro, we expect 4-5/5 data points - trigger deep research if ≤2/5 missing
    'MIN_MISSING_DATA_POINTS': get_env_int('DEEP_RESEARCH_MIN_MISSING_POINTS', 2),

    # Enable/disable deep research globally
    'ENABLED': get_env_bool('DEEP_RESEARCH_ENABLED', True),
}

# Data Validation Configuration  
DATA_VALIDATION_CONFIG = {
    # Required data points for base research
    'REQUIRED_DATA_POINTS': [
        'annual_revenue',
        'employee_count', 
        'leadership_names',
        'recent_news',
        'funding_investments'
    ],
    
    # Minimum score to consider data complete (0.0 - 1.0)
    'MIN_COMPLETENESS_SCORE': get_env_float('DATA_VALIDATION_MIN_SCORE', 0.6),
    
    # Recent news time window (in months)
    'RECENT_NEWS_MONTHS': get_env_int('DATA_VALIDATION_NEWS_MONTHS', 6),
}

# AI Configuration
AI_CONFIG = {
    'CONFIDENCE_THRESHOLDS': {
        'LOW': get_env_float('AI_CONFIDENCE_LOW', 0.3),
        'MEDIUM': get_env_float('AI_CONFIDENCE_MEDIUM', 0.6),
        'HIGH': get_env_float('AI_CONFIDENCE_HIGH', 0.8),
    },
    
    'TIMEOUTS': {
        'BASIC_RESEARCH': get_env_int('AI_TIMEOUT_BASIC', 30000),  # 30 seconds
        'DEEP_RESEARCH': get_env_int('AI_TIMEOUT_DEEP', 120000),  # 2 minutes
    },
}

# Perplexity API Rate Limiting Configuration
# Defaults to Tier 5 limits (most generous) - BYOK clients likely have high tiers
# Lower-tier users will hit 429s but retry logic handles this gracefully
# Clients can override via environment variables if needed
PERPLEXITY_RATE_LIMIT_CONFIG = {
    # Rate limits by model (requests per minute) - Tier 5 defaults
    # Tier 5 ($5000+ credits): sonar-pro=2000 RPM, deep-research=100 RPM
    # Retry logic with exponential backoff handles lower-tier users who hit 429s
    'SONAR_PRO_RPM': get_env_int('PERPLEXITY_SONAR_PRO_RPM', 2000),
    'DEEP_RESEARCH_RPM': get_env_int('PERPLEXITY_DEEP_RESEARCH_RPM', 100),

    # Retry configuration for rate limit errors
    'MAX_RETRIES': get_env_int('PERPLEXITY_MAX_RETRIES', 4),
    'BASE_DELAY_MS': get_env_int('PERPLEXITY_BASE_DELAY_MS', 2000),
    'MAX_DELAY_MS': get_env_int('PERPLEXITY_MAX_DELAY_MS', 30000),

    # Jitter range for backoff (prevents thundering herd)
    'JITTER_MIN': get_env_float('PERPLEXITY_JITTER_MIN', 0.8),
    'JITTER_MAX': get_env_float('PERPLEXITY_JITTER_MAX', 1.2),

    # Timeout configuration
    'TIMEOUT_RETRY_ONCE': get_env_bool('PERPLEXITY_TIMEOUT_RETRY_ONCE', True),
}

# Environment detection
ENVIRONMENT = {
    'IS_PRODUCTION': get_env_str('NODE_ENV', 'development') == 'production',
    'IS_DEVELOPMENT': get_env_str('NODE_ENV', 'development') == 'development',
    'IS_TEST': get_env_str('NODE_ENV', 'development') == 'test',
}

# Log configuration in development
if ENVIRONMENT['IS_DEVELOPMENT']:
    print(f"🔧 LangGraph Worker Configuration loaded:")
    print(f"   Credit Costs: {CREDIT_COSTS}")
    print(f"   Deep Research: {DEEP_RESEARCH_CONFIG}")
    print(f"   Perplexity Rate Limits: sonar-pro={PERPLEXITY_RATE_LIMIT_CONFIG['SONAR_PRO_RPM']} RPM, deep-research={PERPLEXITY_RATE_LIMIT_CONFIG['DEEP_RESEARCH_RPM']} RPM")
    print(f"   Environment: {'production' if ENVIRONMENT['IS_PRODUCTION'] else 'development'}")
