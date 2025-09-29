// Types based on Convex schema for frontend use
import type { Doc, Id } from "@genni/convex-types/dataModel";

// Re-export Convex types for convenience
export type { Doc, Id };

// User types
export type User = Doc<"users">;
export type UserPlan = "free" | "pro" | "enterprise";

// Business Profile types
export type BusinessProfile = Doc<"businessProfiles">;

export interface BusinessProfileInput {
  companyName: string;
  industry: string;
  valueProposition: string;
  services: string[];
  targetMarkets: string[];
  keyDifferentiators: string[];
  caseStudies?: Array<{
    title: string;
    client: string;
    results: string;
    metrics: Record<string, string | number | boolean>;
  }>;
  contactInfo: {
    email?: string;
    phone?: string;
    website?: string;
    linkedin?: string;
  };
}

// Search types
export type Search = Doc<"searches">;
export type SearchStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface SearchParams {
  location: string;
  /**
   * Search radius in miles. Converted to meters to satisfy Google Places API requirements.
   */
  radius: number;
  keywords: string[];
  industries?: string[];
  excludeTerms?: string[];
  minRating?: number;
  maxResults: number;
}

// Lead types
export type Lead = Doc<"leads">;
export type LeadStatus =
  | "new"
  | "qualified"
  | "contacted"
  | "nurturing"
  | "converted"
  | "unqualified";
export type EnrichmentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

// Email Sequence types
export type EmailSequence = Doc<"emailSequences">;

export interface EmailRequirements {
  tone: string;
  length: string;
  callToAction: string;
  includeCaseStudy: boolean;
  personalizationLevel: string;
  followUpSequence: boolean;
}

// CrewAI types
export type CrewAIRequest = Doc<"crewaiRequests">;

export interface EmailGenerationResult {
  requestId: string;
  leadAnalysis: Record<string, string | number | boolean | string[]>;
  relevanceScore: number;
  painPointsIdentified: string[];
  valueMatches: string[];
  primaryEmail: {
    subject: string;
    body: string;
    personalizationNotes: string[];
    estimatedEffectiveness: number;
  };
  followUpSequence?: {
    emails: Array<{
      subject: string;
      body: string;
      delayDays: number;
    }>;
    strategy: string;
  };
  agentResults: Array<{
    agentName: string;
    role: string;
    output: string;
    confidenceScore: number;
    executionTime: number;
  }>;
  processingTime: number;
  recommendations: string[];
}

// Billing types
export type Billing = Doc<"billing">;
export type CreditTransaction = Doc<"creditTransactions">;

// Notification types
export type Notification = Doc<"notifications">;
export type NotificationType =
  | "search_completed"
  | "credits_low"
  | "plan_upgraded"
  | "system_alert"
  | "email_sent";

// Analytics types
export interface UserStats {
  totalSearches: number;
  totalLeads: number;
  totalEmails: number;
  creditsUsed: number;
  avgRelevanceScore: number;
}

export interface UsageStats {
  currentPeriodUsage: number;
  totalCreditsUsed: number;
  searchesThisMonth: number;
  leadsGenerated: number;
  emailsGenerated: number;
  avgCostPerLead: number;
}
