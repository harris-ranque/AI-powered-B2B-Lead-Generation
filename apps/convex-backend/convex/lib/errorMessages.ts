/**
 * Standardized Error Messages for BYOK System
 *
 * Provides consistent, actionable error messages across the entire BYOK implementation.
 * All BYOK-related errors should use these helpers for user-friendly messaging.
 */

/**
 * Standard error message when enterprise user is missing required API keys
 * @param missingProviders - Array of missing provider names (e.g., ["OpenAI", "Tavily"])
 * @param context - Optional context (e.g., "search", "enrichment", "analysis")
 */
export function getMissingApiKeysError(
  missingProviders: string[],
  context?: string
): string {
  const providerList = missingProviders.join(", ");
  const contextSuffix = context ? ` to ${context}` : "";

  if (missingProviders.length === 1) {
    return (
      `Enterprise users must provide their own ${missingProviders[0]} API key${contextSuffix}. ` +
      `Please add your API key in Settings.`
    );
  }

  return (
    `Enterprise users must provide their own API keys${contextSuffix}. ` +
    `Missing: ${providerList}. ` +
    `Please add your API keys in Settings.`
  );
}

/**
 * Error message for specific provider missing
 * @param provider - Provider name (e.g., "Google Places", "FindyMail")
 * @param operation - Operation context (e.g., "lead discovery", "email enrichment")
 */
export function getSingleProviderError(
  provider: string,
  operation?: string
): string {
  const forOperation = operation ? ` for ${operation}` : "";

  return (
    `Enterprise users must provide their own ${provider} API key${forOperation}. ` +
    `Please add your API key in Settings.`
  );
}

/**
 * Error message for missing API keys before starting an operation
 * @param operation - Operation name (e.g., "search", "lead analysis")
 * @param missingProviders - Array of missing provider names
 */
export function getMissingKeysBeforeOperationError(
  operation: string,
  missingProviders: string[]
): string {
  const providerList = missingProviders.join(", ");

  return (
    `Enterprise users must provide their own API keys. ` +
    `Missing: ${providerList}. ` +
    `Please add your API keys in Settings before starting ${operation}.`
  );
}

/**
 * Error message for invalid or expired API key
 * @param provider - Provider name
 */
export function getInvalidApiKeyError(provider: string): string {
  return (
    `Your ${provider} API key is invalid or expired. ` +
    `Please update your API key in Settings and try again.`
  );
}

/**
 * Error message when API key decryption fails
 * @param provider - Provider name
 */
export function getDecryptionError(provider: string): string {
  return (
    `Unable to retrieve your ${provider} API key. ` +
    `Please re-save your API key in Settings.`
  );
}

/**
 * Generic BYOK error with custom message
 * @param message - Custom error message
 */
export function getCustomBYOKError(message: string): string {
  return `${message} Please check your API keys in Settings.`;
}

/**
 * Success message for BYOK credit bypass
 * @param operation - Operation name
 */
export function getBypassSuccessMessage(operation: string): string {
  return `Using your own API keys for ${operation}. No platform credits charged.`;
}
