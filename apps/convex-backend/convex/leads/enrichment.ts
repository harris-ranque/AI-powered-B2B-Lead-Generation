import { internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { API_CONFIG, ERROR_CODES, CREDIT_COSTS } from "../lib/constants";
import { retryApiCall } from "../lib/helpers";
import { internal } from "../_generated/api";
import { withBatchRateLimit } from "../rateLimit/middleware";

// Process lead enrichment queue
export const processEnrichmentQueue = internalMutation({
  args: {
    searchId: v.optional(v.id("searches")),
    priority: v.optional(v.boolean()), // High priority processing
  },
  handler: async (ctx, args) => {
    const limit = args.priority ? 20 : 10; // Higher limit for priority processing
    
    // Get leads pending enrichment
    const pendingLeads = await ctx.runQuery(internal.leads.internal.getLeadsPendingEnrichment, {
      searchId: args.searchId,
      limit,
    });

    if (pendingLeads.length === 0) {
      return { processed: 0 };
    }

    let processed = 0;

    for (const lead of pendingLeads) {
      try {
        // Mark as in progress
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: lead._id,
          contactInfo: {
            emails: [],
            contacts: [],
          },
          enrichmentStatus: "in_progress",
        });

        // Schedule enrichment action
        await ctx.scheduler.runAfter(0, internal.leads.enrichment.enrichLead, {
          leadId: lead._id,
        });

        processed++;
      } catch (error) {
        console.error(`Error processing lead ${lead._id}:`, error);
        
        // Mark as failed
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: lead._id,
          contactInfo: {
            emails: [],
            contacts: [],
          },
          enrichmentStatus: "failed",
        });
      }
    }

    return { processed };
  },
});

