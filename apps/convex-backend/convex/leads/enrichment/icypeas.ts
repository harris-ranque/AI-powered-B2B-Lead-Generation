import {
  EnrichmentProvider,
  EnrichmentProviderInterface,
  EnrichmentResult,
  EnrichmentBatchResult,
  EnrichmentError,
  EnrichmentOptions,
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
  async enrichBatch(
    domains: string[],
    _options?: EnrichmentOptions,
  ): Promise<EnrichmentBatchResult> {
    const batchStartTime = Date.now();
    const result: EnrichmentBatchResult = {};

    console.log(`[ICypeas] Starting batch enrichment:`, {
      totalDomains: domains.length,
      batchSize: BATCH_SIZE,
      domains: domains.slice(0, 5), // Log first 5 for debugging
      estimatedBatches: Math.ceil(domains.length / BATCH_SIZE)
    });

    // Process domains in smaller batches to respect rate limits
    const batches = this.chunkArray(domains, BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      if (!batch) continue;

      const batchIterationStartTime = Date.now();

      console.log(`[ICypeas] Processing batch ${batchIndex + 1}/${batches.length}:`, {
        batchNumber: batchIndex + 1,
        totalBatches: batches.length,
        domainsInBatch: batch.length,
        domains: batch
      });

      // Start searches in parallel
      const searchPromises = batch.map(domain =>
        this.startEmailSearch(domain)
      );

      const searchResults = await Promise.allSettled(searchPromises);

      // Count actual successes (fulfilled promises with success=true)
      const successfulSearches = searchResults.filter(
        r => r.status === 'fulfilled' && r.value?.success === true
      ).length;
      const failedSearches = searchResults.length - successfulSearches;

      console.log(`[ICypeas] Batch ${batchIndex + 1} search initiation complete:`, {
        batchNumber: batchIndex + 1,
        totalRequests: searchResults.length,
        successful: successfulSearches,
        failed: failedSearches,
        // Log first failure for debugging
        firstFailure: failedSearches > 0 ? searchResults.find(r =>
          r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.success !== true)
        ) : undefined
      });

      // Poll for results
      const pollPromises = searchResults.map(async (searchResult, index) => {
        const domain = batch[index];
        if (!domain) return;

        if (searchResult.status === "fulfilled" && searchResult.value.success && searchResult.value.searchId) {
          console.log(`[ICypeas] Polling for domain ${domain} (batch ${batchIndex + 1}, domain ${index + 1}/${batch.length})`);
          try {
            const enrichmentData = await this.pollForResults(searchResult.value.searchId);
            const transformedResult = this.transformToEnrichmentResult(enrichmentData);
            result[domain] = transformedResult;

            if (transformedResult) {
              console.log(`[ICypeas] ✅ Batch enrichment successful for ${domain}:`, {
                emailsFound: transformedResult.emails?.length || 0,
                contactsFound: transformedResult.contacts?.length || 0
              });
            } else {
              console.warn(`[ICypeas] ⚠️ No enrichment data for ${domain} in batch ${batchIndex + 1}`);
            }
          } catch (error) {
            console.error(`[ICypeas] ❌ Batch poll failed for ${domain}:`, {
              domain,
              batchNumber: batchIndex + 1,
              error: error instanceof Error ? error.message : String(error)
            });
            result[domain] = null;
          }
        } else {
          const errorReason = searchResult.status === 'rejected'
            ? searchResult.reason
            : (searchResult.status === 'fulfilled' ? searchResult.value.message : 'Unknown');

          console.error(`[ICypeas] ❌ Search initiation failed for ${domain}:`, {
            domain,
            batchNumber: batchIndex + 1,
            status: searchResult.status,
            reason: errorReason
          });
          result[domain] = null;
        }
      });

      await Promise.all(pollPromises);

      console.log(`[ICypeas] Batch ${batchIndex + 1} complete:`, {
        batchNumber: batchIndex + 1,
        totalBatches: batches.length,
        batchDuration: Date.now() - batchIterationStartTime,
        successful: Object.values(result).filter(r => r !== null).length,
        failed: Object.values(result).filter(r => r === null).length
      });

      // Add small delay between batches to respect rate limits
      if (batchIndex < batches.length - 1) {
        console.log(`[ICypeas] Waiting 1000ms before next batch to respect rate limits...`);
        await this.delay(1000);
      }
    }

    console.log(`[ICypeas] ✅ Batch enrichment complete:`, {
      totalDomains: domains.length,
      successful: Object.values(result).filter(r => r !== null).length,
      failed: Object.values(result).filter(r => r === null).length,
      successRate: ((Object.values(result).filter(r => r !== null).length / domains.length) * 100).toFixed(2) + '%',
      totalDuration: Date.now() - batchStartTime
    });

    return result;
  }

  /**
   * Enrich a single domain
   */
  async enrichSingle(
    domain: string,
    _options?: EnrichmentOptions,
  ): Promise<EnrichmentResult | null> {
    const startTime = Date.now();
    console.log(`[ICypeas] Starting enrichment for domain: ${domain}`);

    try {
      // Extract company name from domain for better search results
      const companyName = this.extractCompanyName(domain);
      console.log(`[ICypeas] Extracted company name: "${companyName}" from domain: ${domain}`);

      // Start the search
      console.log(`[ICypeas] Initiating email search for domain: ${domain}, company: ${companyName}`);
      const searchResponse = await this.startEmailSearch(domain, companyName);

      if (!searchResponse.success) {
        const errorMsg = searchResponse.message || "Search initiation failed";
        console.error(`[ICypeas] Search initiation failed for ${domain}:`, {
          domain,
          companyName,
          errorMessage: errorMsg,
          searchResponse,
          duration: Date.now() - startTime
        });
        throw new Error(errorMsg);
      }

      console.log(`[ICypeas] Search initiated successfully for ${domain}. Search ID: ${searchResponse.searchId}, Status: ${searchResponse.status}`);

      // Validate searchId before polling
      if (!searchResponse.searchId) {
        throw new Error(`No search ID returned for domain: ${domain}`);
      }

      // Poll for results
      console.log(`[ICypeas] Starting to poll for results. Search ID: ${searchResponse.searchId}`);
      const result = await this.pollForResults(searchResponse.searchId);

      console.log(`[ICypeas] Poll completed for ${domain}. Status: ${result.status}, Emails found: ${result.emails?.length || 0}, Contacts found: ${result.contacts?.length || 0}`);

      const enrichmentResult = this.transformToEnrichmentResult(result);

      if (enrichmentResult) {
        console.log(`[ICypeas] ✅ Enrichment successful for ${domain}:`, {
          domain,
          emailsFound: enrichmentResult.emails?.length || 0,
          contactsFound: enrichmentResult.contacts?.length || 0,
          hasPhone: !!enrichmentResult.phone,
          hasSocialProfiles: !!enrichmentResult.socialProfiles,
          confidence: enrichmentResult.metadata?.confidence,
          duration: Date.now() - startTime
        });
      } else {
        console.warn(`[ICypeas] ⚠️ No enrichment data found for ${domain}:`, {
          domain,
          searchId: searchResponse.searchId,
          resultStatus: result.status,
          duration: Date.now() - startTime
        });
      }

      return enrichmentResult;
    } catch (error) {
      console.error(`[ICypeas] ❌ Enrichment failed for ${domain}:`, {
        domain,
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        duration: Date.now() - startTime
      });
      return null;
    }
  }

  /**
   * Start an email search
   * Note: ICypeas requires firstname OR lastname to be provided, even if empty
   */
  private async startEmailSearch(
    domain: string,
    companyName?: string
  ): Promise<IcyPeasSearchResponse> {
    const url = `${ICYPEAS_BASE_URL}/email-search`;

    // ICypeas API requires firstname OR lastname for email discovery
    // We provide empty strings to enable domain-based search
    const body = {
      firstname: companyName || "",
      lastname: "",
      domainOrCompany: domain,
    };

    console.log(`[ICypeas] Making API request to: ${url}`, {
      domain,
      companyName,
      hasApiKey: !!this.apiKey,
      apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'none'
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      console.log(`[ICypeas] API response received:`, {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ICypeas] API error response:`, {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText,
          url,
          requestBody: body
        });
        throw new Error(`IcyPeas API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const jsonResponse = await response.json() as IcyPeasSearchResponse;

      // Extract searchId from the response (it's in item._id field)
      const searchId = jsonResponse.item?._id || jsonResponse.searchId;
      const status = jsonResponse.item?.status || jsonResponse.status;

      console.log(`[ICypeas] Search response parsed:`, {
        success: jsonResponse.success,
        searchId,
        status,
        message: jsonResponse.message,
        hasValidationErrors: !!jsonResponse.validationErrors
      });

      // Check for validation errors
      if (jsonResponse.validationErrors && jsonResponse.validationErrors.length > 0) {
        const errorMessages = jsonResponse.validationErrors
          .map(e => e.humanReadableMessage || e.message)
          .join('; ');
        console.error(`[ICypeas] Validation errors:`, {
          errors: jsonResponse.validationErrors,
          domain,
          companyName
        });
        throw new Error(`ICypeas validation error: ${errorMessages}`);
      }

      // Validate that the search was actually initiated successfully
      if (!jsonResponse.success) {
        const errorMsg = jsonResponse.message || "ICypeas API returned success=false";
        console.error(`[ICypeas] Search initiation failed:`, {
          success: jsonResponse.success,
          message: jsonResponse.message,
          domain,
          companyName
        });
        throw new Error(errorMsg);
      }

      // Ensure we have a searchId
      if (!searchId) {
        console.error(`[ICypeas] No searchId in response:`, {
          response: jsonResponse,
          domain,
          companyName
        });
        throw new Error("ICypeas API response missing search ID");
      }

      // Return normalized response with searchId
      return {
        success: true,
        searchId,
        status,
        message: jsonResponse.message
      };
    } catch (error) {
      console.error(`[ICypeas] Failed to start search:`, {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        url,
        domain,
        companyName
      });
      throw new Error(`Failed to start IcyPeas search: ${error}`);
    }
  }

  /**
   * Poll for search results
   */
  private async pollForResults(searchId: string): Promise<IcyPeasSearchResult> {
    const url = `${ICYPEAS_BASE_URL}/bulk-single-searchs/read`;
    const pollStartTime = Date.now();

    console.log(`[ICypeas] Starting to poll for results. Search ID: ${searchId}, Max attempts: ${MAX_POLL_ATTEMPTS}, Interval: ${POLL_INTERVAL}ms`);

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const attemptStartTime = Date.now();

      try {
        console.log(`[ICypeas] Poll attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS} for search ID: ${searchId}`);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: searchId }), // Use 'id' field, not 'searchId'
        });

        console.log(`[ICypeas] Poll response received:`, {
          attempt: attempt + 1,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[ICypeas] Poll request failed:`, {
            attempt: attempt + 1,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
            searchId
          });
          throw new Error(`IcyPeas polling error: ${response.status} - ${errorText}`);
        }

        const rawResult = await response.json() as IcyPeasSearchResult;

        // Extract result from items array (new API format)
        const item = rawResult.items?.[0];
        const status = item?.status || rawResult.status;
        const emails = item?.results?.emails || rawResult.emails || [];
        const phones = item?.results?.phones || rawResult.phoneNumbers || [];

        console.log(`[ICypeas] Poll result parsed:`, {
          attempt: attempt + 1,
          searchId,
          status,
          hasEmails: emails.length > 0,
          emailCount: emails.length,
          hasPhones: phones.length > 0,
          phoneCount: phones.length,
          attemptDuration: Date.now() - attemptStartTime
        });

        // Normalize the result format
        const result: IcyPeasSearchResult = {
          success: rawResult.success,
          status: status as "FOUND" | "NOT_FOUND" | "ERROR",
          emails,
          contacts: rawResult.contacts || [],
          phoneNumbers: phones,
          companyInfo: rawResult.companyInfo
        };

        // Check if search is complete
        if (status === "FOUND" || status === "NOT_FOUND") {
          console.log(`[ICypeas] ✅ Poll completed successfully:`, {
            searchId,
            finalStatus: status,
            totalAttempts: attempt + 1,
            totalDuration: Date.now() - pollStartTime,
            emailsFound: emails.length,
            phonesFound: phones.length
          });
          return result;
        }

        // If still processing, wait and try again
        if (status === "ERROR") {
          console.error(`[ICypeas] ❌ Search failed on ICypeas side:`, {
            searchId,
            attempt: attempt + 1,
            status,
            result
          });
          throw new Error("Search failed on IcyPeas side");
        }

        console.log(`[ICypeas] Search still processing, waiting ${POLL_INTERVAL}ms before next attempt...`, {
          searchId,
          currentStatus: result.status,
          attempt: attempt + 1,
          remainingAttempts: MAX_POLL_ATTEMPTS - attempt - 1
        });

        await this.delay(POLL_INTERVAL);
      } catch (error) {
        console.error(`[ICypeas] Poll attempt ${attempt + 1} error:`, {
          searchId,
          attempt: attempt + 1,
          maxAttempts: MAX_POLL_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          willRetry: attempt < MAX_POLL_ATTEMPTS - 1,
          attemptDuration: Date.now() - attemptStartTime
        });

        if (attempt === MAX_POLL_ATTEMPTS - 1) {
          console.error(`[ICypeas] ❌ Max poll attempts reached, giving up:`, {
            searchId,
            totalAttempts: MAX_POLL_ATTEMPTS,
            totalDuration: Date.now() - pollStartTime,
            lastError: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
        await this.delay(POLL_INTERVAL);
      }
    }

    const timeoutError = "Polling timeout - search took too long";
    console.error(`[ICypeas] ❌ Polling timeout:`, {
      searchId,
      maxAttempts: MAX_POLL_ATTEMPTS,
      totalDuration: Date.now() - pollStartTime,
      error: timeoutError
    });
    throw new Error(timeoutError);
  }

  /**
   * Transform IcyPeas result to our standard format
   */
  private transformToEnrichmentResult(
    icyPeasResult: IcyPeasSearchResult | null
  ): EnrichmentResult | null {
    console.log(`[ICypeas] Transforming search result:`, {
      hasResult: !!icyPeasResult,
      status: icyPeasResult?.status,
      hasEmails: !!icyPeasResult?.emails,
      emailCount: icyPeasResult?.emails?.length || 0,
      hasContacts: !!icyPeasResult?.contacts,
      contactCount: icyPeasResult?.contacts?.length || 0
    });

    if (!icyPeasResult || icyPeasResult.status !== "FOUND") {
      console.warn(`[ICypeas] Cannot transform result - invalid or NOT_FOUND status:`, {
        hasResult: !!icyPeasResult,
        status: icyPeasResult?.status,
        expectedStatus: "FOUND"
      });
      return null;
    }

    const emails = (icyPeasResult.emails || []).map((email: IcyPeasEmailResult) => {
      const mappedEmail = {
        email: email.email,
        type: this.mapCertaintyToType(email.certainty),
        confidence: this.mapCertaintyToConfidence(email.certainty),
        verified: true, // IcyPeas does triple verification
      };
      console.log(`[ICypeas] Mapped email:`, {
        email: email.email,
        certainty: email.certainty,
        type: mappedEmail.type,
        confidence: mappedEmail.confidence
      });
      return mappedEmail;
    });

    const contacts = (icyPeasResult.contacts || []).map((contact: any) => {
      const mappedContact = {
        name: contact.name || "",
        title: contact.title,
        email: contact.email,
        linkedin: contact.linkedin,
        confidence: 0.8, // Default confidence for contacts
        domain: contact.domain,
      };
      console.log(`[ICypeas] Mapped contact:`, {
        name: mappedContact.name,
        title: mappedContact.title,
        hasEmail: !!mappedContact.email,
        hasLinkedIn: !!mappedContact.linkedin
      });
      return mappedContact;
    });

    const socialProfiles = this.extractSocialProfiles(icyPeasResult);
    const overallConfidence = this.calculateOverallConfidence(emails);

    const enrichmentResult: EnrichmentResult = {
      emails,
      contacts,
      socialProfiles,
      phone: icyPeasResult.phoneNumbers?.[0],
      companyInfo: icyPeasResult.companyInfo,
      metadata: {
        provider: "icypeas",
        confidence: overallConfidence,
        timestamp: Date.now(),
      },
    };

    console.log(`[ICypeas] ✅ Transformation complete:`, {
      emailsTransformed: emails.length,
      contactsTransformed: contacts.length,
      hasSocialProfiles: !!socialProfiles,
      hasPhone: !!enrichmentResult.phone,
      hasCompanyInfo: !!enrichmentResult.companyInfo,
      overallConfidence
    });

    return enrichmentResult;
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
   * Note: ICypeas requires account email for subscription info endpoint
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    console.log(`[ICypeas] Validating API key:`, {
      hasApiKey: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : 'none'
    });

    // Get account email from environment (optional)
    const accountEmail = process.env.ICYPEAS_ACCOUNT_EMAIL;

    if (!accountEmail) {
      console.log(`[ICypeas] ⚠️  No ICYPEAS_ACCOUNT_EMAIL configured, skipping validation`);
      // Return true if we have an API key - validation will happen on actual usage
      return !!apiKey && apiKey.length > 0;
    }

    try {
      const response = await fetch(`${ICYPEAS_BASE_URL}/a/actions/subscription-information`, {
        method: "POST",
        headers: {
          "Authorization": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: accountEmail }),
      });

      const isValid = response.ok;
      console.log(`[ICypeas] API key validation result:`, {
        isValid,
        status: response.status,
        statusText: response.statusText,
        accountEmail
      });

      if (!isValid) {
        const errorText = await response.text();
        console.error(`[ICypeas] API key validation failed:`, {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText
        });
      }

      return isValid;
    } catch (error) {
      console.error("[ICypeas] ❌ API key validation error:", {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      return false;
    }
  }

  /**
   * Get remaining credits
   * Note: ICypeas requires account email for subscription info endpoint
   */
  async getCredits(apiKey: string): Promise<number> {
    console.log(`[ICypeas] Fetching credits:`, {
      hasApiKey: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : 'none'
    });

    // Get account email from environment (optional)
    const accountEmail = process.env.ICYPEAS_ACCOUNT_EMAIL;

    if (!accountEmail) {
      console.log(`[ICypeas] ⚠️  No ICYPEAS_ACCOUNT_EMAIL configured, cannot fetch credits`);
      return 0;
    }

    try {
      const response = await fetch(`${ICYPEAS_BASE_URL}/a/actions/subscription-information`, {
        method: "POST",
        headers: {
          "Authorization": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: accountEmail }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ICypeas] Failed to get credits:`, {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText
        });
        return 0;
      }

      const data = await response.json() as { credits?: number; subscription?: any };
      const credits = data.credits || 0;

      console.log(`[ICypeas] ✅ Subscription info fetched successfully:`, {
        credits,
        hasSubscription: !!data.subscription,
        subscriptionType: data.subscription?.type
      });

      return credits;
    } catch (error) {
      console.error("[ICypeas] ❌ Failed to get credits:", {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'Unknown'
      });
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