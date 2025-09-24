# Configuration Guide

This document outlines all configurable environment variables for the Genni system.

## Overview

Genni uses environment variables to configure credit costs, deep research behavior, rate limiting, and other business rules. This allows for runtime configuration without code changes.

## Environment Files

- **Convex Backend**: `apps/convex-backend/.env.local` (see `.env.example`)
- **LangGraph Worker**: `apps/langgraph-worker/.env` (see `.env.example`)

## Required API Keys

### Core Services
- **OPENAI_API_KEY**: Required for all AI operations (format: `sk-...`)
- **CONVEX_URL**: Your Convex deployment URL
- **LANGGRAPH_API_KEY**: Secure key for communication between services

### Research Services (for Deep Research)
- **TAVILY_API_KEY**: For basic web research (format: `tvly-...`)
- **PERPLEXITY_API_KEY**: For deep research operations (format: `pplx-...`)

### Authentication & Payments
- **CLERK_SECRET_KEY**: For user authentication (format: `sk_...`)
- **STRIPE_SECRET_KEY**: For payment processing (format: `sk_...`)

### Data Enrichment
- **GOOGLE_MAPS_API_KEY**: For business discovery
- **FINDYMAIL_API_KEY**: For email enrichment

### Optional Services
- **LANGSMITH_API_KEY**: For debugging and tracing (format: `ls_...`)
- **LANGCHAIN_TRACING_V2**: Set to `true` to enable LangSmith tracing

## Credit Cost Configuration

Control the credit costs for different operations:

```bash
# Base credit costs for each operation
CREDIT_COST_SEARCH=1                # Lead search operations
CREDIT_COST_LEAD_ENRICHMENT=2       # FindyMail email enrichment
CREDIT_COST_EMAIL_GENERATION=3      # Email template generation
CREDIT_COST_EMAIL_SEQUENCE=5        # Follow-up sequence generation
CREDIT_COST_AI_ANALYSIS=2           # Base AI analysis cost
CREDIT_COST_DEEP_RESEARCH=5         # Additional cost for Perplexity deep research
```

### Total Costs Examples
- **Standard AI Analysis**: 2 credits
- **AI Analysis with Deep Research**: 7 credits (2 + 5)
- **Complete Lead Generation**: 10 credits (1 search + 2 enrichment + 7 AI analysis with deep research)

## Deep Research Configuration

Control when and how deep research is triggered:

```bash
# Global enable/disable
DEEP_RESEARCH_ENABLED=true

# User tier requirements
DEEP_RESEARCH_MIN_TIER=pro          # free, pro, enterprise

# Trigger thresholds
DEEP_RESEARCH_CONFIDENCE_THRESHOLD=0.5      # Trigger below this confidence (0.0-1.0)
DEEP_RESEARCH_DATA_THRESHOLD=0.6            # Trigger below this data completeness (0.0-1.0)
DEEP_RESEARCH_MIN_MISSING_POINTS=3          # Trigger when missing this many data points (1-5)
DEEP_RESEARCH_HIGH_VALUE_THRESHOLD=1000     # Always trigger above this lead value (USD)
```

### Deep Research Triggers

Deep research is automatically triggered when ANY of these conditions are met:
1. **Low Confidence**: Research confidence score < 0.5 (configurable)
2. **Missing Data**: Missing ≥3 of 5 required data points (configurable)
3. **Poor Data Quality**: Data completeness score < 0.6 (configurable)
4. **High-Value Lead**: Lead value ≥ $1000 (configurable)
5. **Basic Research Failure**: Initial research fails completely

### Required Data Points

The system validates for these 5 data points:
1. **Annual Revenue**: Company financial information
2. **Employee Count**: Company size/headcount
3. **Leadership Names**: Key executives and founders
4. **Recent News**: Company news within 6 months (configurable)
5. **Funding/Investments**: Investment history and funding rounds

## Rate Limiting Configuration

Control API usage limits per user tier:

```bash
RATE_LIMIT_SEARCH_PER_HOUR=10           # Lead searches per hour
RATE_LIMIT_EMAIL_PER_HOUR=50            # Email generations per hour
RATE_LIMIT_API_PER_MINUTE=100           # General API requests per minute
RATE_LIMIT_DEEP_RESEARCH_PER_DAY=20     # Deep research operations per day
```

