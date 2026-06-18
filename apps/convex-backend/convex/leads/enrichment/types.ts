// Shared types for enrichment providers

import type { FindyMailEmployeeRecord } from "../../lib/findymailEmployees";

export type { FindyMailEmployeeRecord };

export type EnrichmentProvider = "findymail";

export interface EmailContact {
  email: string;
  type: string;
  confidence: number;
  verified?: boolean;
}

export interface Contact {
  name: string;
  title?: string;
  email?: string;
  linkedin?: string;
  confidence: number;
  domain?: string;
  verified?: boolean;
  /** Role pattern from per-role FindyMail fetch when job title was not returned */
  sourceRole?: string;
}

export interface SocialProfiles {
  linkedin?: string;
  twitter?: string;
  facebook?: string;
}

export interface EnrichmentResult {
  emails: EmailContact[];
  contacts: Contact[];
  socialProfiles?: SocialProfiles;
  phone?: string;
  companyInfo?: {
    headcount?: number;
    industry?: string;
    owner?: string;
  };
  metadata?: {
    provider: EnrichmentProvider;
    confidence: number;
    timestamp: number;
  };
}

export interface EnrichmentBatchResult {
  [domain: string]: EnrichmentResult | null;
}

/**
 * Wrapper type for batch results that may include an API error.
 * Uses a wrapper object instead of extending the interface to avoid index signature conflicts.
 */
export interface EnrichmentBatchResultWithError {
  results: EnrichmentBatchResult;
  apiError?: import("../../lib/apiErrors").ApiError;
}

export interface EnrichmentError {
  code: string;
  message: string;
  provider: EnrichmentProvider;
  retryable: boolean;
}

export interface EnrichmentOptions {
  roles?: string[];
  /** Per-role API calls (multi-contact pipeline) */
  perRole?: boolean;
  /** Expand user roles into related title patterns for discovery (no cap) */
  enableRoleExpansion?: boolean;
  /** Max contacts per role/pattern request (multi-contact default: 5) */
  limit?: number;
  /** Pre-expanded role patterns (static + AI) for FindyMail per-role fetch */
  rolePatterns?: string[];
  /** Expanded patterns grouped by user role lane for round-robin fetch */
  rolePatternsByRole?: Record<string, string[]>;
}

export interface EnrichmentProviderInterface {
  name: EnrichmentProvider;
  enrichBatch(
    domains: string[],
    options?: EnrichmentOptions,
  ): Promise<EnrichmentBatchResult>;
  enrichSingle(
    domain: string,
    options?: EnrichmentOptions,
  ): Promise<EnrichmentResult | null>;
  enrichByName(domain: string, name: string): Promise<EnrichmentResult | null>;
  searchEmployees(
    website: string,
    jobTitles: string[],
    options?: { count?: number },
  ): Promise<FindyMailEmployeeRecord[]>;
  validateApiKey(apiKey: string): Promise<boolean>;
  getCredits(apiKey: string): Promise<number>;
}

// FindyMail specific types
export interface FindyMailResponse {
  [domain: string]: {
    emails: Array<{
      email: string;
      type: string;
      confidence: number;
    }>;
    contacts: Array<{
      name: string;
      title?: string;
      email?: string;
      linkedin?: string;
      confidence: number;
      domain?: string;
    }>;
    socialProfiles?: {
      linkedin?: string;
      twitter?: string;
      facebook?: string;
    };
  };
}