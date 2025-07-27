// API Configuration
export const API_CONFIG = {
  GOOGLE_MAPS: {
    BASE_URL: "https://maps.googleapis.com/maps/api",
    ENDPOINTS: {
      PLACES_SEARCH: "/place/nearbysearch/json",
      PLACE_DETAILS: "/place/details/json",
      GEOCODING: "/geocode/json",
    },
    MAX_RESULTS_PER_REQUEST: 20,
    MAX_RADIUS: 50000, // 50km in meters
  },
  
  FINDYMAIL: {
    BASE_URL: "https://api.findymail.com/v1",
    ENDPOINTS: {
      SEARCH_EMAILS: "/search",
      VERIFY_EMAIL: "/verify",
      BULK_SEARCH: "/bulk-search",
    },
    RATE_LIMIT: 100, // requests per minute
  },
  
  CREWAI_WORKER: {
    ENDPOINTS: {
      GENERATE_EMAIL: "/generate-email",
      ANALYZE_LEAD: "/analyze-lead",
      HEALTH_CHECK: "/health",
      STATUS: "/status",
    },
    TIMEOUT: 120000, // 2 minutes
  },
  
  STRIPE: {
    WEBHOOK_TOLERANCE: 300, // 5 minutes
    PRODUCTS: {
      PRO_MONTHLY: "price_pro_monthly",
      PRO_YEARLY: "price_pro_yearly",
      ENTERPRISE_MONTHLY: "price_enterprise_monthly",
      ENTERPRISE_YEARLY: "price_enterprise_yearly",
    },
  },
} as const;

// Business Rules
export const BUSINESS_RULES = {
  SEARCH: {
    MIN_RADIUS: 1000, // 1km
    MAX_RADIUS: 50000, // 50km
    MAX_KEYWORDS: 10,
    MAX_EXCLUDE_TERMS: 5,
    MAX_RESULTS_FREE: 25,
    MAX_RESULTS_PRO: 100,
    MAX_RESULTS_ENTERPRISE: 500,
  },
  
  CREDITS: {
    FREE_TRIAL_AMOUNT: 50,
    LOW_CREDIT_THRESHOLD: 10,
    MONTHLY_REFRESH_DAY: 1, // 1st of each month
  },
  
  EMAIL: {
    MAX_SUBJECT_LENGTH: 100,
    MAX_BODY_LENGTH: 5000,
    MAX_PERSONALIZATION_NOTES: 10,
    FOLLOW_UP_DELAY_HOURS: 72,
  },
  
  PROFILE: {
    MAX_SERVICES: 20,
    MAX_TARGET_MARKETS: 15,
    MAX_DIFFERENTIATORS: 10,
    MAX_CASE_STUDIES: 5,
  },
  
  RATE_LIMITS: {
    SEARCH_PER_HOUR: 10,
    EMAIL_GENERATION_PER_HOUR: 50,
    API_REQUESTS_PER_MINUTE: 100,
  },
} as const;

// Status Constants
export const STATUS = {
  SEARCH: {
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "cancelled",
  },
  
  LEAD: {
    NEW: "new",
    QUALIFIED: "qualified",
    CONTACTED: "contacted",
    NURTURING: "nurturing",
    CONVERTED: "converted",
    UNQUALIFIED: "unqualified",
  },
  
  ENRICHMENT: {
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    FAILED: "failed",
  },
  
  EMAIL: {
    GENERATED: "generated",
    REVIEWED: "reviewed",
    SENT: "sent",
    RESPONDED: "responded",
  },
  
  BILLING: {
    ACTIVE: "active",
    CANCELLED: "cancelled",
    PAST_DUE: "past_due",
    UNPAID: "unpaid",
  },
  
  CREWAI: {
    PENDING: "pending",
    PROCESSING: "processing",
    COMPLETED: "completed",
    FAILED: "failed",
  },
} as const;

