import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
  FindyMailResponse,
} from "./types";

const FINDYMAIL_BASE_URL = "https://app.findymail.com/api";

export class FindyMailProvider implements EnrichmentProviderInterface {
  name: EnrichmentProvider = "findymail";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Enrich multiple domains in batch using FindyMail's domain search API
   * Note: FindyMail uses /search/domain endpoint with individual domain requests
   */
  async enrichBatch(domains: string[]): Promise<EnrichmentBatchResult> {
    const result: EnrichmentBatchResult = {};

    if (domains.length === 0) {
      return result;
    }

    console.log(`[FindyMail] Starting batch enrichment for ${domains.length} domains`);

    // Process domains individually since FindyMail doesn't have a true bulk endpoint
    // Process in parallel with rate limiting
    const promises = domains.map(async (domain) => {
      try {
        const enrichmentResult = await this.enrichSingle(domain);
        return { domain, result: enrichmentResult };
      } catch (error) {
        console.error(`[FindyMail] Failed to enrich ${domain}:`, error);
        return { domain, result: null };
      }
    });

    const results = await Promise.all(promises);

    // Build result map
    for (const { domain, result: enrichmentResult } of results) {
      result[domain] = enrichmentResult;
    }

    const successCount = Object.values(result).filter(r => r !== null).length;
    console.log(`[FindyMail] Batch complete: ${successCount}/${domains.length} successful`);

    return result;
  }

  /**
   * Enrich a single domain using FindyMail's domain search endpoint
   */
  async enrichSingle(domain: string): Promise<EnrichmentResult | null> {
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
          limit: 10, // Get up to 10 contacts per domain
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

    // Extract emails - handle different response formats
    let emails: any[] = [];
    if (Array.isArray(findyMailData.emails)) {
      emails = findyMailData.emails;
    } else if (findyMailData.data?.emails) {
      emails = findyMailData.data.emails;
    } else if (findyMailData.results?.emails) {
      emails = findyMailData.results.emails;
    }

    // Extract contacts - handle different response formats
    let contacts: any[] = [];
    if (Array.isArray(findyMailData.contacts)) {
      contacts = findyMailData.contacts;
    } else if (findyMailData.data?.contacts) {
      contacts = findyMailData.data.contacts;
    } else if (findyMailData.results?.contacts) {
      contacts = findyMailData.results.contacts;
    }

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