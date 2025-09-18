import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
  EnrichmentError,
  IcyPeasSearchResponse,
  IcyPeasSearchResult,
  IcyPeasEmailResult,
} from "./types";

const ICYPEAS_BASE_URL = "https://app.icypeas.com/api";
const POLL_INTERVAL = 1000; // 1 second
const MAX_POLL_ATTEMPTS = 15; // Max 15 seconds of polling
const BATCH_SIZE = 10; // Process in batches of 10 to respect rate limits

export class IcyPeasProvider implements EnrichmentProviderInterface {
  name: EnrichmentProvider = "icypeas";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Enrich multiple domains in batch
   */
  async enrichBatch(domains: string[]): Promise<EnrichmentBatchResult> {
    const result: EnrichmentBatchResult = {};

    // Process domains in smaller batches to respect rate limits
    const batches = this.chunkArray(domains, BATCH_SIZE);

    for (const batch of batches) {
      // Start searches in parallel
      const searchPromises = batch.map(domain =>
        this.startEmailSearch(domain)
      );

      const searchResults = await Promise.allSettled(searchPromises);

      // Poll for results
      const pollPromises = searchResults.map(async (searchResult, index) => {
        const domain = batch[index];
        if (domain && searchResult.status === "fulfilled" && searchResult.value.success) {
          const enrichmentData = await this.pollForResults(searchResult.value.searchId);
          result[domain] = this.transformToEnrichmentResult(enrichmentData);
        } else if (domain) {
          result[domain] = null;
        }
      });

      await Promise.all(pollPromises);

      // Add small delay between batches to respect rate limits
      if (batches.indexOf(batch) < batches.length - 1) {
        await this.delay(1000);
      }
    }

    return result;
  }

  /**
   * Enrich a single domain
   */
  async enrichSingle(domain: string): Promise<EnrichmentResult | null> {
    try {
      // Extract company name from domain for better search results
      const companyName = this.extractCompanyName(domain);

      // Start the search
      const searchResponse = await this.startEmailSearch(domain, companyName);

      if (!searchResponse.success) {
        throw new Error(searchResponse.message || "Search initiation failed");
      }

      // Poll for results
      const result = await this.pollForResults(searchResponse.searchId);

      return this.transformToEnrichmentResult(result);
    } catch (error) {
      console.error(`IcyPeas enrichment failed for ${domain}:`, error);
      return null;
    }
  }

