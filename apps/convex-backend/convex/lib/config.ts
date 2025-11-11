/**
 * Environment-based configuration for Genni
 * Allows runtime configuration via environment variables
 */

// Helper function to parse environment variables with defaults
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

// Credit Cost Configuration - Per-Lead Model
export const CREDIT_COSTS = {
  // Per-lead costs for search operations
  LEAD_DISCOVERY: getEnvNumber('CREDIT_COST_LEAD_DISCOVERY', 0), // Free - discovery included
  EMAIL_ENRICHMENT: getEnvNumber('CREDIT_COST_EMAIL_ENRICHMENT', 0), // Free - enrichment included
  AI_ANALYSIS_TIER2: getEnvNumber('CREDIT_COST_AI_ANALYSIS_TIER2', 1), // 1 credit per lead (Tavily research)
  AI_ANALYSIS_TIER3: getEnvNumber('CREDIT_COST_AI_ANALYSIS_TIER3', 2), // 2 credits per lead (Perplexity deep research)

  // Email generation features
  EMAIL_GENERATION: getEnvNumber('CREDIT_COST_EMAIL_GENERATION', 3),
  EMAIL_SEQUENCE: getEnvNumber('CREDIT_COST_EMAIL_SEQUENCE', 5),
} as const;

// Deep Research Configuration
export const DEEP_RESEARCH_CONFIG = {
  // Minimum user tier required for deep research
  MINIMUM_TIER: getEnvString('DEEP_RESEARCH_MIN_TIER', 'pro'), // 'free', 'pro', 'enterprise'
  
  // Confidence threshold - trigger deep research below this score
  CONFIDENCE_THRESHOLD: getEnvFloat('DEEP_RESEARCH_CONFIDENCE_THRESHOLD', 0.5),
  
  // Data completeness threshold - trigger deep research below this score
  DATA_COMPLETENESS_THRESHOLD: getEnvFloat('DEEP_RESEARCH_DATA_THRESHOLD', 0.6),
  
  // Minimum missing data points to trigger deep research
  MIN_MISSING_DATA_POINTS: getEnvNumber('DEEP_RESEARCH_MIN_MISSING_POINTS', 3),
  
  // High-value lead threshold (in USD) - always trigger deep research above this
  HIGH_VALUE_THRESHOLD: getEnvNumber('DEEP_RESEARCH_HIGH_VALUE_THRESHOLD', 1000),
  
  // Enable/disable deep research globally
  ENABLED: getEnvBoolean('DEEP_RESEARCH_ENABLED', true),
} as const;

// Rate Limiting Configuration
export const RATE_LIMITS = {
  SEARCH_PER_HOUR: getEnvNumber('RATE_LIMIT_SEARCH_PER_HOUR', 10),
  EMAIL_GENERATION_PER_HOUR: getEnvNumber('RATE_LIMIT_EMAIL_PER_HOUR', 50),
  API_REQUESTS_PER_MINUTE: getEnvNumber('RATE_LIMIT_API_PER_MINUTE', 100),
  DEEP_RESEARCH_PER_DAY: getEnvNumber('RATE_LIMIT_DEEP_RESEARCH_PER_DAY', 20),
} as const;

// Business Rules Configuration
export const BUSINESS_CONFIG = {
  CREDITS: {
    FREE_TRIAL_AMOUNT: getEnvNumber('CREDITS_FREE_TRIAL_AMOUNT', 50),
    LOW_CREDIT_THRESHOLD: getEnvNumber('CREDITS_LOW_THRESHOLD', 10),
    MONTHLY_REFRESH_DAY: getEnvNumber('CREDITS_MONTHLY_REFRESH_DAY', 1),
  },
  
  SEARCH: {
    MIN_RADIUS: getEnvNumber('SEARCH_MIN_RADIUS', 1000),
    MAX_RADIUS: getEnvNumber('SEARCH_MAX_RADIUS', 50000),
    MAX_KEYWORDS: getEnvNumber('SEARCH_MAX_KEYWORDS', 10),
    MAX_EXCLUDE_TERMS: getEnvNumber('SEARCH_MAX_EXCLUDE_TERMS', 5),
    MAX_RESULTS_FREE: getEnvNumber('SEARCH_MAX_RESULTS_FREE', 25),
    MAX_RESULTS_PRO: getEnvNumber('SEARCH_MAX_RESULTS_PRO', 100),
    MAX_RESULTS_ENTERPRISE: getEnvNumber('SEARCH_MAX_RESULTS_ENTERPRISE', 500),
  },
} as const;

// Data Validation Configuration  
export const DATA_VALIDATION_CONFIG = {
  // Required data points for base research
  REQUIRED_DATA_POINTS: [
    'annual_revenue',
    'employee_count', 
    'leadership_names',
    'recent_news',
    'funding_investments'
  ] as const,
  
  // Minimum score to consider data complete (0.0 - 1.0)
  MIN_COMPLETENESS_SCORE: getEnvFloat('DATA_VALIDATION_MIN_SCORE', 0.6),
  
  // Recent news time window (in months)
  RECENT_NEWS_MONTHS: getEnvNumber('DATA_VALIDATION_NEWS_MONTHS', 6),
} as const;

// AI Configuration
export const AI_CONFIG = {
  CONFIDENCE_THRESHOLDS: {
    LOW: getEnvFloat('AI_CONFIDENCE_LOW', 0.3),
    MEDIUM: getEnvFloat('AI_CONFIDENCE_MEDIUM', 0.6),
    HIGH: getEnvFloat('AI_CONFIDENCE_HIGH', 0.8),
  },
  
  RELEVANCE_WEIGHTS: {
    PAIN_POINTS: getEnvFloat('AI_WEIGHT_PAIN_POINTS', 0.4),
    VALUE_MATCHES: getEnvFloat('AI_WEIGHT_VALUE_MATCHES', 0.3),
    CONFIDENCE: getEnvFloat('AI_WEIGHT_CONFIDENCE', 0.3),
  },
  
  TIMEOUTS: {
    BASIC_RESEARCH: getEnvNumber('AI_TIMEOUT_BASIC', 30000), // 30 seconds
    DEEP_RESEARCH: getEnvNumber('AI_TIMEOUT_DEEP', 120000), // 2 minutes
  },
} as const;

// Environment detection
export const ENVIRONMENT = {
  IS_PRODUCTION: getEnvString('NODE_ENV', 'development') === 'production',
  IS_DEVELOPMENT: getEnvString('NODE_ENV', 'development') === 'development',
  IS_TEST: getEnvString('NODE_ENV', 'development') === 'test',
} as const;

// Log configuration values (only in development)
if (ENVIRONMENT.IS_DEVELOPMENT) {
  console.log('🔧 Configuration loaded:', {
    creditCosts: CREDIT_COSTS,
    deepResearch: DEEP_RESEARCH_CONFIG,
    rateLimits: RATE_LIMITS,
    environment: ENVIRONMENT.IS_PRODUCTION ? 'production' : 'development',
  });
}