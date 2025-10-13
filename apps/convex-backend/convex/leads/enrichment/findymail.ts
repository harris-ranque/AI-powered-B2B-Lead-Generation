import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
  EnrichmentOptions,
} from "./types";

const FINDYMAIL_BASE_URL = "https://app.findymail.com/api";

const DEFAULT_ROLES = ["ceo", "founder", "owner"] as const;
const MAX_ROLES = 3;

function sanitizeRoles(roles?: string[] | null): string[] {
  if (!roles || roles.length === 0) {
    return [...DEFAULT_ROLES];
  }

  const normalized = roles
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);

  const deduped: string[] = [];
  for (const role of normalized) {
    if (!deduped.includes(role)) {
      deduped.push(role);
    }
    if (deduped.length >= MAX_ROLES) {
      break;
    }
  }

  if (deduped.length === 0) {
    return [...DEFAULT_ROLES];
  }

  return deduped.slice(0, MAX_ROLES);
}

function resolveRoles(options?: EnrichmentOptions): string[] {
  return sanitizeRoles(options?.roles);
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
    const CONCURRENT_REQUESTS = 3; // Max concurrent requests (API limit is 5)
    const DELAY_BETWEEN_BATCHES_MS = 500; // 500ms delay between batches for heavy processing
    const RETRY_ATTEMPTS = 2; // Number of retry attempts for failed requests

    // Process domains in controlled batches
    const batches: string[][] = [];
    for (let i = 0; i < domains.length; i += CONCURRENT_REQUESTS) {
      batches.push(domains.slice(i, i + CONCURRENT_REQUESTS));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]!;
      console.log(`[FindyMail] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} domains) - respecting 5 concurrent request limit`);

      // Process batch with retries
      const batchPromises = batch.map(async (domain) => {
        for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
          try {
            const enrichmentResult = await this.enrichSingle(domain, options);
            return { domain, result: enrichmentResult };
          } catch (error: any) {
            const isRateLimitError = error?.message?.includes("429") || error?.message?.includes("Too Many Requests");
            const isGatewayError = error?.message?.includes("504") || error?.message?.includes("Gateway");

            if ((isRateLimitError || isGatewayError) && attempt < RETRY_ATTEMPTS) {
              const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
              console.log(`[FindyMail] Rate limit/gateway error for ${domain}, retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              continue;
            }

            console.error(`[FindyMail] Failed to enrich ${domain} after ${attempt + 1} attempts:`, error?.message || error);
            return { domain, result: null };
          }
        }
        return { domain, result: null };
      });

      const batchResults = await Promise.all(batchPromises);

      // Collect results
      for (const { domain, result: enrichmentResult } of batchResults) {
        result[domain] = enrichmentResult;
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
   */
  async enrichSingle(
    domain: string,
    options?: EnrichmentOptions,
  ): Promise<EnrichmentResult | null> {
    try {
      console.log(`[FindyMail] Enriching domain: ${domain}`);

      const response = await fetch(`${FINDYMAIL_BASE_URL}/search/domain`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domain: domain,
          roles: resolveRoles(options),
          limit: 1, // Get top contact per domain
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[FindyMail] API error for ${domain}:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(
          `FindyMail API error: ${response.status} ${response.statusText}`
        );
      }

      const findyMailData = await response.json();
      console.log(`[FindyMail] Response for ${domain}:`, {
        hasData: !!findyMailData,
        contactCount: findyMailData?.contacts?.length || 0,
        emailCount: findyMailData?.emails?.length || 0,
      });

      return this.transformToEnrichmentResult(findyMailData);
    } catch (error) {
      console.error(`[FindyMail] Failed to enrich ${domain}:`, error);
      return null;
    }
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
    const contacts = rawContacts.map((contact: any) => ({
      name: normalizeContactName(contact),
      title: normalizeTitle(contact),
      email:
        typeof contact?.email === "string" && contact.email.trim().length > 0
          ? contact.email.trim()
          : undefined,
      linkedin: normalizeLinkedIn(contact),
      confidence: toConfidence(
        contact?.confidence ??
          contact?.confidence_score ??
          contact?.confidenceScore ??
          contact?.score ??
          contact?.certainty ??
          contact?.accuracy ??
          contact?.email_confidence
      ),
    }));

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
            : undefined,
      }));

    const emailsFromContacts = contacts
      .filter((contact) => contact.email)
      .map((contact) => ({
        email: contact.email!,
        type: "contact",
        confidence: contact.confidence,
        verified: undefined,
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
}