// Enhanced enrichment with comprehensive error handling and fallback strategies
export const enrichLead = internalAction({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const lead = await ctx.runQuery(internal.leads.internal.getLeadForProcessing, {
      leadId: args.leadId,
    });

    if (!lead) {
      throw new Error("Lead not found");
    }

    const findymailApiKey = process.env.FINDYMAIL_API_KEY;
    
    if (!findymailApiKey) {
      console.warn("FindyMail API key not configured - using fallback enrichment");
      await handleEnrichmentFallback(ctx, lead, "missing_api_key");
      return;
    }

    // Use correct FindyMail API endpoint
    const apiEndpoint = "https://app.findymail.com/api";

    try {
      console.log(`Using FindyMail API endpoint: ${apiEndpoint}`);
      
      // Extract domain and prepare search data
      const domain = lead.website ? extractDomain(lead.website) : undefined;
      const businessName = lead.businessName || lead.name || "Contact";
      
      console.log(`📋 Lead enrichment data:`, {
        businessName,
        domain,
        website: lead.website,
        location: lead.location?.formattedAddress || lead.address,
        industry: lead.industry || lead.primaryType
      });

      // Check for cached domain results first to avoid duplicate API calls
      if (domain) {
        const cachedResult = await checkDomainCache(ctx, domain, lead.searchId);
        if (cachedResult) {
          console.log(`🎯 Using cached FindyMail result for domain: ${domain}`);
          
          await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
            leadId: args.leadId,
            contactInfo: cachedResult,
            enrichmentStatus: "completed",
          });

          // Record partial credit usage for cached result
          await recordSuccessfulEnrichment(ctx, lead, { ...cachedResult, cachedResult: true });
          return;
        }
      }
      
      let response: any = null;
      let searchType = 'none';
      let domainSearchSucceeded = false;
      
      if (domain) {
        // Try finding contacts by domain and business-relevant roles
        try {
          // Use more business-relevant roles based on the business type
          const roles = ["CEO", "owner", "manager"]; // More likely to find decision makers
          
          const domainSearchPayload = {
            domain: domain,
            roles: roles,
            webhook_url: null
          };
          
          console.log(`🔍 Attempting domain-based search:`, domainSearchPayload);
          response = await retryApiCall(async () => {
            const res = await fetch(`${apiEndpoint}/search/domain`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${findymailApiKey}`,
              },
              body: JSON.stringify(domainSearchPayload),
              signal: AbortSignal.timeout(45000), // Increased timeout - FindyMail can be slow
            });

            if (!res.ok) {
              const errorText = await res.text().catch(() => "Unknown error");
              throw new EnrichmentError(
                `API ${res.status}: ${res.statusText}`,
                res.status,
                errorText,
                apiEndpoint
              );
            }

            return res.json();
          });
          searchType = 'domain';
          domainSearchSucceeded = true;
          
          // Check if domain search returned valid results
          const hasValidResults = response?.contacts?.length > 0 || response?.contact?.email;
          if (hasValidResults) {
            console.log(`✅ Domain search found valid results: ${response?.contacts?.length || 1} contacts`);
          } else {
            console.log(`⚠️ Domain search succeeded but returned no contacts`);
            response = null; // Clear response to trigger name search fallback
            domainSearchSucceeded = false;
          }
        } catch (domainError: any) {
          domainSearchSucceeded = false;
          if (domainError.name === "AbortError") {
            console.warn("Domain search timed out after 45 seconds, falling back to name search");
          } else {
            console.warn("Domain search failed, falling back to name search:", domainError?.message);
          }
        }
      }
      
      // Only try name-based search if domain search failed or returned no results
      if (!response && domain && !domainSearchSucceeded) {
        try {
          // Try extracting individual names from business name or use generic contact
          const contactNames = extractContactNamesFromBusiness(businessName);
          
          for (const contactName of contactNames) {
            const nameSearchPayload = {
              name: contactName,
              domain: domain,
              webhook_url: null
            };
            
            console.log(`🔍 Attempting name-based search:`, nameSearchPayload);
            
            try {
              response = await retryApiCall(async () => {
                const res = await fetch(`${apiEndpoint}/search/name`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${findymailApiKey}`,
                  },
                  body: JSON.stringify(nameSearchPayload),
                  signal: AbortSignal.timeout(30000), // Increased timeout for name search
                });

                if (!res.ok) {
                  const errorText = await res.text().catch(() => "Unknown error");
                  throw new EnrichmentError(
                    `API ${res.status}: ${res.statusText}`,
                    res.status,
                    errorText,
                    apiEndpoint
                  );
                }

                return res.json();
              });
              
              if (response) {
                searchType = 'name';
                console.log(`✅ Name search successful for: ${contactName}`);
                break; // Found a result, stop trying other names
              }
            } catch (nameError: any) {
              if (nameError.name === "AbortError") {
                console.warn(`Name search timed out for ${contactName}, trying next name...`);
              } else {
                console.warn(`Name search failed for ${contactName}:`, nameError?.message);
              }
              // Continue to next name
            }
          }
          
          if (!response) {
            console.warn("All name-based searches failed, proceeding with fallback enrichment");
          }
        } catch (nameError: any) {
          console.warn("Name search preparation failed:", nameError?.message);
        }
      }
      
      // Process successful response
      if (response) {
        const enrichmentData = processFindymailResponse(response, searchType);
        
        // Cache the successful domain result for reuse within this search
        if (domain && enrichmentData.emails.length > 0) {
          await cacheDomainResult(ctx, domain, lead.searchId, enrichmentData);
          console.log(`💾 Cached FindyMail result for domain: ${domain}`);
        }
        
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: args.leadId,
          contactInfo: enrichmentData,
          enrichmentStatus: "completed",
        });

        console.log(`✅ FindyMail API successful with ${searchType} search`);
        
        await recordSuccessfulEnrichment(ctx, lead, enrichmentData);
      } else {
        // No successful response from either search method
        console.warn("No results from FindyMail API, using fallback strategy");
        await handleEnrichmentFallback(ctx, lead, "no_results");
      }

    } catch (error: any) {
      const isTimeout = error.name === "AbortError";
      const errorType = isTimeout ? "api_timeout" : "api_unavailable";
      
      console.error(`❌ FindyMail API ${isTimeout ? 'timed out' : 'failed'}:`, {
        error: error?.message || 'Unknown error',
        status: error?.status,
        endpoint: apiEndpoint,
        timeout: isTimeout,
      });
      
      console.log(`Using fallback enrichment strategy due to ${isTimeout ? 'timeout' : 'API failure'}`);
      
      // Trigger enhanced error recovery for enrichment failures
      await ctx.runMutation(internal.search.errorRecovery.handleSearchError, {
        searchId: lead.searchId,
        errorType: isTimeout ? "API_TIMEOUT" : "ENRICHMENT_FAILED",
        errorMessage: error?.message || 'FindyMail API unavailable',
        context: { phase: "enrichment", leadId: lead._id },
      });
      
      await handleEnrichmentFallback(ctx, lead, errorType, error);
    }
  },
});

