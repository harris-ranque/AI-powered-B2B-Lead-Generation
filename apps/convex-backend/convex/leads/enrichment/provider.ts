import { FindyMailProvider } from "./findymail";
import { IcyPeasProvider } from "./icypeas";
import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
} from "./types";

export type EnrichmentProviderType = "findymail" | "icypeas";

/**
 * Factory class for creating and managing enrichment providers
 */
export class EnrichmentProviderFactory {
  /**
   * Create an enrichment provider based on configuration
   */
  static createProvider(
    providerType: EnrichmentProviderType,
    apiKey: string
  ): EnrichmentProviderInterface {
    switch (providerType) {
      case "icypeas":
        return new IcyPeasProvider(apiKey);
      case "findymail":
        return new FindyMailProvider(apiKey);
      default:
        // Default to FindyMail for backward compatibility
        return new FindyMailProvider(apiKey);
    }
  }

  /**
   * Get the configured provider type from environment
   * Default: FindyMail (ICypeas requires firstname/lastname which we don't have in domain-only searches)
   */
  static getConfiguredProvider(): EnrichmentProviderType {
    const provider = process.env.ENRICHMENT_PROVIDER?.toLowerCase();

    // NOTE: ICypeas requires firstname/lastname in discovery mode
    // Since we only have domain names from Google Maps, we default to FindyMail
    if (provider === "icypeas") {
      console.warn(
        "[EnrichmentProvider] ICypeas selected but requires firstname/lastname. " +
        "Consider using FindyMail for domain-only searches."
      );
      return "icypeas";
    }

    // Default to FindyMail (works with domain-only searches)
    return "findymail";
  }

  /**
   * Get the API key for the configured provider
   */
  static getProviderApiKey(
    providerType: EnrichmentProviderType,
    userApiKey?: string
  ): string {
    // Use user-provided API key if available (for enterprise users)
    if (userApiKey) {
      return userApiKey;
    }

    // Otherwise use system API keys
    switch (providerType) {
      case "icypeas":
        return process.env.ICYPEAS_API_KEY || "";
      case "findymail":
        return process.env.FINDYMAIL_API_KEY || "";
      default:
        return process.env.FINDYMAIL_API_KEY || "";
    }
  }

  /**
   * Validate that the required API key is configured
   */
  static isProviderConfigured(providerType: EnrichmentProviderType): boolean {
    const apiKey = this.getProviderApiKey(providerType);
    return apiKey.length > 0;
  }
}

/**
 * Main enrichment service that uses the factory to delegate to providers
 */
export class EnrichmentService {
  private provider: EnrichmentProviderInterface;
  private providerType: EnrichmentProviderType;

  constructor(userApiKey?: string, forceProvider?: EnrichmentProviderType) {
    // Determine which provider to use
    this.providerType = forceProvider || EnrichmentProviderFactory.getConfiguredProvider();

    // Get the appropriate API key
    const apiKey = EnrichmentProviderFactory.getProviderApiKey(
      this.providerType,
      userApiKey
    );

    if (!apiKey) {
      throw new Error(
        `${this.providerType.toUpperCase()} API key not configured`
      );
    }

    // Create the provider instance
    this.provider = EnrichmentProviderFactory.createProvider(
      this.providerType,
      apiKey
    );
  }

  /**
   * Enrich multiple domains
   */
  async enrichBatch(domains: string[]): Promise<EnrichmentBatchResult> {
    try {
      console.log(
        `Enriching ${domains.length} domains using ${this.providerType}`
      );

      const result = await this.provider.enrichBatch(domains);

      // Log success metrics
      const successCount = Object.values(result).filter(r => r !== null).length;
      console.log(
        `Enrichment complete: ${successCount}/${domains.length} successful`
      );

      return result;
    } catch (error) {
      console.error(
        `Enrichment failed with ${this.providerType}:`,
        error
      );

      // Could implement fallback to alternative provider here
      throw error;
    }
  }

  /**
   * Enrich a single domain
   */
  async enrichSingle(domain: string): Promise<EnrichmentResult | null> {
    try {
      console.log(`Enriching domain ${domain} using ${this.providerType}`);
      return await this.provider.enrichSingle(domain);
    } catch (error) {
      console.error(
        `Single enrichment failed for ${domain} with ${this.providerType}:`,
        error
      );
      return null;
    }
  }

  /**
   * Validate API key
   */
  async validateApiKey(): Promise<boolean> {
    const apiKey = EnrichmentProviderFactory.getProviderApiKey(this.providerType);
    return await this.provider.validateApiKey(apiKey);
  }

  /**
   * Get remaining credits
   */
  async getCredits(): Promise<number> {
    const apiKey = EnrichmentProviderFactory.getProviderApiKey(this.providerType);
    return await this.provider.getCredits(apiKey);
  }

  /**
   * Get current provider name
   */
  getProviderName(): string {
    return this.providerType;
  }
}

// Export convenience function for backward compatibility
export function createEnrichmentService(
  userApiKey?: string,
  forceProvider?: EnrichmentProviderType
): EnrichmentService {
  return new EnrichmentService(userApiKey, forceProvider);
}