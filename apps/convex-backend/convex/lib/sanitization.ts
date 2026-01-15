/**
 * Enterprise-grade sanitization module with DOMPurify integration
 * Provides comprehensive XSS protection and input validation
 *
 * @module sanitization
 */

import DOMPurify from "isomorphic-dompurify";

/**
 * Options for string sanitization
 */
export interface SanitizeOptions {
  /** Maximum length of output (default: 1000) */
  maxLength?: number;
  /** HTML tags to allow (default: none - strips all HTML) */
  allowedTags?: string[];
  /** Strip all HTML (default: true) */
  stripAllHtml?: boolean;
  /** Trim whitespace (default: true) */
  trim?: boolean;
}

/**
 * Options for array sanitization
 */
export interface ArraySanitizeOptions extends SanitizeOptions {
  /** Maximum number of items in array (default: 50) */
  maxItems?: number;
  /** Remove empty strings after sanitization (default: true) */
  filterEmpty?: boolean;
}

/**
 * Default sanitization options
 */
export const DEFAULT_SANITIZE_OPTIONS: Required<SanitizeOptions> = {
  maxLength: 1000,
  allowedTags: [],
  stripAllHtml: true,
  trim: true,
};

/**
 * Allowed tags for rich text content
 */
export const RICH_TEXT_ALLOWED_TAGS = [
  "p",
  "br",
  "b",
  "i",
  "u",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "span",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

/**
 * Sanitize user input string with comprehensive XSS protection
 *
 * Uses DOMPurify for enterprise-grade HTML sanitization including:
 * - Script tag removal
 * - Event handler removal (onclick, onerror, etc.)
 * - Dangerous protocol removal (javascript:, data:, etc.)
 * - Nested malicious tag handling
 * - Unicode obfuscation protection
 *
 * @param input - String to sanitize
 * @param options - Sanitization options
 * @returns Sanitized string
 *
 * @example
 * ```typescript
 * sanitizeString('<script>alert(1)</script>');
 * // ''
 *
 * sanitizeString('<b>Hello</b> World', { stripAllHtml: false, allowedTags: ['b'] });
 * // '<b>Hello</b> World'
 *
 * sanitizeString('Very long text...', { maxLength: 10 });
 * // 'Very long '
 * ```
 */
export function sanitizeString(
  input: string | null | undefined,
  options: SanitizeOptions = {}
): string {
  const {
    maxLength = DEFAULT_SANITIZE_OPTIONS.maxLength,
    allowedTags = DEFAULT_SANITIZE_OPTIONS.allowedTags,
    stripAllHtml = DEFAULT_SANITIZE_OPTIONS.stripAllHtml,
    trim = DEFAULT_SANITIZE_OPTIONS.trim,
  } = options;

  // Handle null/undefined/non-string input
  if (input === null || input === undefined) {
    return "";
  }

  if (typeof input !== "string") {
    return "";
  }

  // Use DOMPurify for comprehensive XSS protection
  let sanitized: string;

  if (stripAllHtml) {
    // Strip ALL HTML tags - safest option
    sanitized = DOMPurify.sanitize(input, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
    });
  } else {
    // Allow specific tags (still no attributes for security)
    sanitized = DOMPurify.sanitize(input, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: [],
    });
  }

  // Trim whitespace if enabled
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Enforce max length
  return sanitized.slice(0, maxLength);
}

/**
 * Sanitize rich text content allowing safe HTML tags
 *
 * Allows basic formatting tags while still protecting against XSS
 *
 * @param input - Rich text to sanitize
 * @param maxLength - Maximum length (default: 5000)
 * @returns Sanitized rich text
 *
 * @example
 * ```typescript
 * sanitizeRichText('<p><b>Bold</b> and <script>bad</script></p>');
 * // '<p><b>Bold</b> and </p>'
 * ```
 */
export function sanitizeRichText(
  input: string | null | undefined,
  maxLength: number = 5000
): string {
  if (!input || typeof input !== "string") {
    return "";
  }

  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: RICH_TEXT_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"], // Limited attributes for links
    ADD_ATTR: ["target"], // Allow target attribute
  }).slice(0, maxLength);
}

/**
 * Sanitize an array of strings
 *
 * @param arr - Array to sanitize
 * @param options - Sanitization options
 * @returns Sanitized array
 *
 * @example
 * ```typescript
 * sanitizeStringArray(['<script>bad</script>', 'good', '', 'okay']);
 * // ['good', 'okay']
 * ```
 */
export function sanitizeStringArray(
  arr: string[] | null | undefined,
  options: ArraySanitizeOptions = {}
): string[] {
  if (!Array.isArray(arr)) {
    return [];
  }

  const { maxItems = 50, filterEmpty = true, ...sanitizeOpts } = options;

  const sanitized = arr
    .slice(0, maxItems)
    .map((item) => sanitizeString(item, sanitizeOpts));

  if (filterEmpty) {
    return sanitized.filter((item) => item.length > 0);
  }

  return sanitized;
}