  /**
   * Start an email search
   */
  private async startEmailSearch(
    domain: string,
    companyName?: string
  ): Promise<IcyPeasSearchResponse> {
    const url = `${ICYPEAS_BASE_URL}/email-search`;

    const body = {
      domainOrCompany: domain,
      // If we have a company name, use domain search instead
      ...(companyName && { company: companyName }),
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`IcyPeas API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as IcyPeasSearchResponse;
    } catch (error) {
      throw new Error(`Failed to start IcyPeas search: ${error}`);
    }
  }

  /**
   * Poll for search results
   */
  private async pollForResults(searchId: string): Promise<IcyPeasSearchResult> {
    const url = `${ICYPEAS_BASE_URL}/bulk-single-searchs/read`;

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ searchId }),
        });

        if (!response.ok) {
          throw new Error(`IcyPeas polling error: ${response.status}`);
        }

        const result = await response.json() as IcyPeasSearchResult;

        // Check if search is complete
        if (result.status === "FOUND" || result.status === "NOT_FOUND") {
          return result;
        }

        // If still processing, wait and try again
        if (result.status === "ERROR") {
          throw new Error("Search failed on IcyPeas side");
        }

        await this.delay(POLL_INTERVAL);
      } catch (error) {
        if (attempt === MAX_POLL_ATTEMPTS - 1) {
          throw error;
        }
        await this.delay(POLL_INTERVAL);
      }
    }

    throw new Error("Polling timeout - search took too long");
  }

  /**
   * Transform IcyPeas result to our standard format
   */
  private transformToEnrichmentResult(
    icyPeasResult: IcyPeasSearchResult | null
  ): EnrichmentResult | null {
    if (!icyPeasResult || icyPeasResult.status !== "FOUND") {
      return null;
    }

    const emails = (icyPeasResult.emails || []).map((email: IcyPeasEmailResult) => ({
      email: email.email,
      type: this.mapCertaintyToType(email.certainty),
      confidence: this.mapCertaintyToConfidence(email.certainty),
      verified: true, // IcyPeas does triple verification
    }));

    const contacts = (icyPeasResult.contacts || []).map((contact: any) => ({
      name: contact.name || "",
      title: contact.title,
      email: contact.email,
      linkedin: contact.linkedin,
      confidence: 0.8, // Default confidence for contacts
      domain: contact.domain,
    }));

    return {
      emails,
      contacts,
      socialProfiles: this.extractSocialProfiles(icyPeasResult),
      phone: icyPeasResult.phoneNumbers?.[0],
      companyInfo: icyPeasResult.companyInfo,
      metadata: {
        provider: "icypeas",
        confidence: this.calculateOverallConfidence(emails),
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Map IcyPeas certainty levels to email types
   */
  private mapCertaintyToType(certainty: string): string {
    switch (certainty) {
      case "ULTRA_SURE":
        return "verified";
      case "SURE":
        return "professional";
      case "MEDIUM":
        return "likely";
      case "LOW":
        return "guess";
      default:
        return "unknown";
    }
  }

  /**
   * Map IcyPeas certainty to confidence score
   */
  private mapCertaintyToConfidence(certainty: string): number {
    switch (certainty) {
      case "ULTRA_SURE":
        return 0.99;
      case "SURE":
        return 0.90;
      case "MEDIUM":
        return 0.70;
      case "LOW":
        return 0.40;
      default:
        return 0.30;
    }
  }

  /**
   * Extract social profiles from IcyPeas result
   */
  private extractSocialProfiles(result: IcyPeasSearchResult): any {
    // IcyPeas may include social profiles in contacts
    const profiles: any = {};

    if (result.contacts) {
      for (const contact of result.contacts) {
        if (contact.linkedin && !profiles.linkedin) {
          profiles.linkedin = contact.linkedin;
        }
        if (contact.twitter && !profiles.twitter) {
          profiles.twitter = contact.twitter;
        }
      }
    }

    return Object.keys(profiles).length > 0 ? profiles : undefined;
  }

  /**
   * Calculate overall confidence score
   */
  private calculateOverallConfidence(emails: any[]): number {
    if (emails.length === 0) return 0;

    const totalConfidence = emails.reduce((sum, email) => sum + email.confidence, 0);
    return totalConfidence / emails.length;
  }

  /**
   * Validate API key by making a test request
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${ICYPEAS_BASE_URL}/credits`, {
        method: "GET",
        headers: {
          "Authorization": apiKey,
        },
      });

      return response.ok;
    } catch (error) {
      console.error("IcyPeas API key validation failed:", error);
      return false;
    }
  }

  /**
   * Get remaining credits
   */
  async getCredits(apiKey: string): Promise<number> {
    try {
      const response = await fetch(`${ICYPEAS_BASE_URL}/credits`, {
        method: "GET",
        headers: {
          "Authorization": apiKey,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to get credits");
      }

      const data = await response.json() as { credits?: number };
      return data.credits || 0;
    } catch (error) {
      console.error("Failed to get IcyPeas credits:", error);
      return 0;
    }
  }

  /**
   * Extract company name from domain
   */
  private extractCompanyName(domain: string): string {
    // Remove common TLDs and www
    const cleaned = domain
      .replace(/^www\./, "")
      .replace(/\.(com|org|net|io|co|ai|app|dev|tech).*$/, "");

    // Capitalize first letter
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  /**
   * Helper to chunk array into smaller batches
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Helper to add delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}