## Business Rules Configuration

Core business logic settings:

```bash
# Credit system
CREDITS_FREE_TRIAL_AMOUNT=50        # Initial free credits
CREDITS_LOW_THRESHOLD=10            # Low credit warning threshold
CREDITS_MONTHLY_REFRESH_DAY=1       # Day of month for credit refresh

# Search limits by tier
SEARCH_MAX_RESULTS_FREE=25          # Max results for free users
SEARCH_MAX_RESULTS_PRO=100          # Max results for pro users
SEARCH_MAX_RESULTS_ENTERPRISE=500   # Max results for enterprise users

# Geographic constraints
SEARCH_MIN_RADIUS=1000              # Minimum search radius (meters)
SEARCH_MAX_RADIUS=50000             # Maximum search radius (meters)
```

## Data Validation Configuration

Control data quality assessment:

```bash
DATA_VALIDATION_MIN_SCORE=0.6       # Minimum score to avoid deep research
DATA_VALIDATION_NEWS_MONTHS=6       # Recent news time window
```

## AI Configuration

AI model behavior and thresholds:

```bash
# Confidence level thresholds
AI_CONFIDENCE_LOW=0.3               # Low confidence threshold
AI_CONFIDENCE_MEDIUM=0.6            # Medium confidence threshold
AI_CONFIDENCE_HIGH=0.8              # High confidence threshold

# Relevance scoring weights (should sum to 1.0)
AI_WEIGHT_PAIN_POINTS=0.4           # Weight for pain point matching
AI_WEIGHT_VALUE_MATCHES=0.3         # Weight for value proposition matching
AI_WEIGHT_CONFIDENCE=0.3            # Weight for overall confidence

# Timeout settings
AI_TIMEOUT_BASIC=30000              # Basic research timeout (ms)
AI_TIMEOUT_DEEP=120000              # Deep research timeout (ms)
```

## Environment Detection

```bash
NODE_ENV=development                # development, production, test
```

## Configuration Examples

### Cost-Optimized Setup
For reducing costs, increase thresholds to trigger less deep research:
```bash
DEEP_RESEARCH_CONFIDENCE_THRESHOLD=0.3    # Lower threshold
DEEP_RESEARCH_DATA_THRESHOLD=0.4          # Lower threshold  
DEEP_RESEARCH_MIN_MISSING_POINTS=4        # Require more missing data
DEEP_RESEARCH_HIGH_VALUE_THRESHOLD=2000   # Higher value threshold
```

### Quality-Focused Setup
For maximum research quality, lower thresholds:
```bash
DEEP_RESEARCH_CONFIDENCE_THRESHOLD=0.7    # Higher threshold
DEEP_RESEARCH_DATA_THRESHOLD=0.8          # Higher threshold
DEEP_RESEARCH_MIN_MISSING_POINTS=2        # Trigger with less missing data
DEEP_RESEARCH_HIGH_VALUE_THRESHOLD=500    # Lower value threshold
```

### Enterprise Setup
For high-volume enterprise usage:
```bash
RATE_LIMIT_SEARCH_PER_HOUR=50
RATE_LIMIT_EMAIL_PER_HOUR=200
RATE_LIMIT_DEEP_RESEARCH_PER_DAY=100
SEARCH_MAX_RESULTS_ENTERPRISE=1000
```

## Implementation Notes

- **Environment variables override defaults** - If not set, sensible defaults are used
- **Both services must be configured** - Credit costs should match between Convex backend and LangGraph worker
- **Real-time updates** - Most changes require service restart to take effect
- **Validation** - Invalid values fall back to defaults with console warnings
- **Production recommendations** - Use stricter rate limits and higher thresholds in production

## Testing Configuration

To test configuration changes:

```bash
# Test Python worker config
cd apps/langgraph-worker
CREDIT_COST_AI_ANALYSIS=3 python3 -c "from app.config import CREDIT_COSTS; print(CREDIT_COSTS['AI_ANALYSIS'])"

# Test TypeScript backend config  
cd apps/convex-backend
npx convex dev  # Check console for config logging
```

## Security Considerations

- **Never commit actual .env files** - Use .env.example templates
- **Protect production values** - Use secure environment variable management
- **Monitor cost changes** - Track credit usage when adjusting costs
- **Audit configuration** - Log configuration changes in production