import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
  EnrichmentOptions,
} from "./types";
import { mapWithConcurrency } from "../../utils/async";
import { parseRetryAfter, sleep, withJitter } from "../../utils/http";
import {
  classifyFindyMailError,
  shouldBlockPipeline,
  type ApiError,
} from "../../lib/apiErrors";
import { expandRolesForMatching } from "../../lib/roleFamilies";
import { normalizeRolePattern } from "../../lib/roleExpansion";
import { isContactEmailVerified } from "../../lib/contactVerification";

const FINDYMAIL_BASE_URL = "https://app.findymail.com/api";
const FINDYMAIL_TIMEOUT_MS = 50_000;

function createTimeoutController(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

const DEFAULT_ROLES = ["ceo", "founder", "owner"] as const;
/** FindyMail combined /search/domain request supports up to 3 roles in one call */
const MAX_ROLES_PER_API_REQUEST = 3;
/** Contacts fetched per user-requested role (and per expanded pattern) */
const DEFAULT_PER_ROLE_CONTACT_LIMIT = 5;
/** One in-flight FindyMail /search/domain call per domain enrichment batch */
const PER_ROLE_FETCH_CONCURRENCY = 1;
/** Pause between per-role API calls to avoid 429 bursts */
const PER_ROLE_FETCH_DELAY_MS = 500;
/** Max role patterns sent to FindyMail per domain (title matching may use more) */
const MAX_FINDYMAIL_PATTERNS_PER_DOMAIN = 12;
/** Stop per-role fetch once enough named contacts are found */
const PER_ROLE_EARLY_EXIT_CONTACTS = 3;
/** Retries inside a single /search/domain request (429/504) */
const SINGLE_REQUEST_MAX_RETRIES = 5;
const SINGLE_REQUEST_BASE_DELAY_MS = 2000;
const SINGLE_REQUEST_MAX_DELAY_MS = 45_000;

const DECISION_MAKER_PATTERN =
  /\b(vp|vice president|chief|head|director|cmo|cro|cto|cfo|coo|president|owner|founder|partner|managing)\b/i;

function prioritizeFindyMailRolePatterns(
  patterns: string[],
  userRoles: string[],
): string[] {
  const seen = new Set<string>();
  const userNormalized = new Set(userRoles.map((role) => normalizeRolePattern(role)));
  const userBucket: string[] = [];
  const decisionMakerBucket: string[] = [];
  const otherBucket: string[] = [];

  for (const pattern of patterns) {
    const normalized = normalizeRolePattern(pattern);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (userNormalized.has(normalized)) {
      userBucket.push(normalized);
    } else if (DECISION_MAKER_PATTERN.test(normalized)) {
      decisionMakerBucket.push(normalized);
    } else {
      otherBucket.push(normalized);
    }
  }

  return [...userBucket, ...decisionMakerBucket, ...otherBucket].slice(
    0,
    MAX_FINDYMAIL_PATTERNS_PER_DOMAIN,
  );
}

/**
 * Sanitize and normalize roles for FindyMail API.
 *
 * @param maxRoles - When set, caps roles for a single combined API request (API limit).
 *   Omit for per-role discovery lists (UI caps user input; expansion has no backend cap).
 */
interface SanitizedRolesResult {
  roles: string[];
  truncated: boolean;
  originalCount: number;
}

function sanitizeRoles(
  roles?: string[] | null,
  maxRoles?: number,
): SanitizedRolesResult {
  if (!roles || roles.length === 0) {
    return {
      roles: [...DEFAULT_ROLES],
      truncated: false,
      originalCount: 0,
    };
  }

  const normalized = roles
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);

  const deduped: string[] = [];
  for (const role of normalized) {
    if (!deduped.includes(role)) {
      deduped.push(role);
    }
  }

  const originalCount = deduped.length;
  const truncated =
    maxRoles !== undefined && originalCount > maxRoles;

  if (truncated) {
    console.warn(
      `[FindyMail] ⚠️ Role truncation: Requested ${originalCount} roles but combined API request supports ${maxRoles}. ` +
      `Using: [${deduped.slice(0, maxRoles).join(", ")}]. ` +
      `Truncated: [${deduped.slice(maxRoles).join(", ")}]`
    );
  }

  if (deduped.length === 0) {
    return {
      roles: [...DEFAULT_ROLES],
      truncated: false,
      originalCount: 0,
    };
  }

  const cap = maxRoles ?? deduped.length;

  return {
    roles: deduped.slice(0, cap),
    truncated,
    originalCount,
  };
}