/**
 * Validate email address with stricter RFC 5322 compliance
 *
 * More comprehensive than basic regex validation
 *
 * @param email - Email to validate
 * @returns True if valid email format
 *
 * @example
 * ```typescript
 * validateEmailStrict('user@example.com');
 * // true
 *
 * validateEmailStrict('invalid@');
 * // false
 *
 * validateEmailStrict('a'.repeat(250) + '@test.com');
 * // false (too long)
 * ```
 */
export function validateEmailStrict(email: string | null | undefined): boolean {
  if (!email || typeof email !== "string") {
    return false;
  }

  // Check max length (RFC 5321)
  if (email.length > 254) {
    return false;
  }

  // More comprehensive email regex
  // Allows most valid email formats while rejecting obvious invalid ones
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(email)) {
    return false;
  }

  // Additional checks
  const parts = email.split("@");
  const localPart = parts[0];
  const domain = parts[1];

  // Regex already validated @ exists, but TypeScript needs the check
  if (!localPart || !domain) {
    return false;
  }

  // Local part max 64 characters
  if (localPart.length > 64) {
    return false;
  }

  // No consecutive dots in local part
  if (localPart.includes("..")) {
    return false;
  }

  // Domain must have at least one dot
  if (!domain.includes(".")) {
    return false;
  }

  return true;
}

/**
 * Validate URL with protocol enforcement
 *
 * Only allows http and https protocols
 *
 * @param url - URL to validate
 * @returns True if valid URL with safe protocol
 *
 * @example
 * ```typescript
 * validateUrlStrict('https://example.com');
 * // true
 *
 * validateUrlStrict('javascript:alert(1)');
 * // false
 *
 * validateUrlStrict('data:text/html,<script>');
 * // false
 * ```
 */
export function validateUrlStrict(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const parsed = new URL(url);
    // Only allow safe protocols
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Normalize URL to https
 *
 * @param url - URL to normalize
 * @returns Normalized URL with https protocol
 *
 * @example
 * ```typescript
 * normalizeUrlStrict('example.com');
 * // 'https://example.com'
 *
 * normalizeUrlStrict('http://example.com');
 * // 'http://example.com' (preserves existing protocol)
 * ```
 */
export function normalizeUrlStrict(url: string | null | undefined): string {
  if (!url || typeof url !== "string") {
    return "";
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }

  // Add https if no protocol
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

/**
 * Sanitize and validate contact information object
 *
 * @param contactInfo - Contact info to sanitize
 * @returns Sanitized contact info
 *
 * @example
 * ```typescript
 * sanitizeContactInfo({
 *   name: '<script>John</script>',
 *   email: 'john@example.com',
 *   website: 'example.com',
 * });
 * // { name: 'John', email: 'john@example.com', website: 'https://example.com', ... }
 * ```
 */
export function sanitizeContactInfo(
  contactInfo: {
    name?: string;
    email?: string;
    phone?: string;
    website?: string;
    linkedin?: string;
  } | null | undefined
): {
  name: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
} {
  if (!contactInfo) {
    return {
      name: "",
      email: "",
      phone: "",
      website: "",
      linkedin: "",
    };
  }

  // Normalize URLs first (adds https:// if needed), then validate
  const normalizedWebsite = normalizeUrlStrict(contactInfo.website);
  const normalizedLinkedin = normalizeUrlStrict(contactInfo.linkedin);

  return {
    name: sanitizeString(contactInfo.name, { maxLength: 100 }),
    email: validateEmailStrict(contactInfo.email) ? contactInfo.email! : "",
    phone: sanitizeString(contactInfo.phone, { maxLength: 30 }),
    website: validateUrlStrict(normalizedWebsite) ? normalizedWebsite : "",
    linkedin: validateUrlStrict(normalizedLinkedin) ? normalizedLinkedin : "",
  };
}

/**
 * Sanitize a single-line text input (no newlines)
 *
 * @param input - Text to sanitize
 * @param maxLength - Maximum length
 * @returns Sanitized single-line text
 */
export function sanitizeSingleLine(
  input: string | null | undefined,
  maxLength: number = 200
): string {
  const sanitized = sanitizeString(input, { maxLength: maxLength + 100 });
  // Remove all newlines and normalize whitespace
  return sanitized
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Check if a string contains potential XSS patterns
 * Useful for logging/alerting purposes
 *
 * @param input - String to check
 * @returns True if potential XSS patterns detected
 */
export function containsXssPatterns(input: string): boolean {
  if (!input || typeof input !== "string") {
    return false;
  }

  const xssPatterns = [
    /<script/i,
    /javascript:/i,
    /data:/i,
    /vbscript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=, onerror=
    /<iframe/i,
    /<embed/i,
    /<object/i,
    /<svg.*onload/i,
    /expression\s*\(/i, // CSS expression
    /&#/i, // HTML entities that could be used for obfuscation
    /\\u00/i, // Unicode escapes
  ];

  return xssPatterns.some((pattern) => pattern.test(input));
}