// Enhanced error class for enrichment failures
class EnrichmentError extends Error {
  constructor(
    message: string,
    public status?: number,
    public responseBody?: string,
    public endpoint?: string
  ) {
    super(message);
    this.name = "EnrichmentError";
  }
}

// Safely extract domain from URL
function extractDomain(url: string): string | undefined {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    return urlObj.hostname;
  } catch {
    // If URL parsing fails, try to extract domain manually
    const domain = url.replace(/^https?:\/\//, '').split('/')[0]?.split('?')[0];
    return domain && domain.includes('.') ? domain : undefined;
  }
}

// Extract potential contact names from business name
function extractContactNamesFromBusiness(businessName: string): string[] {
  const names: string[] = [];
  
  // For law firms, extract lawyer names
  if (businessName.toLowerCase().includes('law') || businessName.toLowerCase().includes('legal')) {
    // Pattern: "John Doe Law Firm" or "Smith & Associates"
    const lawyerNameMatch = businessName.match(/^([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+(?:Law|Legal|Firm|Attorney|Associates))/i);
    if (lawyerNameMatch?.[1]) {
      names.push(lawyerNameMatch[1]);
    }
    
    // Pattern: "Law Offices of John Doe"
    const lawOfficeMatch = businessName.match(/Law Offices? of ([A-Z][a-z]+ [A-Z][a-z]+)/i);
    if (lawOfficeMatch?.[1]) {
      names.push(lawOfficeMatch[1]);
    }
  }
  
  // For businesses with personal names (first and last name patterns)
  const personalNameMatch = businessName.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (personalNameMatch?.[1] && !businessName.toLowerCase().includes('company') && !businessName.toLowerCase().includes('corp')) {
    names.push(personalNameMatch[1]);
  }
  
  // Always try common contact roles as fallback
  names.push("Contact", "Owner", "Manager");
  
  return [...new Set(names)]; // Remove duplicates
}

// Process FindyMail API response based on endpoint type
function processFindymailResponse(response: any, searchType: string) {
  const enrichmentData: {
    emails: Array<{email: string, type: string, confidence: number}>;
    contacts: any[];
    socialProfiles: any;
  } = {
    emails: [],
    contacts: [],
    socialProfiles: {},
  };

  try {
    console.log(`Processing FindyMail response (${searchType}):`, JSON.stringify(response, null, 2));
    
    // Handle FindyMail API response formats per official spec
    if (searchType === 'name' && response?.contact) {
      // Name search response: {contact: {name, domain, email}}
      const contact = response.contact;
      if (contact.email) {
        enrichmentData.emails = [{
          email: contact.email,
          type: "primary",
          confidence: 0.9 // High confidence for verified emails
        }];
        enrichmentData.contacts = [{
          name: contact.name || "Contact",
          email: contact.email,
          confidence: 0.9,
          ...(contact.title && { title: contact.title }),
          ...(contact.linkedin && { linkedin: contact.linkedin })
        }];
        console.log(`✅ Name search found email: ${contact.email} for ${contact.name}`);
      }
    } else if (searchType === 'domain' && response?.contacts) {
      // Domain search response: {contacts: [{name, email, domain}]} - NO payload wrapper per spec
      const contacts = response.contacts;
      if (Array.isArray(contacts)) {
        contacts.forEach(contact => {
          if (contact.email) {
            enrichmentData.emails.push({
              email: contact.email,
              type: "business",
              confidence: 0.85 // Good confidence for domain search
            });
            enrichmentData.contacts.push({
              name: contact.name || "Contact",
              email: contact.email,
              confidence: 0.85,
              ...(contact.title && { title: contact.title }),
              ...(contact.linkedin && { linkedin: contact.linkedin })
            });
            console.log(`✅ Domain search found email: ${contact.email} for ${contact.name}`);
          }
        });
      }
    } else if (response?.payload?.contacts) {
      // Webhook response format: {payload: {contacts: [...]}}
      const contacts = response.payload.contacts;
      if (Array.isArray(contacts)) {
        contacts.forEach(contact => {
          if (contact.email) {
            enrichmentData.emails.push({
              email: contact.email,
              type: "business",
              confidence: 0.85
            });
            enrichmentData.contacts.push({
              name: contact.name || "Contact",
              email: contact.email,
              confidence: 0.85,
              ...(contact.title && { title: contact.title }),
              ...(contact.linkedin && { linkedin: contact.linkedin })
            });
            console.log(`✅ Webhook response found email: ${contact.email} for ${contact.name}`);
          }
        });
      }
    } else if (response?.payload?.contact) {
      // Webhook response format for name search: {payload: {contact: {...}}}
      const contact = response.payload.contact;
      if (contact.email) {
        enrichmentData.emails = [{
          email: contact.email,
          type: "primary",
          confidence: 0.9
        }];
        enrichmentData.contacts = [{
          name: contact.name || "Contact",
          email: contact.email,
          confidence: 0.9,
          ...(contact.title && { title: contact.title }),
          ...(contact.linkedin && { linkedin: contact.linkedin })
        }];
        console.log(`✅ Webhook name search found email: ${contact.email} for ${contact.name}`);
      }
    }

    console.log(`Processed FindyMail data: ${enrichmentData.emails.length} emails, ${enrichmentData.contacts.length} contacts`);
    
    if (enrichmentData.emails.length === 0) {
      console.warn(`⚠️ No emails found in FindyMail response. Response structure:`, {
        hasContact: !!response?.contact,
        hasContacts: !!response?.contacts,
        hasPayload: !!response?.payload,
        responseKeys: Object.keys(response || {}),
        searchType
      });
    }
    
    return enrichmentData;
    
  } catch (error) {
    console.warn("Error processing FindyMail response:", error);
    return enrichmentData; // Return empty data structure
  }
}

// Handle enrichment fallback strategies
async function handleEnrichmentFallback(
  ctx: any, 
  lead: any, 
  reason: string, 
  error?: any
) {
  console.log(`Using enrichment fallback for lead ${lead._id}, reason: ${reason}`);

  // Strategy 1: Generate email patterns based on business name and domain
  const fallbackEmails = generateEmailPatterns(lead);
  
  // Strategy 2: Extract contact info from existing data
  // Note: extractContactsFromBusinessData now handles email generation internally
  const extractedContacts = extractContactsFromBusinessData(lead);

  // Only proceed if we have valid data
  if (fallbackEmails.length === 0 && extractedContacts.length === 0) {
    console.warn(`No fallback data available for lead ${lead._id}`);
    await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
      leadId: lead._id,
      contactInfo: {
        emails: [],
        contacts: [],
        socialProfiles: {},
        fallbackUsed: true,
        fallbackReason: reason + " - no fallback data available",
      },
      enrichmentStatus: "failed",
    });
    return;
  }

  const fallbackData = {
    emails: fallbackEmails,
    contacts: extractedContacts,
    socialProfiles: {},
    fallbackUsed: true,
    fallbackReason: reason,
  };

  await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
    leadId: lead._id,
    contactInfo: fallbackData,
    enrichmentStatus: "completed_fallback",
  });

  // Still record some progress for user experience
  if (fallbackEmails.length > 0 || extractedContacts.length > 0) {
    await recordSuccessfulEnrichment(ctx, lead, fallbackData);
  }
  
  console.log(`✅ Fallback enrichment completed for ${lead.businessName}: ${fallbackData.emails.length} emails`);
}