// Error Codes
export const ERROR_CODES = {
  // Authentication
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_TOKEN: "INVALID_TOKEN",
  
  // User Management
  USER_NOT_FOUND: "USER_NOT_FOUND",
  EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
  INVALID_USER_DATA: "INVALID_USER_DATA",
  
  // Credits & Billing
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
  PLAN_LIMIT_EXCEEDED: "PLAN_LIMIT_EXCEEDED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  SUBSCRIPTION_INVALID: "SUBSCRIPTION_INVALID",
  
  // Search & Leads
  INVALID_SEARCH_PARAMS: "INVALID_SEARCH_PARAMS",
  GOOGLE_MAPS_ERROR: "GOOGLE_MAPS_ERROR",
  LEAD_NOT_FOUND: "LEAD_NOT_FOUND",
  ENRICHMENT_FAILED: "ENRICHMENT_FAILED",
  
  // AI & Email Generation
  CREWAI_TIMEOUT: "CREWAI_TIMEOUT",
  CREWAI_ERROR: "CREWAI_ERROR",
  EMAIL_GENERATION_FAILED: "EMAIL_GENERATION_FAILED",
  INVALID_EMAIL_PARAMS: "INVALID_EMAIL_PARAMS",
  
  // External APIs
  FINDYMAIL_ERROR: "FINDYMAIL_ERROR",
  STRIPE_WEBHOOK_ERROR: "STRIPE_WEBHOOK_ERROR",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  
  // General
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CONCURRENT_UPDATE: "CONCURRENT_UPDATE",
} as const;

// Email Templates
export const EMAIL_TEMPLATES = {
  WELCOME: {
    subject: "Welcome to Lead Eternity! 🚀",
    template: "welcome",
  },
  
  SEARCH_COMPLETED: {
    subject: "Your lead search is complete! {{leadCount}} leads found",
    template: "search_completed",
  },
  
  CREDITS_LOW: {
    subject: "Running low on credits - {{creditsLeft}} remaining",
    template: "credits_low",
  },
  
  PLAN_UPGRADED: {
    subject: "Welcome to {{planName}}! Your account has been upgraded",
    template: "plan_upgraded",
  },
  
  MONTHLY_SUMMARY: {
    subject: "Your monthly Lead Eternity summary",
    template: "monthly_summary",
  },
} as const;

// AI Configuration
export const AI_CONFIG = {
  CREW_AGENTS: {
    RELEVANCE_ANALYZER: "relevance_analyzer",
    PAIN_POINT_RESEARCHER: "pain_point_researcher",
    VALUE_MATCHER: "value_matcher",
    EMAIL_WRITER: "email_writer",
    FOLLOW_UP_STRATEGIST: "follow_up_strategist",
  },
  
  CONFIDENCE_THRESHOLDS: {
    LOW: 0.3,
    MEDIUM: 0.6,
    HIGH: 0.8,
  },
  
  RELEVANCE_WEIGHTS: {
    PAIN_POINTS: 0.4,
    VALUE_MATCHES: 0.3,
    CONFIDENCE: 0.3,
  },
} as const;

// Webhook Events
export const WEBHOOK_EVENTS = {
  STRIPE: {
    CUSTOMER_SUBSCRIPTION_CREATED: "customer.subscription.created",
    CUSTOMER_SUBSCRIPTION_UPDATED: "customer.subscription.updated",
    CUSTOMER_SUBSCRIPTION_DELETED: "customer.subscription.deleted",
    INVOICE_PAYMENT_SUCCEEDED: "invoice.payment_succeeded",
    INVOICE_PAYMENT_FAILED: "invoice.payment_failed",
  },
  
  CREWAI: {
    EMAIL_GENERATION_COMPLETED: "email_generation_completed",
    LEAD_ANALYSIS_COMPLETED: "lead_analysis_completed",
    BULK_ANALYSIS_COMPLETED: "bulk_analysis_completed",
    PROCESSING_FAILED: "processing_failed",
  },
} as const;

// File Upload Configuration
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"],
  ALLOWED_DOCUMENT_TYPES: ["application/pdf", "text/csv", "application/json"],
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  GOOGLE_MAPS_TTL: 24 * 60 * 60 * 1000, // 24 hours
  FINDYMAIL_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  USER_SESSION_TTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  METRICS_TTL: 60 * 60 * 1000, // 1 hour
} as const;