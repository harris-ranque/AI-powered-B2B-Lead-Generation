// Shared types for enrichment providers

export type EnrichmentProvider = "findymail" | "icypeas";

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
  validateApiKey(apiKey: string): Promise<boolean>;
  getCredits(apiKey: string): Promise<number>;
}

// IcyPeas specific types
export interface IcyPeasSearchResponse {
  success: boolean;
  searchId?: string; // Legacy field for compatibility
  item?: {
    _id: string;
    status: "NONE" | "SCHEDULED" | "IN_PROGRESS" | "DEBITED";
  };
  status?: "NONE" | "SCHEDULED" | "IN_PROGRESS" | "DEBITED";
  message?: string;
  validationErrors?: Array<{
    field: string;
    message: string;
    humanReadableMessage: string;
    type: string;
  }>;
}

export interface IcyPeasEmailResult {
  certainty: "ULTRA_SURE" | "SURE" | "MEDIUM" | "LOW";
  email: string;
  mxProvider?: string;
  records?: string[];
}

export interface IcyPeasSearchResult {
  success: boolean;
  status: "FOUND" | "NOT_FOUND" | "ERROR";
  emails?: IcyPeasEmailResult[];
  contacts?: any[];
  phoneNumbers?: string[];
  companyInfo?: {
    headcount?: number;
    industry?: string;
    owner?: string;
  };
  // New fields for actual API response
  items?: Array<{
    _id: string;
    status: "FOUND" | "NOT_FOUND" | "ERROR" | "IN_PROGRESS" | "SCHEDULED";
    results: {
      firstname: string;
      lastname: string;
      fullname: string;
      emails: IcyPeasEmailResult[];
      phones: string[];
      saasServices?: any[];
      gender?: string;
      li?: string;
    };
  }>;
  total?: number;
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