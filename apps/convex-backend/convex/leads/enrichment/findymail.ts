import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
  FindyMailResponse,
} from "./types";

const FINDYMAIL_BASE_URL = "https://app.findymail.com/api/v1";

export class FindyMailProvider implements EnrichmentProviderInterface {
  name: EnrichmentProvider = "findymail";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Enrich multiple domains in batch using FindyMail's bulk API
   */
  async enrichBatch(domains: string[]): Promise<EnrichmentBatchResult> {
    const result: EnrichmentBatchResult = {};

    if (domains.length === 0) {
      return result;
    }

    try {
      const response = await fetch(`${FINDYMAIL_BASE_URL}/bulk-enrich`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domains: domains,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `FindyMail API error: ${response.status} ${response.statusText}`
        );
      }

      const findyMailData = (await response.json()) as FindyMailResponse;

      // Transform FindyMail response to our standard format
      for (const domain of domains) {
        const domainData = findyMailData[domain];
        if (domainData) {
          result[domain] = this.transformToEnrichmentResult(domainData);
        } else {
          result[domain] = null;
        }
      }

      return result;
    } catch (error) {
      console.error("FindyMail batch enrichment failed:", error);
      // Return empty results for all domains on error
      for (const domain of domains) {
        result[domain] = null;
      }
      return result;
    }
  }

  /**
   * Enrich a single domain
   */
  async enrichSingle(domain: string): Promise<EnrichmentResult | null> {
    const batchResult = await this.enrichBatch([domain]);
    return batchResult[domain] || null;
  }

  /**
   * Transform FindyMail response to our standard format
   */
  private transformToEnrichmentResult(
    findyMailData: any
  ): EnrichmentResult {
    return {
      emails: findyMailData.emails || [],
      contacts: findyMailData.contacts || [],
      socialProfiles: findyMailData.socialProfiles,
      metadata: {
        provider: "findymail",
        confidence: this.calculateConfidence(findyMailData),
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
   * Validate API key by making a test request
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