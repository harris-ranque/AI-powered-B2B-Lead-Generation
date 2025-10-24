/**
 * Deduplication Utility Functions
 *
 * Provides address and place name normalization for lead deduplication.
 */

/**
 * Normalize address for comparison
 *
 * Handles:
 * - Case-insensitive comparison
 * - Whitespace normalization
 * - Common street abbreviations (Street → St, Avenue → Ave, etc.)
 *
 * @example
 * normalizeAddress("123 Main Street") === normalizeAddress("123 Main St")
 * normalizeAddress("456  Oak   Ave") === normalizeAddress("456 Oak Avenue")
 *
 * @param address - The address string to normalize
 * @returns Normalized address string for comparison
 */
export function normalizeAddress(address: string): string {
  if (!address || typeof address !== 'string') {
    return '';
  }

  return address
    .toLowerCase()
    .trim()
    // Convert hash-based unit indicators before punctuation removal so "#200" === "unit 200"
    .replace(/\s*#\s*/g, ' unit ')
    // Remove extra spaces
    .replace(/\s+/g, ' ')
    // Remove commas that don't change address meaning
    .replace(/,/g, ' ')
    // Normalize common street type abbreviations
    .replace(/\bstreet\b/gi, 'st')
    .replace(/\bavenue\b/gi, 'ave')
    .replace(/\broad\b/gi, 'rd')
    .replace(/\bboulevard\b/gi, 'blvd')
    .replace(/\bdrive\b/gi, 'dr')
    .replace(/\blane\b/gi, 'ln')
    .replace(/\bcourt\b/gi, 'ct')
    .replace(/\bcircle\b/gi, 'cir')
    .replace(/\bplace\b/gi, 'pl')
    .replace(/\bparkway\b/gi, 'pkwy')
    .replace(/\bhighway\b/gi, 'hwy')
    .replace(/\bnorth\b/gi, 'n')
    .replace(/\bsouth\b/gi, 's')
    .replace(/\beast\b/gi, 'e')
    .replace(/\bwest\b/gi, 'w')
    .replace(/\bnortheast\b/gi, 'ne')
    .replace(/\bnorthwest\b/gi, 'nw')
    .replace(/\bsoutheast\b/gi, 'se')
    .replace(/\bsouthwest\b/gi, 'sw')
    // Normalize unit/suite indicators
    .replace(/\b(apartment|apt)\b/gi, 'apt')
    .replace(/\b(suite|ste)\b/gi, 'ste')
    .replace(/\bunit\b/gi, 'unit')
    // Normalize PO Box variations
    .replace(/\bpo\s?box\b/gi, 'pobox')
    // Remove trailing periods (e.g., "St." → "st")
    .replace(/\./g, '')
    // Final whitespace cleanup after replacements
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize place name for comparison
 *
 * Handles:
 * - Case-insensitive comparison
 * - Whitespace normalization (trim only)
 *
 * Note: We intentionally keep the full business name to avoid false positives.
 * For example, "Starbucks Coffee" vs "Starbucks" should be treated as different.
 *
 * @example
 * normalizePlaceName("Starbucks Coffee") === normalizePlaceName("STARBUCKS COFFEE")
 * normalizePlaceName("  Joe's Pizza  ") === normalizePlaceName("Joe's Pizza")
 *
 * @param name - The place name to normalize
 * @returns Normalized place name string for comparison
 */
export function normalizePlaceName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  return name
    .toLowerCase()
    .trim()
    // Remove extra spaces between words
    .replace(/\s+/g, ' ');
}

/**
 * Check if an email address is valid
 *
 * @param email - The email address to validate
 * @returns True if the email is valid, false otherwise
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim().toLowerCase());
}

/**
 * Extract primary email from lead contact info
 *
 * @param contactInfo - Lead contact information object
 * @returns Primary email address or null
 */
export function extractPrimaryEmail(contactInfo: any): string | null {
  if (!contactInfo || !contactInfo.emails || !Array.isArray(contactInfo.emails)) {
    return null;
  }

  // Sort emails by confidence and return the highest confidence email
  const sortedEmails = [...contactInfo.emails]
    .filter(e => e && e.email && isValidEmail(e.email))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  if (sortedEmails.length > 0) {
    return sortedEmails[0].email.toLowerCase().trim();
  }

  return null;
}
