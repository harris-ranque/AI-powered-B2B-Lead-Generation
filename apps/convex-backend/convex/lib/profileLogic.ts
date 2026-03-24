/**
 * Pure business logic functions for profile operations
 * These functions are extracted from mutations/queries for better testability
 *
 * @module profileLogic
 */

/**
 * Profile data structure for completeness calculation
 */
export interface ProfileData {
  companyName?: string | null;
  industry?: string | null;
  valueProposition?: string | null;
  services?: string[] | null;
  targetMarkets?: string[] | null;
  keyDifferentiators?: string[] | null;
  contactInfo?: {
    name?: string;
    email?: string;
    phone?: string;
    website?: string;
    linkedin?: string;
    signature?: string;
  } | null;
  caseStudies?: Array<{
    title: string;
    client: string;
    results: string;
    metrics?: Record<string, unknown>;
  }> | null;
}

/**
 * Profile completeness result
 */
export interface ProfileCompletenessResult {
  isComplete: boolean;
  completionPercentage: number;
  missingFields: string[];
}

/**
 * Profile validation input
 */
export interface ProfileValidationInput {
  companyName: string;
  industry: string;
  valueProposition: string;
  services: string[];
  targetMarkets: string[];
  keyDifferentiators: string[];
}

/**
 * Profile validation result
 */
export interface ProfileValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Required fields for profile completeness
 */
const REQUIRED_FIELDS = [
  "companyName",
  "industry",
  "valueProposition",
  "services",
  "targetMarkets",
  "keyDifferentiators",
  "contactInfo",
] as const;

/**
 * Validation constraints
 */
export const PROFILE_CONSTRAINTS = {
  COMPANY_NAME_MAX_LENGTH: 100,
  VALUE_PROPOSITION_MIN_LENGTH: 50,
  VALUE_PROPOSITION_MAX_LENGTH: 500,
  MAX_SERVICES: 20,
  MAX_TARGET_MARKETS: 15,
  MAX_DIFFERENTIATORS: 10,
} as const;

/**
 * Calculate profile completeness percentage and identify missing fields
 *
 * @param profile - The profile data to evaluate
 * @returns Object containing isComplete flag, completion percentage, and list of missing fields
 *
 * @example
 * ```typescript
 * const result = calculateProfileCompleteness({
 *   companyName: 'Acme Inc',
 *   industry: 'Technology',
 *   services: ['Consulting'],
 * });
 * // { isComplete: false, completionPercentage: 43, missingFields: ['valueProposition', 'targetMarkets', 'keyDifferentiators', 'contactInfo'] }
 * ```
 */
export function calculateProfileCompleteness(
  profile: ProfileData | null | undefined
): ProfileCompletenessResult {
  // Handle null/undefined profile
  if (!profile) {
    return {
      isComplete: false,
      completionPercentage: 0,
      missingFields: [...REQUIRED_FIELDS],
    };
  }

  const missingFields: string[] = [];
  let completedFields = 0;

  // Check required fields
  if (!profile.companyName?.trim()) {
    missingFields.push("companyName");
  } else {
    completedFields++;
  }

  if (!profile.industry?.trim()) {
    missingFields.push("industry");
  } else {
    completedFields++;
  }

  if (!profile.valueProposition?.trim()) {
    missingFields.push("valueProposition");
  } else {
    completedFields++;
  }

  if (!profile.services?.length) {
    missingFields.push("services");
  } else {
    completedFields++;
  }

  if (!profile.targetMarkets?.length) {
    missingFields.push("targetMarkets");
  } else {
    completedFields++;
  }

  if (!profile.keyDifferentiators?.length) {
    missingFields.push("keyDifferentiators");
  } else {
    completedFields++;
  }

  // Check contact info (at least email should be provided)
  if (!profile.contactInfo?.email?.trim()) {
    missingFields.push("contactInfo");
  } else {
    completedFields++;
  }

  const completionPercentage = Math.round(
    (completedFields / REQUIRED_FIELDS.length) * 100
  );
  const isComplete = missingFields.length === 0;

  return {
    isComplete,
    completionPercentage,
    missingFields,
  };
}

/**
 * Validate profile data against business rules
 *
 * @param data - The profile data to validate
 * @returns Object containing isValid flag and array of error messages
 *
 * @example
 * ```typescript
 * const result = validateProfileData({
 *   companyName: '',
 *   industry: 'Tech',
 *   valueProposition: 'Short',
 *   services: [],
 *   targetMarkets: ['SMB'],
 *   keyDifferentiators: ['Innovation'],
 * });
 * // { isValid: false, errors: ['Company name is required', 'Value proposition should be at least 50 characters', 'At least one service is required'] }
 * ```
 */
