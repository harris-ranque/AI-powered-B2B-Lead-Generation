/**
 * Pure business logic functions for search operations
 * These functions are extracted from mutations for better testability
 *
 * @module searchLogic
 */

/**
 * Default target roles when none are specified
 */
export const DEFAULT_TARGET_ROLES = ["CEO", "Founder", "Owner"] as const;

/**
 * Maximum number of target roles allowed
 */
export const MAX_TARGET_ROLES = 3;

/**
 * API key provider types
 * Must match the provider union in schema.ts userApiKeys table
 */
export type ApiKeyProvider =
  | "openai"
  | "google_places"
  | "google_maps" // Legacy
  | "findymail"
  | "apify"
  | "instantly"
  | "tavily"
  | "perplexity";

/**
 * API key record structure
 */
export interface ApiKeyRecord {
  provider: ApiKeyProvider;
  isActive: boolean;
  validated: boolean;
}

/**
 * Enterprise key validation result
 */
export interface EnterpriseKeyValidationResult {
  isValid: boolean;
  missingKeys: string[];
  hasLegacyGoogleMaps: boolean;
}

/**
 * Required providers for enterprise BYOK (Bring Your Own Keys)
 */
export const REQUIRED_ENTERPRISE_PROVIDERS = [
  "openai",
  "google_places",
  "findymail",
  "tavily",
  "perplexity",
] as const;

/**
 * User plan types
 */
export type UserPlan = "free" | "starter" | "pro" | "enterprise";

/**
 * Plan-based lead limits
 */
export const PLAN_LEAD_LIMITS: Record<UserPlan, number> = {
  free: 25,
  starter: 50,
  pro: 100,
  enterprise: 500,
};

/**
 * Search parameter validation result
 */
export interface SearchParameterValidationResult {
  valid: boolean;
  adjustedMaxLeads: number;
  reason?: string;
}

/**
 * Sanitize and normalize target roles input
 *
 * - Trims whitespace
 * - Filters empty values
 * - Converts to title case
 * - Deduplicates
 * - Limits to MAX_TARGET_ROLES
 * - Falls back to DEFAULT_TARGET_ROLES if empty
 *
 * @param roles - Optional array of role strings
 * @returns Sanitized array of role strings
 *
 * @example
 * ```typescript
 * sanitizeRoles(['ceo', 'FOUNDER', 'ceo']);
 * // ['Ceo', 'Founder']
 *
 * sanitizeRoles([]);
 * // ['CEO', 'Founder', 'Owner']
 *
 * sanitizeRoles(['  VP Sales  ', 'cto', 'manager', 'director']);
 * // ['Vp Sales', 'Cto', 'Manager'] (limited to 3)
 * ```
 */
export function sanitizeRoles(roles?: string[] | null): string[] {
  if (!roles || roles.length === 0) {
    return [...DEFAULT_TARGET_ROLES];
  }

  // Normalize: trim, filter empty, convert to title case
  const normalized = roles
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
    .map((role) =>
      role
        .split(/\s+/)
        .map((word) =>
          word.length > 0
            ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            : ""
        )
        .join(" ")
    );

  // Deduplicate while preserving order
  const deduped: string[] = [];
  for (const role of normalized) {
    if (!deduped.includes(role)) {
      deduped.push(role);
    }
    if (deduped.length >= MAX_TARGET_ROLES) {
      break;
    }
  }

  // Fall back to defaults if all roles were invalid
  if (deduped.length === 0) {
    return [...DEFAULT_TARGET_ROLES];
  }

  return deduped.slice(0, MAX_TARGET_ROLES);
}

/**
 * Validate search parameters against plan limits
 *
 * @param maxResults - Requested maximum number of leads
 * @param plan - User's subscription plan
 * @returns Validation result with adjusted max leads if needed
 *
 * @example
 * ```typescript
 * validateSearchParameters(100, 'free');
 * // { valid: true, adjustedMaxLeads: 25, reason: 'Adjusted to free plan limit' }
 *
 * validateSearchParameters(50, 'pro');
 * // { valid: true, adjustedMaxLeads: 50 }
 *
 * validateSearchParameters(0, 'pro');
 * // { valid: false, adjustedMaxLeads: 0, reason: 'maxResults must be positive' }
 * ```
 */
