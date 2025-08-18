import { Doc, Id } from "../_generated/dataModel";

// Type definitions for common operations
export type User = Doc<"users">;
export type Lead = Doc<"leads">;
export type Search = Doc<"searches">;
export type BusinessProfile = Doc<"businessProfiles">;
export type EmailSequence = Doc<"emailSequences">;

// Credit costs for different operations
export const CREDIT_COSTS = {
  LEAD_DISCOVERY: 1,
  EMAIL_ENRICHMENT: 2,
  AI_ANALYSIS: 3,
  EMAIL_GENERATION: 5,
  BULK_ANALYSIS: 10,
} as const;

// Plan limits
export const PLAN_LIMITS = {
  free: {
    monthlyCredits: 50,
    maxSearches: 5,
    maxLeadsPerSearch: 25,
    emailGeneration: true,
    bulkOperations: false,
    apiAccess: false,
  },
  pro: {
    monthlyCredits: 500,
    maxSearches: 50,
    maxLeadsPerSearch: 100,
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
  },
  enterprise: {
    monthlyCredits: 2000,
    maxSearches: -1, // Unlimited
    maxLeadsPerSearch: 500,
    emailGeneration: true,
    bulkOperations: true,
    apiAccess: true,
  },
} as const;

// Helper functions
export function isAdmin(user: User): boolean {
  return user.role === "admin";
}

export function hasCredits(user: User, cost: number): boolean {
  return user.credits >= cost;
}

export function canPerformOperation(
  user: User,
  operation: keyof typeof CREDIT_COSTS
): boolean {
  const cost = CREDIT_COSTS[operation];
  return hasCredits(user, cost);
}

export function calculateSearchCost(
  maxResults: number,
  includeEnrichment: boolean = true,
  includeAI: boolean = true
): number {
  let cost = maxResults * CREDIT_COSTS.LEAD_DISCOVERY;
  
  if (includeEnrichment) {
    cost += maxResults * CREDIT_COSTS.EMAIL_ENRICHMENT;
  }
  
  if (includeAI) {
    cost += maxResults * CREDIT_COSTS.AI_ANALYSIS;
  }
  
  return cost;
}

export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");
  
  // Format US phone numbers
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  // Format international numbers (basic)
  if (digits.length === 11 && digits[0] === "1") {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return phone; // Return original if can't format
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function normalizeUrl(url: string): string {
  if (!url) return "";
  
  // Add protocol if missing
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  
  return url;
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function calculateRelevanceScore(
  painPoints: string[],
  valueMatches: string[],
  confidence: number
): number {
  const painPointScore = Math.min(painPoints.length * 0.2, 0.4);
  const valueMatchScore = Math.min(valueMatches.length * 0.15, 0.3);
  const confidenceScore = confidence * 0.3;
  
  return Math.min(painPointScore + valueMatchScore + confidenceScore, 1.0);
}

export function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

export function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, "") // Remove potential HTML
    .trim()
    .slice(0, 1000); // Limit length
}