export function validateProfileData(
  data: ProfileValidationInput
): ProfileValidationResult {
  const errors: string[] = [];

  // Validate company name
  if (!data.companyName.trim()) {
    errors.push("Company name is required");
  } else if (data.companyName.length > PROFILE_CONSTRAINTS.COMPANY_NAME_MAX_LENGTH) {
    errors.push(
      `Company name must be less than ${PROFILE_CONSTRAINTS.COMPANY_NAME_MAX_LENGTH} characters`
    );
  }

  // Validate industry
  if (!data.industry.trim()) {
    errors.push("Industry is required");
  }

  // Validate value proposition
  if (!data.valueProposition.trim()) {
    errors.push("Value proposition is required");
  } else if (
    data.valueProposition.length < PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MIN_LENGTH
  ) {
    errors.push(
      `Value proposition should be at least ${PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MIN_LENGTH} characters`
    );
  } else if (
    data.valueProposition.length > PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MAX_LENGTH
  ) {
    errors.push(
      `Value proposition must be less than ${PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MAX_LENGTH} characters`
    );
  }

  // Validate services
  if (data.services.length === 0) {
    errors.push("At least one service is required");
  } else if (data.services.length > PROFILE_CONSTRAINTS.MAX_SERVICES) {
    errors.push(`Maximum ${PROFILE_CONSTRAINTS.MAX_SERVICES} services allowed`);
  }

  // Validate target markets
  if (data.targetMarkets.length === 0) {
    errors.push("At least one target market is required");
  } else if (data.targetMarkets.length > PROFILE_CONSTRAINTS.MAX_TARGET_MARKETS) {
    errors.push(`Maximum ${PROFILE_CONSTRAINTS.MAX_TARGET_MARKETS} target markets allowed`);
  }

  // Validate key differentiators
  if (data.keyDifferentiators.length === 0) {
    errors.push("At least one key differentiator is required");
  } else if (data.keyDifferentiators.length > PROFILE_CONSTRAINTS.MAX_DIFFERENTIATORS) {
    errors.push(`Maximum ${PROFILE_CONSTRAINTS.MAX_DIFFERENTIATORS} key differentiators allowed`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a profile is complete for use in lead generation
 * This is the "quick check" version used in mutations
 *
 * @param profile - The profile data to check
 * @param fallbackEmail - Optional email to use if profile email is empty (e.g., from Clerk)
 * @returns boolean indicating if the profile is complete
 *
 * @example
 * ```typescript
 * const complete = isProfileComplete(profile, user.email);
 * // true if all required fields are filled
 * ```
 */
export function isProfileComplete(
  profile: ProfileData,
  fallbackEmail?: string | null
): boolean {
  const userEmail = profile.contactInfo?.email || fallbackEmail || "";

  return !!(
    profile.companyName &&
    profile.industry &&
    profile.valueProposition &&
    profile.valueProposition.length >= PROFILE_CONSTRAINTS.VALUE_PROPOSITION_MIN_LENGTH &&
    profile.services &&
    profile.services.length > 0 &&
    profile.targetMarkets &&
    profile.targetMarkets.length > 0 &&
    profile.keyDifferentiators &&
    profile.keyDifferentiators.length > 0 &&
    userEmail
  );
}

/**
 * Contact info structure for merging
 */
interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  signature?: string;
}

/**
 * Merge profile data from an import with existing profile
 * Uses "prefer new if exists, fallback to existing" strategy
 *
 * @param existing - The existing profile data
 * @param incoming - The new profile data to merge
 * @returns Merged profile data
 *
 * @example
 * ```typescript
 * const merged = mergeProfileData(existingProfile, importedData);
 * // Merges arrays (deduped), prefers incoming for scalars
 * ```
 */
export function mergeProfileData(
  existing: ProfileData,
  incoming: ProfileData
): ProfileData {
  return {
    companyName: incoming.companyName || existing.companyName,
    industry: incoming.industry || existing.industry,
    valueProposition: incoming.valueProposition || existing.valueProposition,
    // Merge arrays with deduplication
    services: deduplicateArray([
      ...(existing.services || []),
      ...(incoming.services || []),
    ]),
    targetMarkets: deduplicateArray([
      ...(existing.targetMarkets || []),
      ...(incoming.targetMarkets || []),
    ]),
    keyDifferentiators: deduplicateArray([
      ...(existing.keyDifferentiators || []),
      ...(incoming.keyDifferentiators || []),
    ]),
    // Merge contact info, preferring incoming values
    contactInfo: mergeContactInfo(
      existing.contactInfo || {},
      incoming.contactInfo || {}
    ),
    // Keep existing case studies (don't merge case studies from imports)
    // Convert null to undefined for Convex compatibility
    caseStudies: existing.caseStudies ?? undefined,
  };
}

/**
 * Deduplicate an array of strings
 * @internal
 */
function deduplicateArray(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((item) => item && item.trim())));
}

/**
 * Merge contact info objects
 * @internal
 */
function mergeContactInfo(
  existing: ContactInfo,
  incoming: ContactInfo
): ContactInfo {
  return {
    name: incoming.name || existing.name || "",
    email: incoming.email || existing.email || "",
    phone: incoming.phone || existing.phone || "",
    website: incoming.website || existing.website || "",
    linkedin: incoming.linkedin || existing.linkedin || "",
    signature:
      incoming.signature !== undefined
        ? incoming.signature
        : existing.signature || "",
  };
}