// Generate common email patterns for a business
function generateEmailPatterns(lead: any): Array<{email: string, type: string, confidence: number}> {
  const emails: Array<{email: string, type: string, confidence: number}> = [];
  
  if (!lead.website) return emails;
  
  const domain = extractDomain(lead.website);
  if (!domain) return emails;

  // Common email patterns with confidence scoring
  const patterns = [
    { prefix: 'info', confidence: 0.7, type: 'general' },
    { prefix: 'contact', confidence: 0.6, type: 'general' },
    { prefix: 'hello', confidence: 0.5, type: 'general' },
    { prefix: 'support', confidence: 0.5, type: 'support' },
    { prefix: 'sales', confidence: 0.6, type: 'business' },
    { prefix: 'admin', confidence: 0.4, type: 'administrative' },
    { prefix: 'office', confidence: 0.5, type: 'general' },
    { prefix: 'enquiries', confidence: 0.5, type: 'general' },
    { prefix: 'general', confidence: 0.4, type: 'general' },
    { prefix: 'business', confidence: 0.5, type: 'business' }
  ];

  patterns.forEach(pattern => {
    emails.push({
      email: `${pattern.prefix}@${domain}`,
      type: pattern.type,
      confidence: pattern.confidence
    });
  });

  return emails.slice(0, 5); // Limit to 5 most common patterns
}