export function extractDomain(url: string): string {
  try {
    const domain = new URL(normalizeUrl(url)).hostname;
    return domain.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// Error handling helpers
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function createError(
  message: string,
  code: string,
  statusCode: number = 400
): AppError {
  return new AppError(message, code, statusCode);
}

// Enhanced retry configuration
export interface RetryConfig {
  maxAttempts?: number;
  baseDelay?: number;
  strategy?: 'linear' | 'exponential' | 'fixed';
  jitter?: boolean;
  retryCondition?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

// Default retry configurations for different operations
export const RETRY_CONFIGS = {
  API_CALLS: {
    maxAttempts: 3,
    baseDelay: 1000,
    strategy: 'exponential' as const,
    jitter: true,
  },
  DATABASE_OPERATIONS: {
    maxAttempts: 5,
    baseDelay: 500,
    strategy: 'exponential' as const,
    jitter: true,
  },
  WEBHOOK_CALLS: {
    maxAttempts: 5,
    baseDelay: 2000,
    strategy: 'exponential' as const,
    jitter: true,
  },
  FILE_OPERATIONS: {
    maxAttempts: 3,
    baseDelay: 1000,
    strategy: 'linear' as const,
    jitter: false,
  },
} as const;

// Enhanced async retry utility with intelligent strategies
export async function retry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    strategy = 'exponential',
    jitter = false,
    retryCondition = () => true,
    onRetry,
  } = config;

  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Check if we should retry this error
      if (!retryCondition(lastError)) {
        throw lastError;
      }
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      // Calculate delay based on strategy
      let delay = baseDelay;
      
      switch (strategy) {
        case 'exponential':
          delay = baseDelay * Math.pow(2, attempt - 1);
          break;
        case 'linear':
          delay = baseDelay * attempt;
          break;
        case 'fixed':
          delay = baseDelay;
          break;
      }
      
      // Add jitter to prevent thundering herd
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      
      // Call retry callback
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      console.log(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms: ${lastError.message}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Specialized retry functions for common operations
export async function retryApiCall<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, {
    ...RETRY_CONFIGS.API_CALLS,
    retryCondition: (error) => {
      // Retry on network errors, timeouts, and 5xx status codes
      const retryableErrors = ['timeout', 'network', 'ECONNRESET', 'ETIMEDOUT'];
      const errorMessage = error.message.toLowerCase();
      
      return retryableErrors.some(err => errorMessage.includes(err)) ||
             errorMessage.includes('5') || // 5xx status codes
             errorMessage.includes('429'); // Rate limiting
    },
    onRetry: (attempt, error) => {
      console.log(`API call retry ${attempt}: ${error.message}`);
    },
  });
}

export async function retryDatabaseOperation<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, {
    ...RETRY_CONFIGS.DATABASE_OPERATIONS,
    retryCondition: (error) => {
      // Retry on database connection errors and deadlocks
      const retryableErrors = ['connection', 'deadlock', 'timeout', 'busy'];
      const errorMessage = error.message.toLowerCase();
      
      return retryableErrors.some(err => errorMessage.includes(err));
    },
    onRetry: (attempt, error) => {
      console.log(`Database operation retry ${attempt}: ${error.message}`);
    },
  });
}

export async function retryWebhookCall<T>(fn: () => Promise<T>): Promise<T> {
  return retry(fn, {
    ...RETRY_CONFIGS.WEBHOOK_CALLS,
    retryCondition: (error) => {
      // Retry on all errors except authentication and validation errors
      const nonRetryableErrors = ['401', '403', '400', 'unauthorized', 'forbidden', 'bad request'];
      const errorMessage = error.message.toLowerCase();
      
      return !nonRetryableErrors.some(err => errorMessage.includes(err));
    },
    onRetry: (attempt, error) => {
      console.log(`Webhook call retry ${attempt}: ${error.message}`);
    },
  });
}

// Operation-level retry tracking helper
export async function withRetryTracking<T>(
  ctx: any,
  operationType: string,
  relatedId: string,
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  try {
    const result = await operation();
    
    // Success - update any pending retry records for this operation
    await ctx.runMutation("retries/internal:updateRetryStatus", {
      operationType,
      relatedId,
      status: "completed",
    });
    
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Create retry record for failed operation
    const retryConfig = {
      maxAttempts: config.maxAttempts || 3,
      currentAttempt: 0,
      nextRetryAt: Date.now() + (config.baseDelay || 5000), // 5 second delay by default
      strategy: config.strategy || 'exponential' as const,
      backoffMs: config.baseDelay || 5000,
    };
    
    await ctx.runMutation("retries/internal:createRetryRecord", {
      operationType,
      relatedId,
      error: errorMessage,
      retryConfig,
      metadata: {
        originalError: errorMessage,
        timestamp: Date.now(),
      },
    });
    
    console.log(`Created retry record for ${operationType}: ${relatedId}`);
    throw error;
  }
}

// Circuit breaker pattern for critical operations
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
  
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Rate limiting helper
export function createRateLimiter(
  windowMs: number,
  maxRequests: number
) {
  const requests = new Map<string, number[]>();
  
  return (key: string): boolean => {
    const now = Date.now();
    const userRequests = requests.get(key) || [];
    
    // Remove old requests outside the window
    const validRequests = userRequests.filter(
      timestamp => now - timestamp < windowMs
    );
    
    if (validRequests.length >= maxRequests) {
      return false; // Rate limit exceeded
    }
    
    validRequests.push(now);
    requests.set(key, validRequests);
    
    return true; // Request allowed
  };
}