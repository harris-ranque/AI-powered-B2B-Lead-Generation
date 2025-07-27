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

// Async retry utility
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
  
  throw lastError!;
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