// Extract contact information from business data
function extractContactsFromBusinessData(lead: any): any[] {
  const contacts: any[] = [];
  
  // Only create contacts if we have valid email patterns
  // Don't create contacts with null emails as they violate the schema
  const emailPatterns = generateEmailPatterns(lead);
  
  if (emailPatterns.length > 0) {
    // Create multiple contacts based on email patterns to provide better coverage
    const primaryPattern = emailPatterns[0]; // Use info@ or contact@ as primary
    const businessPattern = emailPatterns.find(p => p.type === 'business'); // sales@, business@
    
    // Primary general contact
    if (primaryPattern) {
      contacts.push({
        name: lead.businessName || "General Contact",
        title: "General Contact", 
        email: primaryPattern.email,
        confidence: primaryPattern.confidence,
      });
    }
    
    // Business/Sales contact if different from primary
    if (businessPattern && businessPattern.email !== primaryPattern?.email) {
      contacts.push({
        name: `${lead.businessName || "Business"} Sales`,
        title: "Sales Representative", 
        email: businessPattern.email,
        confidence: businessPattern.confidence,
      });
    }
  }
  
  return contacts;
}

// Record successful enrichment and update progress
async function recordSuccessfulEnrichment(ctx: any, lead: any, enrichmentData: any) {
  try {
    // Record credit usage (reduced for fallback and cached results)
    let creditCost = CREDIT_COSTS.LEAD_ENRICHMENT;
    
    if (enrichmentData.fallbackUsed) {
      creditCost = Math.floor(CREDIT_COSTS.LEAD_ENRICHMENT * 0.5);
    } else if (enrichmentData.cachedResult) {
      creditCost = Math.floor(CREDIT_COSTS.LEAD_ENRICHMENT * 0.1); // Only 10% cost for cached results
    }

    await ctx.runMutation(internal.search.internal.recordSearchCredits, {
      searchId: lead.searchId,
      creditsUsed: creditCost,
    });

    // Update search progress
    const progressData = await ctx.runQuery(internal.leads.internal.getSearchProgressData, {
      searchId: lead.searchId,
    });

    await ctx.runMutation(internal.search.internal.updateSearchProgress, {
      searchId: lead.searchId,
      enriched: progressData.enrichedLeads,
      enrichedCount: progressData.enrichedLeads,
    });

    // Schedule analysis if we have enriched leads
    if (progressData.enrichedLeads > 0) {
      await ctx.scheduler.runAfter(1000, internal.langgraph.actions.analyzeLead, {
        leadId: lead._id,
      });
      
      await ctx.scheduler.runAfter(5000, internal.search.orchestrator.orchestrateSearchPipeline, {
        searchId: lead.searchId,
      });
    }
    
  } catch (error) {
    console.error("Error recording enrichment progress:", error);
  }
}