export function validateSearchParameters(
  maxResults: number,
  plan: UserPlan
): SearchParameterValidationResult {
  // Validate basic constraints
  if (!Number.isFinite(maxResults) || maxResults <= 0) {
    return {
      valid: false,
      adjustedMaxLeads: 0,
      reason: "maxResults must be a positive number",
    };
  }

  if (!Number.isInteger(maxResults)) {
    return {
      valid: false,
      adjustedMaxLeads: 0,
      reason: "maxResults must be an integer",
    };
  }

  const planLimit = PLAN_LEAD_LIMITS[plan] || PLAN_LEAD_LIMITS.free;

  // Adjust if over plan limit
  if (maxResults > planLimit) {
    return {
      valid: true,
      adjustedMaxLeads: planLimit,
      reason: `Adjusted to ${plan} plan limit of ${planLimit} leads`,
    };
  }

  return {
    valid: true,
    adjustedMaxLeads: maxResults,
  };
}

/**
 * Validate enterprise users have all required API keys
 *
 * @param apiKeys - Array of API key records for the user
 * @returns Validation result with list of missing providers
 *
 * @example
 * ```typescript
 * validateEnterpriseKeys([
 *   { provider: 'openai', isActive: true, validated: true },
 *   { provider: 'google_places', isActive: true, validated: true },
 * ]);
 * // { isValid: false, missingKeys: ['FindyMail', 'Tavily', 'Perplexity'], hasLegacyGoogleMaps: false }
 * ```
 */
export function validateEnterpriseKeys(
  apiKeys: ApiKeyRecord[]
): EnterpriseKeyValidationResult {
  // Filter to only active and validated keys
  const activeValidKeys = apiKeys.filter(
    (key) => key.isActive && key.validated
  );

  // Check for each required provider
  const hasOpenAI = activeValidKeys.some((key) => key.provider === "openai");
  const hasGooglePlaces = activeValidKeys.some(
    (key) => key.provider === "google_places"
  );
  const hasLegacyGoogleMaps = activeValidKeys.some(
    (key) => key.provider === "google_maps"
  );
  const hasFindyMail = activeValidKeys.some(
    (key) => key.provider === "findymail"
  );
  const hasTavily = activeValidKeys.some((key) => key.provider === "tavily");
  const hasPerplexity = activeValidKeys.some(
    (key) => key.provider === "perplexity"
  );

  // Build list of missing keys
  const missingKeys: string[] = [];

  if (!hasOpenAI) {
    missingKeys.push("OpenAI");
  }

  // Accept either google_places or legacy google_maps
  if (!hasGooglePlaces && !hasLegacyGoogleMaps) {
    missingKeys.push("Google Places");
  }

  if (!hasFindyMail) {
    missingKeys.push("FindyMail");
  }

  if (!hasTavily) {
    missingKeys.push("Tavily");
  }

  if (!hasPerplexity) {
    missingKeys.push("Perplexity");
  }

  return {
    isValid: missingKeys.length === 0,
    missingKeys,
    hasLegacyGoogleMaps: hasLegacyGoogleMaps && !hasGooglePlaces,
  };
}

/**
 * Format missing keys error message for user display
 *
 * @param operation - The operation that requires the keys (e.g., "a search")
 * @param missingKeys - Array of missing provider names
 * @returns User-friendly error message
 *
 * @example
 * ```typescript
 * formatMissingKeysError('a search', ['OpenAI', 'FindyMail']);
 * // "To start a search with your own API keys, please configure: OpenAI, FindyMail"
 * ```
 */
export function formatMissingKeysError(
  operation: string,
  missingKeys: string[]
): string {
  if (missingKeys.length === 0) {
    return "";
  }

  return `To start ${operation} with your own API keys, please configure: ${missingKeys.join(", ")}`;
}