function resolveRoles(options?: EnrichmentOptions): string[] {
  return sanitizeRoles(options?.roles, MAX_ROLES_PER_API_REQUEST).roles;
}

function resolveRolesForPerRoleFetch(options?: EnrichmentOptions): string[] {
  const userRoles = sanitizeRoles(options?.roles).roles;

  let patterns: string[];
  if (options?.rolePatterns && options.rolePatterns.length > 0) {
    patterns = options.rolePatterns
      .map((pattern) => normalizeRolePattern(pattern))
      .filter((pattern) => pattern.length > 0);
  } else if (options?.enableRoleExpansion) {
    patterns = expandRolesForMatching(userRoles, true);
  } else {
    patterns = userRoles;
  }

  const capped = prioritizeFindyMailRolePatterns(patterns, userRoles);
  if (patterns.length > capped.length) {
    console.warn(
      `[FindyMail] Capped role patterns for API: ${patterns.length} -> ${capped.length}`,
    );
  }
  return capped;
}

export class FindyMailProvider implements EnrichmentProviderInterface {
  name: EnrichmentProvider = "findymail";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Enrich multiple domains in batch using FindyMail's domain search API with rate limiting
   * Note: FindyMail uses /search/domain endpoint with individual domain requests
   * Implements rate limiting to prevent 429/504 errors
   */
  async enrichBatch(
    domains: string[],
    options?: EnrichmentOptions,
  ): Promise<EnrichmentBatchResult> {
    const result: EnrichmentBatchResult = {};

    if (domains.length === 0) {
      return result;
    }

    console.log(`[FindyMail] Starting batch enrichment for ${domains.length} domains with rate limiting`);

    // Rate limiting configuration per FindyMail API docs:
    // - API limit: 5 concurrent requests (synchronous)
    // - Heavy processing involved (real-time search)
    // We use conservative limits to be respectful of their infrastructure
    const CONCURRENT_REQUESTS = 5; // Max concurrent requests (API limit is 5)
    const DELAY_BETWEEN_BATCHES_MS = 500; // 500ms delay between batches for heavy processing
    const RETRY_ATTEMPTS = 4; // Increased to 4 retries for 504 Gateway Timeouts (heavy processing)

    // Process domains in controlled batches
    const batches: string[][] = [];
    for (let i = 0; i < domains.length; i += CONCURRENT_REQUESTS) {
      batches.push(domains.slice(i, i + CONCURRENT_REQUESTS));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]!;
      console.log(`[FindyMail] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} domains) - using 5 concurrent requests`);

      // Process batch with retries (only for transient errors)
      const batchPromises = batch.map(async (domain) => {
        for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
          try {
            const enrichmentResult = await this.enrichSingle(domain, options);
            return { domain, result: enrichmentResult };
          } catch (error: any) {
            // Check if this is a classified API error that should block the pipeline
            const apiError = error?.apiError as ApiError | undefined;
            if (apiError && shouldBlockPipeline(apiError)) {
              // This is a user-actionable error (auth failed, credits exhausted)
              // Don't retry - propagate the error for pipeline handling
              console.error(`[FindyMail] Pipeline-blocking error for ${domain}:`, {
                errorCode: apiError.errorCode,
                category: apiError.category,
                userMessage: apiError.userMessage,
              });
              return { domain, result: null, apiError };
            }

            // Only retry network errors at batch level — 429/504 are retried inside fetchDomainSearch
            const isNetworkError = error?.message?.includes("ECONNRESET") ||
                                   error?.message?.includes("ETIMEDOUT") ||
                                   error?.message?.includes("ENOTFOUND") ||
                                   error?.message?.includes("fetch failed");

            // Check if this is a non-retriable error (4xx client errors except 429)
            const is4xxError = error?.message?.match(/API error: (4\d{2})/);
            const isRateLimitError = error?.message?.includes("429") || error?.message?.includes("Too Many Requests");
            const isNonRetriable = is4xxError && !isRateLimitError;

            if (isNonRetriable) {
              // Don't retry 4xx errors (404, 400, etc.) - these are permanent failures
              console.log(`[FindyMail] Non-retriable error for ${domain}: ${error?.message} - not retrying`);
              return { domain, result: null };
            }

            if (isNetworkError && attempt < RETRY_ATTEMPTS) {
              // Exponential backoff for transient errors: 1s, 2s, 4s, 8s, max 15s
              const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 15000);
              console.log(`[FindyMail] Transient error for ${domain}, retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              continue;
            }

            // Exhausted retries or non-transient error
            console.error(`[FindyMail] Failed to enrich ${domain} after ${attempt + 1} attempts:`, error?.message || error);
            return { domain, result: null };
          }
        }
        return { domain, result: null };
      });

      const batchResults = await Promise.all(batchPromises);

      // Collect results and check for pipeline-blocking errors
      let pipelineBlockingError: ApiError | undefined;
      for (const batchResult of batchResults) {
        const { domain, result: enrichmentResult, apiError } = batchResult as {
          domain: string;
          result: EnrichmentResult | null;
          apiError?: ApiError;
        };
        result[domain] = enrichmentResult;

        // Capture first pipeline-blocking error
        if (apiError && !pipelineBlockingError && shouldBlockPipeline(apiError)) {
          pipelineBlockingError = apiError;
        }
      }

      // If we encountered a pipeline-blocking error, stop processing and return
      if (pipelineBlockingError) {
        console.error(`[FindyMail] Pipeline-blocking error detected, stopping batch processing:`, {
          errorCode: pipelineBlockingError.errorCode,
          category: pipelineBlockingError.category,
          userMessage: pipelineBlockingError.userMessage,
          processedBatches: batchIndex + 1,
          totalBatches: batches.length,
        });

        // Add apiError to the result object for upstream handling
        (result as any).__apiError = pipelineBlockingError;
        return result;
      }

      // Add delay between batches to avoid rate limiting (except for last batch)
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    const successCount = Object.values(result).filter(r => r !== null).length;
    console.log(`[FindyMail] Batch complete: ${successCount}/${domains.length} successful`);

    return result;
  }

  /**
   * Enrich a single domain using FindyMail's domain search endpoint
   * Throws errors for retry logic, returns null only for JSON parsing issues
   */
  async enrichSingle(
    domain: string,
    options?: EnrichmentOptions,
  ): Promise<EnrichmentResult | null> {
    if (options?.perRole && options.roles && options.roles.length > 0) {
      return await this.enrichPerRoles(domain, options.roles, options);
    }

    console.log(`[FindyMail] Enriching domain: ${domain}`);
    const limit = options?.limit ?? 1;
    return await this.fetchDomainSearch(domain, resolveRoles(options), limit);
  }

  /**
   * POST /search/domain with retries for transient 429/504 responses.
   */
  private async fetchDomainSearch(
    domain: string,
    roles: string[],
    limit: number,
  ): Promise<EnrichmentResult | null> {
    let attempt = 0;

    while (attempt < SINGLE_REQUEST_MAX_RETRIES) {
      attempt += 1;
      const timeout = createTimeoutController(FINDYMAIL_TIMEOUT_MS);
      let response: Response;

      try {
        response = await fetch(`${FINDYMAIL_BASE_URL}/search/domain`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain,
            roles,
            limit,
          }),
          signal: timeout.signal,
        });
      } catch (error) {
        timeout.clear();
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            `FindyMail request timed out after ${FINDYMAIL_TIMEOUT_MS}ms`,
          );
        }
        throw error;
      } finally {
        timeout.clear();
      }

      if (response.status === 429 || response.status === 504) {
        const errorText = await response.text();
        const apiError = classifyFindyMailError(response.status, errorText);

        if (shouldBlockPipeline(apiError)) {
          const error = new Error(
            `FindyMail API error: ${response.status} ${response.statusText}`,
          ) as Error & { apiError?: ApiError };
          error.apiError = apiError;
          throw error;
        }

        if (attempt >= SINGLE_REQUEST_MAX_RETRIES) {
          const error = new Error(
            `FindyMail API error: ${response.status} ${response.statusText}`,
          ) as Error & { apiError?: ApiError; retryAfterMs?: number };
          error.apiError = apiError;
          error.retryAfterMs =
            apiError.retryAfterMs ??
            parseRetryAfter(response.headers.get("retry-after")) ??
            undefined;
          throw error;
        }

        const retryAfterHeader = parseRetryAfter(response.headers.get("retry-after"));
        const delayMs =
          retryAfterHeader ??
          apiError.retryAfterMs ??
          withJitter(
            Math.min(
              SINGLE_REQUEST_MAX_DELAY_MS,
              SINGLE_REQUEST_BASE_DELAY_MS * 2 ** (attempt - 1),
            ),
          );

        console.warn(
          `[FindyMail] ${domain} transient status=${response.status}, retry ${attempt}/${SINGLE_REQUEST_MAX_RETRIES} in ${Math.round(delayMs)}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorBody: unknown = errorText;
        try {
          errorBody = JSON.parse(errorText);
        } catch {
          // keep text body
        }

        const apiError = classifyFindyMailError(response.status, errorBody);

        console.error(`[FindyMail] API error for ${domain}:`, {
          status: response.status,
          statusText: response.statusText,
          errorCode: apiError.errorCode,
          category: apiError.category,
          userMessage: apiError.userMessage,
          retryable: apiError.retryable,
        });

        const error = new Error(
          `FindyMail API error: ${response.status} ${response.statusText}`,
        ) as Error & { apiError?: ApiError };
        error.apiError = apiError;
        throw error;
      }

      try {
        const findyMailData = await response.json();
        console.log(`[FindyMail] Response for ${domain}:`, {
          hasData: !!findyMailData,
          contactCount: findyMailData?.contacts?.length || 0,
          emailCount: findyMailData?.emails?.length || 0,
        });

        return this.transformToEnrichmentResult(findyMailData);
      } catch (error) {
        console.error(`[FindyMail] Failed to parse response for ${domain}:`, error);
        return null;
      }
    }

    return null;
  }

  /**
   * Fetch contacts per role pattern (one API call per pattern), merge by email.
   * Patterns are capped and fetched sequentially with delays to reduce 429s.
   */
  async enrichPerRoles(
    domain: string,
    roles: string[],
    options?: EnrichmentOptions,
  ): Promise<EnrichmentResult | null> {
    const rolesToFetch = resolveRolesForPerRoleFetch({
      ...options,
      roles,
    });
    const perRoleLimit = options?.limit ?? DEFAULT_PER_ROLE_CONTACT_LIMIT;

    console.log(
      `[FindyMail] Per-role enrichment for ${domain}: ${rolesToFetch.length} role pattern(s), limit=${perRoleLimit} per pattern`,
    );

    const mergedContacts: EnrichmentResult["contacts"] = [];
    const mergedEmails: EnrichmentResult["emails"] = [];
    const seenEmails = new Set<string>();

    for (let index = 0; index < rolesToFetch.length; index += 1) {
      const role = rolesToFetch[index]!;

      if (mergedContacts.length >= PER_ROLE_EARLY_EXIT_CONTACTS) {
        console.log(
          `[FindyMail] Early exit for ${domain} after ${mergedContacts.length} contacts`,
        );
        break;
      }

      try {
        const singleRoleResult = await this.enrichSingle(domain, {
          roles: [role],
          limit: perRoleLimit,
          perRole: false,
        });

        if (!singleRoleResult) {
          continue;
        }

        for (const contact of singleRoleResult.contacts) {
          const email = contact.email?.toLowerCase().trim();
          if (!email || seenEmails.has(email)) {
            continue;
          }
          seenEmails.add(email);
          mergedContacts.push({
            ...contact,
            domain,
            sourceRole: role,
            title: contact.title?.trim() || undefined,
          });
        }

        for (const emailEntry of singleRoleResult.emails) {
          const email = emailEntry.email?.toLowerCase().trim();
          if (!email || seenEmails.has(email)) {
            continue;
          }
          seenEmails.add(email);
          mergedEmails.push(emailEntry);
        }
      } catch (error) {
        const apiError = (error as Error & { apiError?: ApiError }).apiError;
        if (apiError && shouldBlockPipeline(apiError)) {
          throw error;
        }
        console.warn(
          `[FindyMail] Per-role fetch failed for ${domain} role="${role}":`,
          error instanceof Error ? error.message : String(error),
        );
      }

      if (index < rolesToFetch.length - 1) {
        await sleep(PER_ROLE_FETCH_DELAY_MS);
      }
    }

    if (mergedContacts.length === 0 && mergedEmails.length === 0) {
      return null;
    }

    return {
      emails: mergedEmails,
      contacts: mergedContacts,
      metadata: {
        provider: "findymail",
        confidence:
          mergedContacts.length > 0
            ? Math.max(...mergedContacts.map((c) => c.confidence ?? 0))
            : 0,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Transform FindyMail response to our standard format
   * Handles various response formats from FindyMail API
   */
  private transformToEnrichmentResult(
    findyMailData: any
  ): EnrichmentResult {
    const toConfidence = (value: any): number => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const normalizeContactName = (contact: any): string => {
      if (typeof contact?.name === "string" && contact.name.trim().length > 0) {
        return contact.name.trim();
      }
      const parts = [contact?.first_name, contact?.last_name]
        .map((part: any) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join(" ");
      }
      if (typeof contact?.email === "string" && contact.email.trim().length > 0) {
        return contact.email.trim();
      }
      return "Unknown contact";
    };

    const normalizeTitle = (contact: any): string | undefined => {
      const candidate =
        contact?.title ??
        contact?.job_title ??
        contact?.role ??
        contact?.position ??
        contact?.occupation;
      return typeof candidate === "string" && candidate.trim().length > 0
        ? candidate.trim()
        : undefined;
    };

    const normalizeLinkedIn = (contact: any): string | undefined => {
      const candidate =
        contact?.linkedin ??
        contact?.linkedin_profile ??
        contact?.linkedin_url ??
        contact?.linkedinProfile ??
        contact?.li;
      return typeof candidate === "string" && candidate.trim().length > 0
        ? candidate.trim()
        : undefined;
    };

    const extractContacts = (): any[] => {
      if (Array.isArray(findyMailData?.contacts)) {
        return findyMailData.contacts;
      }
      if (Array.isArray(findyMailData?.data?.contacts)) {
        return findyMailData.data.contacts;
      }
      if (Array.isArray(findyMailData?.results?.contacts)) {
        return findyMailData.results.contacts;
      }
      return [];
    };

    const extractEmails = (): any[] => {
      if (Array.isArray(findyMailData?.emails)) {
        return findyMailData.emails;
      }
      if (Array.isArray(findyMailData?.data?.emails)) {
        return findyMailData.data.emails;
      }
      if (Array.isArray(findyMailData?.results?.emails)) {
        return findyMailData.results.emails;
      }
      return [];
    };

    // Handle null/undefined data
    if (!findyMailData) {
      return {
        emails: [],
        contacts: [],
        metadata: {
          provider: "findymail",
          confidence: 0,
          timestamp: Date.now(),
        },
      };
    }

    // Extract contacts - handle different response formats
    const rawContacts = extractContacts();
    const contacts = rawContacts.map((contact: any) => {
      const confidence = toConfidence(
        contact?.confidence ??
          contact?.confidence_score ??
          contact?.confidenceScore ??
          contact?.score ??
          contact?.certainty ??
          contact?.accuracy ??
          contact?.email_confidence
      );
      const verified = isContactEmailVerified({
        ...contact,
        confidence,
        score: contact?.score ?? confidence,
      });

      return {
        name: normalizeContactName(contact),
        title: normalizeTitle(contact),
        email:
          typeof contact?.email === "string" && contact.email.trim().length > 0
            ? contact.email.trim()
            : undefined,
        linkedin: normalizeLinkedIn(contact),
        confidence,
        verified,
      };
    });

    // Extract emails from contacts array (FindyMail API structure)
    // Each contact object contains: { name, email, domain, first_name, ... }
    const rawEmails = extractEmails();

    const emailsFromApi = rawEmails
      .filter((email: any) => typeof email?.email === "string")
      .map((email: any) => ({
        email: email.email.trim(),
        type:
          typeof email?.type === "string" && email.type.trim().length > 0
            ? email.type.trim()
            : "generic",
        confidence: toConfidence(
          email?.confidence ??
            email?.confidence_score ??
            email?.confidenceScore ??
            email?.score ??
            email?.certainty ??
            email?.accuracy
        ),
        verified:
          typeof email?.verified === "boolean"
            ? email.verified
            : isContactEmailVerified(email),
      }));

    const emailsFromContacts = contacts
      .filter((contact) => contact.email)
      .map((contact) => ({
        email: contact.email!,
        type: "contact",
        confidence: contact.confidence,
        verified: contact.verified,
      }));

    const seenEmails = new Set<string>();
    const emails = [...emailsFromApi, ...emailsFromContacts].filter((email) => {
      if (seenEmails.has(email.email)) {
        return false;
      }
      seenEmails.add(email.email);
      return true;
    });

    // Extract social profiles
    const socialProfiles = findyMailData.socialProfiles ||
                          findyMailData.data?.socialProfiles ||
                          findyMailData.results?.socialProfiles;

    return {
      emails: emails,
      contacts: contacts,
      socialProfiles: socialProfiles,
      metadata: {
        provider: "findymail",
        confidence: this.calculateConfidence({ emails }),
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Calculate overall confidence based on FindyMail data
   */
  private calculateConfidence(data: any): number {
    if (!data.emails || data.emails.length === 0) {
      return 0;
    }

    const totalConfidence = data.emails.reduce(
      (sum: number, email: any) => sum + (email.confidence || 0),
      0
    );

    return totalConfidence / data.emails.length;
  }

  /**
   * Validate API key by making a test request to credits endpoint
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${FINDYMAIL_BASE_URL}/credits`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error("FindyMail API key validation failed:", error);
      return false;
    }
  }

  /**
   * Get remaining credits
   */
  async getCredits(apiKey: string): Promise<number> {
    try {
      const response = await fetch(`${FINDYMAIL_BASE_URL}/credits`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to get credits");
      }

      const data = await response.json() as { credits?: number };
      return data.credits || 0;
    } catch (error) {
      console.error("Failed to get FindyMail credits:", error);
      return 0;
    }
  }

  /**
   * Comprehensive health check for FindyMail API
   * Checks authentication, credits, and API availability
   *
   * @returns Health check result with detailed status
   */
  async healthCheck(apiKey: string): Promise<FindyMailHealthCheckResult> {
    const startTime = Date.now();

    try {
      // Test 1: Check credits endpoint (validates auth + API availability)
      const creditsResponse = await fetch(`${FINDYMAIL_BASE_URL}/credits`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      const responseTime = Date.now() - startTime;

      if (creditsResponse.status === 401) {
        return {
          healthy: false,
          status: "auth_failed",
          message: "FindyMail API key is invalid or expired",
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      if (creditsResponse.status === 402) {
        const data = await creditsResponse.json().catch(() => ({}));
        return {
          healthy: false,
          status: "credits_exhausted",
          message: "FindyMail account has no remaining credits",
          credits: 0,
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      if (creditsResponse.status === 423) {
        return {
          healthy: false,
          status: "subscription_paused",
          message: "FindyMail subscription is paused. Please reactivate your subscription.",
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      if (creditsResponse.status === 429) {
        return {
          healthy: true,
          status: "rate_limited",
          message: "FindyMail API is available but currently rate limited",
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      if (!creditsResponse.ok) {
        return {
          healthy: false,
          status: "api_error",
          message: `FindyMail API returned status ${creditsResponse.status}`,
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      // Parse credits response
      const creditsData = await creditsResponse.json() as { credits?: number };
      const credits = creditsData.credits ?? 0;

      // Determine health status based on credits
      if (credits === 0) {
        return {
          healthy: false,
          status: "credits_exhausted",
          message: "FindyMail account has no remaining credits",
          credits: 0,
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      if (credits < 10) {
        return {
          healthy: true,
          status: "low_credits",
          message: `FindyMail API is healthy but credits are low (${credits} remaining)`,
          credits,
          responseTimeMs: responseTime,
          timestamp: Date.now(),
        };
      }

      // Full health
      return {
        healthy: true,
        status: "healthy",
        message: `FindyMail API is fully operational`,
        credits,
        responseTimeMs: responseTime,
        timestamp: Date.now(),
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
          return {
            healthy: false,
            status: "timeout",
            message: "FindyMail API health check timed out (>10s)",
            responseTimeMs: responseTime,
            timestamp: Date.now(),
          };
        }

        if (error.message.includes("fetch") || error.message.includes("network")) {
          return {
            healthy: false,
            status: "network_error",
            message: `Network error connecting to FindyMail API: ${error.message}`,
            responseTimeMs: responseTime,
            timestamp: Date.now(),
          };
        }
      }

      return {
        healthy: false,
        status: "unknown_error",
        message: `FindyMail health check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTimeMs: responseTime,
        timestamp: Date.now(),
      };
    }
  }
}

/**
 * Health check result interface
 */
export interface FindyMailHealthCheckResult {
  healthy: boolean;
  status:
    | "healthy"
    | "low_credits"
    | "credits_exhausted"
    | "auth_failed"
    | "subscription_paused"
    | "rate_limited"
    | "api_error"
    | "timeout"
    | "network_error"
    | "unknown_error";
  message: string;
  credits?: number;
  responseTimeMs: number;
  timestamp: number;
}

type DomainContact = { name?: string; email: string; verified: boolean };

function isTruthyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function deriveContactName(entry: any): string | undefined {
  if (isTruthyString(entry?.name)) {
    return entry.name.trim();
  }
  const parts = [entry?.first_name, entry?.last_name]
    .filter(isTruthyString)
    .map((part: string) => part.trim());
  if (parts.length > 0) {
    return parts.join(" ");
  }
  if (isTruthyString(entry?.full_name)) {
    return entry.full_name.trim();
  }
  if (isTruthyString(entry?.email)) {
    return entry.email.trim();
  }
  return undefined;
}

function extractConfidence(entry: any): number | undefined {
  const sources = [
    entry?.confidence,
    entry?.confidence_score,
    entry?.confidenceScore,
    entry?.score,
    entry?.certainty,
    entry?.accuracy,
  ];
  for (const source of sources) {
    if (typeof source === "number" && Number.isFinite(source)) {
      return source;
    }
    if (typeof source === "string") {
      const parsed = Number.parseFloat(source);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function isVerified(entry: any): boolean {
  const flags = [
    entry?.verified,
    entry?.is_verified,
    entry?.email_verified,
    entry?.emailVerified,
    entry?.verification_status,
    entry?.verificationStatus,
    entry?.status,
    entry?.email_status,
  ];

  for (const flag of flags) {
    if (typeof flag === "boolean") {
      return flag;
    }
    if (isTruthyString(flag)) {
      const normalized = flag.trim().toLowerCase();
      if (["verified", "valid", "deliverable", "success", "accept_all"].includes(normalized)) {
        return true;
      }
      if (["unverified", "invalid", "undeliverable", "unknown"].includes(normalized)) {
        return false;
      }
    }
  }

  const confidence = extractConfidence(entry);
  if (typeof confidence === "number") {
    return confidence >= 0.7;
  }

  return false;
}

function normalizeEmail(value: any): string | null {
  if (!isTruthyString(value)) {
    return null;
  }
  const candidate = value.trim().toLowerCase();
  if (!candidate.includes("@")) {
    return null;
  }
  return candidate;
}

function extractVerifiedContacts(payload: any): DomainContact[] {
  const collected = new Map<string, DomainContact>();

  const candidateArrays = [
    payload?.contacts,
    payload?.data?.contacts,
    payload?.results?.contacts,
  ];

  for (const array of candidateArrays) {
    if (!Array.isArray(array)) {
      continue;
    }
    for (const entry of array) {
      const email = normalizeEmail(entry?.email);
      if (!email) {
        continue;
      }
      const verified = isVerified(entry);
      const name = deriveContactName(entry);
      const existing = collected.get(email);
      if (!existing) {
        collected.set(email, { email, name, verified });
      } else if (verified && !existing.verified) {
        collected.set(email, { email, name: name ?? existing.name, verified });
      }
    }
  }

  const emailArrays = [payload?.emails, payload?.data?.emails, payload?.results?.emails];
  for (const array of emailArrays) {
    if (!Array.isArray(array)) {
      continue;
    }
    for (const entry of array) {
      const email = normalizeEmail(entry?.email);
      if (!email) {
        continue;
      }
      const verified = isVerified(entry);
      const name = deriveContactName(entry);
      const existing = collected.get(email);
      if (!existing) {
        collected.set(email, { email, name, verified });
      } else if (verified && !existing.verified) {
        collected.set(email, { email, name: name ?? existing.name, verified });
      }
    }
  }

  return Array.from(collected.values()).filter((contact) => contact.verified);
}

interface DomainResolveOptions {
  apiKey?: string;
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

interface DomainRequestOptions {
  apiKey: string;
  roles: string[];
  maxRetries: number;
  baseDelayMs: number;
}

interface FetchDomainResult {
  contacts: DomainContact[];
  apiError?: ApiError;
}

async function fetchDomainContacts(
  domain: string,
  { apiKey, roles, maxRetries, baseDelayMs }: DomainRequestOptions,
): Promise<FetchDomainResult> {
  const maxDelayMs = 15_000;
  const startedAt = Date.now();
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt += 1;
    const attemptStartedAt = Date.now();
    try {
      const timeout = createTimeoutController(FINDYMAIL_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${FINDYMAIL_BASE_URL}/search/domain`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain,
            roles,
            limit: 5,
          }),
          signal: timeout.signal,
        });
      } finally {
        timeout.clear();
      }

      const elapsed = Date.now() - attemptStartedAt;
      console.info(
        `[FindyMail] domain=${domain} attempt=${attempt} status=${response.status} durationMs=${elapsed}`,
      );

      if (response.status === 429 || response.status === 504) {
        // Classify the error to check if it's a persistent rate limit (credits exhausted)
        const errorBody = await response.text().catch(() => "");
        const apiError = classifyFindyMailError(response.status, errorBody);

        // If this is a pipeline-blocking error (credits exhausted), don't retry
        if (shouldBlockPipeline(apiError)) {
          console.error(
            `[FindyMail] domain=${domain} pipeline-blocking error:`,
            { errorCode: apiError.errorCode, category: apiError.category }
          );
          return { contacts: [], apiError };
        }

        if (attempt >= maxRetries) {
          console.warn(
            `[FindyMail] domain=${domain} exhausted retries after ${attempt} attempts (status ${response.status})`,
          );
          break;
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delayMs = retryAfter ?? Math.min(maxDelayMs, withJitter(baseDelayMs * 2 ** (attempt - 1)));
        console.warn(
          `[FindyMail] domain=${domain} transient status=${response.status}, retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        const apiError = classifyFindyMailError(response.status, body);

        // Check if this is a user-actionable error that should block the pipeline
        if (shouldBlockPipeline(apiError)) {
          console.error(
            `[FindyMail] domain=${domain} pipeline-blocking error ${response.status}:`,
            { errorCode: apiError.errorCode, category: apiError.category, userMessage: apiError.userMessage }
          );
          return { contacts: [], apiError };
        }

        if (response.status >= 400 && response.status < 500) {
          console.warn(
            `[FindyMail] domain=${domain} non-retriable error ${response.status}: ${body.slice(0, 200)}`,
          );
          break;
        }
        if (attempt >= maxRetries) {
          console.error(
            `[FindyMail] domain=${domain} failed after ${attempt} attempts: ${body.slice(0, 200)}`,
          );
          break;
        }
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delayMs = retryAfter ?? Math.min(maxDelayMs, withJitter(baseDelayMs * 2 ** (attempt - 1)));
        console.warn(
          `[FindyMail] domain=${domain} server error ${response.status}, retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      const payload = await response.json();
      const contacts = extractVerifiedContacts(payload);
      const totalElapsed = Date.now() - startedAt;
      console.info(
        `[FindyMail] domain=${domain} resolved ${contacts.length} verified contacts in ${totalElapsed}ms`,
      );
      return { contacts };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = new Error(
          `FindyMail request timed out after ${FINDYMAIL_TIMEOUT_MS}ms`,
        );
        if (attempt >= maxRetries) {
          console.error(`[FindyMail] domain=${domain} network error:`, timeoutError);
          break;
        }
        const delayMs = Math.min(maxDelayMs, withJitter(baseDelayMs * 2 ** (attempt - 1)));
        console.warn(
          `[FindyMail] domain=${domain} attempt ${attempt} failed (${timeoutError.message}), retrying in ${delayMs}ms`,
        );
        await sleep(delayMs);
        continue;
      }
      if (attempt >= maxRetries) {
        console.error(`[FindyMail] domain=${domain} network error:`, error);
        break;
      }
      const delayMs = Math.min(maxDelayMs, withJitter(baseDelayMs * 2 ** (attempt - 1)));
      console.warn(
        `[FindyMail] domain=${domain} attempt ${attempt} failed (${(error as Error).message}), retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }

  return { contacts: [] };
}

export interface ResolveDomainsResult {
  results: Map<string, { name?: string; email: string }[]>;
  apiError?: ApiError;
}

export async function resolveDomainsWithFindyMail(
  domains: string[],
  roles: string[],
  options: DomainResolveOptions = {},
): Promise<ResolveDomainsResult> {
  const apiKey = options.apiKey ?? process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    throw new Error("FINDYMAIL_API_KEY environment variable is not configured");
  }

  const uniqueDomains = Array.from(
    new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)),
  );

  const results = new Map<string, { name?: string; email: string }[]>();
  if (uniqueDomains.length === 0) {
    return { results };
  }

  const concurrency = Math.min(options.concurrency ?? 5, 5);
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 800;
  const sanitizedRoles = sanitizeRoles(roles, MAX_ROLES_PER_API_REQUEST).roles;

  let pipelineBlockingError: ApiError | undefined;

  // Process domains with early exit on pipeline-blocking errors
  for (let i = 0; i < uniqueDomains.length; i += concurrency) {
    // Check if we already have a pipeline-blocking error
    if (pipelineBlockingError) {
      break;
    }

    const batch = uniqueDomains.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (domain) => {
        const { contacts, apiError } = await fetchDomainContacts(domain, {
          apiKey,
          roles: sanitizedRoles,
          maxRetries,
          baseDelayMs,
        });
        return { domain, contacts, apiError };
      })
    );

    for (const { domain, contacts, apiError } of batchResults) {
      if (contacts.length > 0) {
        results.set(
          domain,
          contacts.map(({ email, name }) => ({ email, name })),
        );
      } else {
        results.set(domain, []);
      }

      // Capture first pipeline-blocking error
      if (apiError && !pipelineBlockingError && shouldBlockPipeline(apiError)) {
        pipelineBlockingError = apiError;
        console.error(`[FindyMail] Pipeline-blocking error detected in resolveDomainsWithFindyMail:`, {
          errorCode: apiError.errorCode,
          category: apiError.category,
          userMessage: apiError.userMessage,
          processedDomains: results.size,
          totalDomains: uniqueDomains.length,
        });
      }
    }
  }

  return { results, apiError: pipelineBlockingError };
}