// Health check for FindyMail API endpoints
export const healthCheckEnrichmentAPI = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const findymailApiKey = process.env.FINDYMAIL_API_KEY;
    
    if (!findymailApiKey) {
      return {
        status: "error",
        message: "FindyMail API key not configured",
        endpoints: [],
      };
    }

    // Test FindyMail API endpoint - use the correct one from production code
    const apiEndpoint = "https://app.findymail.com/api";

    const results = [];
    
    // Test name search endpoint
    const startTime = Date.now();
    let status = "unknown";
    let error = null;
    let responseTime = 0;

    try {
      // Test with minimal payload for name search
      const testPayload = {
        name: "John Doe",
        domain: "example.com",
        webhook_url: null
      };

      const response = await fetch(`${apiEndpoint}/search/name`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${findymailApiKey}`,
        },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10000),
      });

      responseTime = Date.now() - startTime;

      if (response.ok) {
        status = "healthy";
      } else if (response.status === 401 || response.status === 403) {
        status = "auth_error";
        error = `Authentication failed: ${response.status}`;
      } else if (response.status === 429) {
        status = "rate_limited";
        error = "Rate limit exceeded";
      } else if (response.status === 402) {
        status = "credits_exhausted";
        error = "No credits remaining";
      } else {
        status = "api_error";
        error = `HTTP ${response.status}: ${response.statusText}`;
      }

    } catch (fetchError: any) {
      responseTime = Date.now() - startTime;
      
      if (fetchError.name === "AbortError") {
        status = "timeout";
        error = "Request timeout";
      } else if (fetchError.message.includes("ENOTFOUND") || fetchError.message.includes("Could not resolve")) {
        status = "dns_error";
        error = "DNS resolution failed";
      } else if (fetchError.message.includes("unsuccessful tunnel")) {
        status = "network_error";
        error = "Network connectivity issue (tunnel failed)";
      } else {
        status = "network_error";
        error = fetchError.message;
      }
    }

    results.push({
      endpoint: `${apiEndpoint}/search/name`,
      status,
      error,
      responseTime,
      timestamp: new Date().toISOString(),
    });

    // Determine overall health
    const healthyEndpoints = results.filter(r => r.status === "healthy");
    const overallStatus = healthyEndpoints.length > 0 ? "healthy" : "unhealthy";

    return {
      status: overallStatus,
      message: `${healthyEndpoints.length}/${results.length} endpoints healthy`,
      endpoints: results,
      recommendation: healthyEndpoints.length === 0 ? 
        "Use fallback enrichment strategy" : 
        `Use endpoint: ${healthyEndpoints[0]?.endpoint}`,
    };
  },
});

// Test enrichment with mock data for debugging
export const testEnrichmentFlow = internalAction({
  args: {
    testBusinessName: v.string(),
    testWebsite: v.optional(v.string()),
    testLocation: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    console.log("Starting enrichment flow test...");

    // Create mock lead data
    const mockLead = {
      _id: "test_lead_id",
      businessName: args.testBusinessName,
      website: args.testWebsite || "https://example.com",
      location: {
        formattedAddress: args.testLocation || "San Francisco, CA",
      },
      searchId: "test_search_id",
    };

    try {
      // Test API health first
      const healthCheck: any = await ctx.runAction(internal.leads.enrichment.healthCheckEnrichmentAPI, {});
      console.log("API Health Check:", healthCheck);

      // Test fallback strategy
      console.log("Testing fallback enrichment...");
      const fallbackEmails = generateEmailPatterns(mockLead);
      const fallbackContacts = extractContactsFromBusinessData(mockLead);

      console.log("Fallback Results:", {
        emails: fallbackEmails,
        contacts: fallbackContacts,
      });

      return {
        success: true,
        healthCheck,
        fallbackData: {
          emails: fallbackEmails,
          contacts: fallbackContacts,
        },
        message: "Enrichment flow test completed successfully",
      };

    } catch (error: any) {
      console.error("Enrichment flow test failed:", error);
      return {
        success: false,
        error: error?.message || 'Unknown error',
        message: "Enrichment flow test failed",
      };
    }
  },
});

// Handle enrichment webhook from FindyMail
export const handleEnrichmentWebhook = internalMutation({
  args: {
    leadId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    data: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      if (args.status === "completed" && args.data) {
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: args.leadId as any,
          contactInfo: args.data,
          enrichmentStatus: "completed",
        });
      } else {
        await ctx.runMutation(internal.leads.internal.updateLeadEnrichment, {
          leadId: args.leadId as any,
          contactInfo: {
            emails: [],
            contacts: [],
          },
          enrichmentStatus: "failed",
        });
      }
    } catch (error) {
      console.error("Error processing enrichment webhook:", error);
    }
  },
});

// Domain caching functions to prevent duplicate FindyMail API calls
async function checkDomainCache(ctx: any, domain: string, searchId: string) {
  try {
    // Check if we have cached results for this domain within this search
    const cacheEntry = await ctx.db
      .query("findymailDomainCache")
      .withIndex("by_domain_search", (q) => q.eq("domain", domain).eq("searchId", searchId))
      .first();
    
    if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
      return cacheEntry.enrichmentData;
    }
    
    return null;
  } catch (error) {
    console.warn("Error checking domain cache:", error);
    return null;
  }
}

async function cacheDomainResult(ctx: any, domain: string, searchId: string, enrichmentData: any) {
  try {
    // Cache results for 1 hour within this search session
    const expiresAt = Date.now() + (60 * 60 * 1000);
    
    await ctx.db.insert("findymailDomainCache", {
      domain,
      searchId,
      enrichmentData,
      createdAt: Date.now(),
      expiresAt,
    });
  } catch (error) {
    console.warn("Error caching domain result:", error);
    // Don't fail the enrichment if caching fails
  }
}

// Cleanup expired domain cache entries
export const cleanupExpiredDomainCache = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Find expired entries
    const expiredEntries = await ctx.db
      .query("findymailDomainCache")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(100); // Process in batches
    
    let deletedCount = 0;
    
    for (const entry of expiredEntries) {
      await ctx.db.delete(entry._id);
      deletedCount++;
    }
    
    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} expired FindyMail cache entries`);
    }
    
    return { deletedCount };
  },
});