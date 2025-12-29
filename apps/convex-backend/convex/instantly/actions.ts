"use node";

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";

// Rate limit: 100 requests/10 seconds, 600 requests/minute
// Use ~150ms delay between batches to stay safe
const RATE_LIMIT_DELAY_MS = 150;
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// ============================================================================
// ERROR TYPES AND CONSTANTS
// ============================================================================

/**
 * Instantly API Error Codes
 * Based on Instantly API V2 documentation
 */
const INSTANTLY_ERROR_CODES = {
  // Authentication errors
  INVALID_API_KEY: "invalid_api_key",
  EXPIRED_API_KEY: "expired_api_key",
  INSUFFICIENT_SCOPE: "insufficient_scope",

  // Rate limiting
  RATE_LIMITED: "rate_limited",

  // Resource errors
  CAMPAIGN_NOT_FOUND: "campaign_not_found",
  ACCOUNT_NOT_FOUND: "account_not_found",

  // Validation errors
  INVALID_REQUEST: "invalid_request",
  INVALID_EMAIL: "invalid_email",

  // Server errors
  SERVER_ERROR: "server_error",

  // Network errors
  NETWORK_ERROR: "network_error",
  TIMEOUT: "timeout",

  // Unknown
  UNKNOWN: "unknown_error",
} as const;

type InstantlyErrorCode = typeof INSTANTLY_ERROR_CODES[keyof typeof INSTANTLY_ERROR_CODES];

/**
 * User-friendly error messages for each error code
 */
const USER_FRIENDLY_MESSAGES: Record<InstantlyErrorCode, string> = {
  [INSTANTLY_ERROR_CODES.INVALID_API_KEY]:
    "Your Instantly API key is invalid. Please check that you're using an API V2 key from your Instantly dashboard (Settings → Integrations → API Keys).",
  [INSTANTLY_ERROR_CODES.EXPIRED_API_KEY]:
    "Your Instantly API key has expired. Please generate a new API V2 key from your Instantly dashboard.",
  [INSTANTLY_ERROR_CODES.INSUFFICIENT_SCOPE]:
    "Your Instantly API key doesn't have the required permissions. Please create a new key with 'campaigns:create', 'leads:create', and 'accounts:read' scopes.",
  [INSTANTLY_ERROR_CODES.RATE_LIMITED]:
    "Instantly API rate limit exceeded. Please wait a few minutes and try again. The rate limit is 100 requests per 10 seconds.",
  [INSTANTLY_ERROR_CODES.CAMPAIGN_NOT_FOUND]:
    "The campaign was not found in Instantly. It may have been deleted.",
  [INSTANTLY_ERROR_CODES.ACCOUNT_NOT_FOUND]:
    "No sender accounts found. Please add at least one email account in your Instantly workspace.",
  [INSTANTLY_ERROR_CODES.INVALID_REQUEST]:
    "The request to Instantly was invalid. Please check your search data and try again.",
  [INSTANTLY_ERROR_CODES.INVALID_EMAIL]:
    "One or more lead email addresses are invalid. Please check the email data.",
  [INSTANTLY_ERROR_CODES.SERVER_ERROR]:
    "Instantly is experiencing technical difficulties. Please try again later.",
  [INSTANTLY_ERROR_CODES.NETWORK_ERROR]:
    "Unable to connect to Instantly. Please check your internet connection and try again.",
  [INSTANTLY_ERROR_CODES.TIMEOUT]:
    "The request to Instantly timed out. Please try again.",
  [INSTANTLY_ERROR_CODES.UNKNOWN]:
    "An unexpected error occurred with Instantly. Please try again or contact support if the issue persists.",
};

/**
 * Structured error response from Instantly API
 */
interface InstantlyApiError {
  code: InstantlyErrorCode;
  message: string;
  userMessage: string;
  httpStatus?: number;
  details?: string;
  retryable: boolean;
  retryAfterMs?: number;
}

/**
 * Parse Instantly API error response and return structured error
 */
function parseInstantlyError(
  httpStatus: number,
  responseText: string,
  context: string
): InstantlyApiError {
  let errorCode: InstantlyErrorCode = INSTANTLY_ERROR_CODES.UNKNOWN;
  let details = responseText;
  let userMessage: string | undefined;
  let retryable = false;
  let retryAfterMs: number | undefined;

  // Try to parse JSON error response
  try {
    const errorJson = JSON.parse(responseText);
    details = errorJson.message || errorJson.error || responseText;

    // Check for specific error patterns in the response
    const errorLower = details.toLowerCase();

    if (errorLower.includes("unauthorized") || (errorLower.includes("invalid") && errorLower.includes("key"))) {
      errorCode = INSTANTLY_ERROR_CODES.INVALID_API_KEY;
    } else if (errorLower.includes("expired")) {
      errorCode = INSTANTLY_ERROR_CODES.EXPIRED_API_KEY;
    } else if (errorLower.includes("scope") || errorLower.includes("permission") || errorLower.includes("forbidden")) {
      errorCode = INSTANTLY_ERROR_CODES.INSUFFICIENT_SCOPE;
    } else if (errorLower.includes("not found") && errorLower.includes("campaign")) {
      errorCode = INSTANTLY_ERROR_CODES.CAMPAIGN_NOT_FOUND;
    } else if (errorLower.includes("not found") && errorLower.includes("account")) {
      errorCode = INSTANTLY_ERROR_CODES.ACCOUNT_NOT_FOUND;
    } else if (errorLower.includes("invalid") && errorLower.includes("email")) {
      errorCode = INSTANTLY_ERROR_CODES.INVALID_EMAIL;
    } else if (errorLower.includes("invalid") || errorLower.includes("validation") || errorLower.includes("must be")) {
      errorCode = INSTANTLY_ERROR_CODES.INVALID_REQUEST;
    }
  } catch {
    // Response wasn't JSON, use the raw text
    details = responseText.slice(0, 500); // Limit length
  }

  // Map HTTP status codes to error types
  switch (httpStatus) {
    case 400:
      // Bad Request - validation errors
      errorCode = INSTANTLY_ERROR_CODES.INVALID_REQUEST;
      // Provide more helpful message for common validation errors
      if (details.includes("campaign_schedule")) {
        userMessage = "Campaign schedule configuration is invalid. This is an internal error - please contact support.";
      } else if (details.includes("sequences") || details.includes("steps")) {
        userMessage = "Email sequence configuration is invalid. This is an internal error - please contact support.";
      } else if (details.includes("timezone")) {
        userMessage = "Invalid timezone configuration. This is an internal error - please contact support.";
      } else if (details.includes("email_list")) {
        userMessage = "The selected sender email account is not valid. Please select a different account or refresh your accounts in Settings.";
      }
      break;
    case 401:
      errorCode = INSTANTLY_ERROR_CODES.INVALID_API_KEY;
      break;
    case 403:
      errorCode = INSTANTLY_ERROR_CODES.INSUFFICIENT_SCOPE;
      break;
    case 404:
      if (context.includes("campaign")) {
        errorCode = INSTANTLY_ERROR_CODES.CAMPAIGN_NOT_FOUND;
      } else if (context.includes("account")) {
        errorCode = INSTANTLY_ERROR_CODES.ACCOUNT_NOT_FOUND;
      }
      break;
    case 422:
      errorCode = INSTANTLY_ERROR_CODES.INVALID_REQUEST;
      break;
    case 429:
      errorCode = INSTANTLY_ERROR_CODES.RATE_LIMITED;
      retryable = true;
      // Default retry after 10 seconds for rate limits
      retryAfterMs = 10000;
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      errorCode = INSTANTLY_ERROR_CODES.SERVER_ERROR;
      retryable = true;
      retryAfterMs = 5000;
      break;
  }

  return {
    code: errorCode,
    message: `${context}: ${details}`,
    userMessage: userMessage || USER_FRIENDLY_MESSAGES[errorCode],
    httpStatus,
    details,
    retryable,
    retryAfterMs,
  };
}

/**
 * Create a network error
 */
function createNetworkError(error: Error, context: string): InstantlyApiError {
  const isTimeout = error.name === "AbortError" || error.message.includes("timeout");
  const code = isTimeout ? INSTANTLY_ERROR_CODES.TIMEOUT : INSTANTLY_ERROR_CODES.NETWORK_ERROR;

  return {
    code,
    message: `${context}: ${error.message}`,
    userMessage: USER_FRIENDLY_MESSAGES[code],
    details: error.message,
    retryable: true,
    retryAfterMs: 2000,
  };
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with retry logic for transient errors
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  context: string,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: InstantlyApiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);

      // Check if we should retry based on status
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        const responseText = await response.text();
        const error = parseInstantlyError(response.status, responseText, context);

        if (error.retryable && attempt < maxRetries) {
          const delay = error.retryAfterMs || (INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt));
          console.warn(`Instantly API ${context}: Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, {
            status: response.status,
            error: error.code,
          });
          await sleep(delay);
          continue;
        }

        lastError = error;
        throw new Error(error.userMessage);
      }

      return response;
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's an abort/timeout error
        if (error.name === "AbortError" || error.message.includes("timeout")) {
          const networkError = createNetworkError(error, context);

          if (networkError.retryable && attempt < maxRetries) {
            const delay = networkError.retryAfterMs || (INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt));
            console.warn(`Instantly API ${context}: Timeout, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(delay);
            continue;
          }

          throw new Error(networkError.userMessage);
        }

        // Check if it's our formatted error (already has user message)
        if (error.message.includes("Instantly")) {
          throw error;
        }

        // Network error
        const networkError = createNetworkError(error, context);
        if (networkError.retryable && attempt < maxRetries) {
          const delay = networkError.retryAfterMs || (INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt));
          console.warn(`Instantly API ${context}: Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(delay);
          continue;
        }

        throw new Error(networkError.userMessage);
      }
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw new Error(lastError?.userMessage || USER_FRIENDLY_MESSAGES[INSTANTLY_ERROR_CODES.UNKNOWN]);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper: Parse name into first/last name
function parseName(fullName?: string): { firstName: string; lastName: string } {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || "",
  };
}

// Helper: Build campaign payload (Instantly API V2)
function buildCampaignPayload(
  name: string,
  senderEmail: string,
  leads: Doc<"leads">[]
) {
  // Find a lead with email content to use as template structure
  const templateLead = leads.find((l) => l.emailContent);

  // Build email steps
  const steps: Array<{
    type: string;
    delay: number;
    variants: Array<{ subject: string; body: string }>;
  }> = [];

  // Primary email - use merge tags for lead-specific content
  steps.push({
    type: "email",
    delay: 0,
    variants: [
      {
        // Use lead custom variables for personalized subject/body
        subject: "{{lt_email_subject}}",
        body: "{{lt_email_body}}",
      },
    ],
  });

  // Add follow-up emails if template lead has them
  // Note: Instantly API V2 only supports type "email" - delay differentiates follow-ups
  if (templateLead?.followUpEmails && templateLead.followUpEmails.length > 0) {
    for (let i = 0; i < templateLead.followUpEmails.length; i++) {
      const followUp = templateLead.followUpEmails[i];
      if (!followUp) continue;
      steps.push({
        type: "email", // Must be "email" - only supported type in API V2
        delay: followUp.delay_days ?? (i + 1) * 3, // Default 3-day intervals
        variants: [
          {
            // Follow-ups also use merge tags
            subject: `{{lt_followup_${i + 1}_subject}}`,
            body: `{{lt_followup_${i + 1}_body}}`,
          },
        ],
      });
    }
  }

  // Instantly API V2 requires campaign_schedule
  // Default schedule: Monday-Friday 9AM-5PM in America/New_York timezone
  const campaign_schedule = {
    schedules: [
      {
        name: "Default Schedule",
        timing: {
          from: "09:00",
          to: "17:00",
        },
        days: {
          "0": false, // Sunday
          "1": true,  // Monday
          "2": true,  // Tuesday
          "3": true,  // Wednesday
          "4": true,  // Thursday
          "5": true,  // Friday
          "6": false, // Saturday
        },
        timezone: "America/Chicago",
      },
    ],
  };

  return {
    name,
    email_list: [senderEmail],
    sequences: [{ steps }],
    campaign_schedule,
    // Campaign created as draft by default (not active)
  };
}

// Helper: Build leads payload for Instantly
function buildLeadsPayload(campaignId: string, leads: Doc<"leads">[]) {
  return {
    campaign_id: campaignId,
    leads: leads
      .map((lead) => {
        const primaryEmail = lead.contactInfo?.emails?.[0]?.email;
        if (!primaryEmail) return null;

        const primaryContact = lead.contactInfo?.contacts?.[0];
        const { firstName, lastName } = parseName(primaryContact?.name);

        // Build lead with custom variables for personalized emails
        const leadData: Record<string, string | undefined> = {
          email: primaryEmail,
          first_name: firstName,
          last_name: lastName,
          company_name: lead.businessName,
          website: lead.website || undefined,
          phone: lead.phone || undefined,
          // Primary email content as lead custom variables
          lt_email_subject: lead.emailContent?.subject || "",
          lt_email_body: lead.emailContent?.body || "",
        };

        // Add follow-up emails as custom variables
        if (lead.followUpEmails) {
          lead.followUpEmails.forEach((followUp, i) => {
            leadData[`lt_followup_${i + 1}_subject`] = followUp.subject || "";
            leadData[`lt_followup_${i + 1}_body`] = followUp.body || "";
          });
        }

        return leadData;
      })
      .filter(Boolean),
  };
}

// Types for Instantly accounts
type InstantlyAccount = {
  id: string;
  email: string;
  displayName?: string;
  status?: string;
};

// Fetch sender email accounts from Instantly
export const fetchSenderAccounts = action({
  args: {},
  handler: async (ctx): Promise<InstantlyAccount[]> => {
    const user = await requireAuth(ctx);

    // Get decrypted API key
    let keyResult: { apiKey: string };
    try {
      keyResult = (await ctx.runAction(
        internal.userApiKeys.actions.getDecryptedApiKey,
        {
          userId: user._id,
          provider: "instantly",
          purpose: "fetch_sender_accounts",
        }
      )) as { apiKey: string };
    } catch (error) {
      console.error("Instantly: Failed to get API key", {
        userId: user._id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        "No valid Instantly API key found. Please add your API V2 key in Settings → Integrations."
      );
    }

    // Fetch accounts with retry logic
    const response = await fetchWithRetry(
      `${INSTANTLY_BASE_URL}/accounts`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${keyResult.apiKey}`,
          "Content-Type": "application/json",
        },
      },
      "fetch accounts"
    );

    if (!response.ok) {
      const errorText = await response.text();
      const error = parseInstantlyError(response.status, errorText, "fetch accounts");

      console.error("Instantly: Failed to fetch accounts", {
        userId: user._id,
        status: response.status,
        errorCode: error.code,
        details: error.details,
      });

      throw new Error(error.userMessage);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error("Instantly: Failed to parse accounts response", {
        userId: user._id,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new Error(
        "Received an invalid response from Instantly. Please try again."
      );
    }

    const accounts: unknown[] = Array.isArray(data)
      ? data
      : (data as { accounts?: unknown[]; items?: unknown[] }).accounts ||
        (data as { accounts?: unknown[]; items?: unknown[] }).items ||
        [];

    // Check if no accounts found
    if (accounts.length === 0) {
      console.warn("Instantly: No sender accounts found", { userId: user._id });
      // Still cache empty result to avoid repeated calls
      await ctx.runMutation(internal.instantly.internal.cacheAccounts, {
        userId: user._id,
        accounts: [],
      });
      return [];
    }

    // Transform accounts to our format with validation
    const formattedAccounts: InstantlyAccount[] = accounts
      .filter((acc): acc is Record<string, unknown> => acc !== null && typeof acc === "object")
      .map((acc) => {
        const a = acc as Record<string, unknown>;
        // Status can be a number (1.0) or string from API - normalize to string
        const rawStatus = a.status ?? a.warmup_status;
        const status = rawStatus != null ? String(rawStatus) : undefined;
        return {
          id: String(a.id || a.email || ""),
          email: String(a.email || ""),
          displayName: (a.display_name || a.first_name) as string | undefined,
          status,
        };
      })
      .filter((acc) => acc.email); // Only include accounts with valid emails

    console.log("Instantly: Successfully fetched accounts", {
      userId: user._id,
      accountCount: formattedAccounts.length,
    });

    // Cache accounts in user settings
    await ctx.runMutation(internal.instantly.internal.cacheAccounts, {
      userId: user._id,
      accounts: formattedAccounts,
    });

    return formattedAccounts;
  },
});

// Types for push result
type PushResult = {
  success: boolean;
  campaignId: string;
  campaignName: string;
  pushedCount: number;
  failedCount: number;
  errors?: string[];
};

// Main action: Push search leads to Instantly campaign
export const pushToInstantly = action({
  args: {
    searchId: v.id("searches"),
    senderEmail: v.string(),
    senderAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PushResult> => {
    const user = await requireAuth(ctx);

    console.log("Instantly: Starting push to Instantly", {
      userId: user._id,
      searchId: args.searchId,
      senderEmail: args.senderEmail,
    });

    // Verify search belongs to user
    const search = await ctx.runQuery(api.search.queries.getSearch, {
      searchId: args.searchId,
    });

    if (!search) {
      throw new Error("Search not found. Please refresh the page and try again.");
    }

    if (search.userId !== user._id) {
      throw new Error("You don't have permission to push this search to Instantly.");
    }

    if (search.status !== "completed") {
      throw new Error(
        "This search is still processing. Please wait for it to complete before pushing to Instantly."
      );
    }

    // Check for existing campaign (duplicate prevention)
    const existingCampaign = await ctx.runQuery(
      internal.instantly.queries.getCampaignBySearch,
      { searchId: args.searchId }
    );

    if (existingCampaign) {
      throw new Error(
        "This search has already been pushed to Instantly. " +
        "Check your Instantly dashboard for the existing campaign."
      );
    }

    // Get leads with email content
    const leads = await ctx.runQuery(
      internal.instantly.queries.getLeadsForPush,
      { searchId: args.searchId }
    );

    if (leads.length === 0) {
      throw new Error(
        "No leads with email addresses and completed analysis found. " +
        "Make sure your leads have been enriched and analyzed before pushing to Instantly."
      );
    }

    // Get decrypted API key
    let apiKey: string;
    try {
      const keyResult = (await ctx.runAction(
        internal.userApiKeys.actions.getDecryptedApiKey,
        {
          userId: user._id,
          provider: "instantly",
          purpose: "create_campaign",
        }
      )) as { apiKey: string };
      apiKey = keyResult.apiKey;
    } catch (error) {
      console.error("Instantly: Failed to get API key for push", {
        userId: user._id,
        searchId: args.searchId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        "No valid Instantly API key found. Please add your API V2 key in Settings → Integrations."
      );
    }

    const campaignName = search.name || `Genni Search - ${args.searchId}`;

    // Build and create campaign with retry logic
    const campaignPayload = buildCampaignPayload(
      campaignName,
      args.senderEmail,
      leads
    );

    console.log("Instantly: Creating campaign", {
      userId: user._id,
      campaignName,
      leadCount: leads.length,
    });

    const campaignResponse = await fetchWithRetry(
      `${INSTANTLY_BASE_URL}/campaigns`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(campaignPayload),
      },
      "create campaign"
    );

    if (!campaignResponse.ok) {
      const errorText = await campaignResponse.text();
      const error = parseInstantlyError(campaignResponse.status, errorText, "create campaign");

      console.error("Instantly: Campaign creation failed", {
        userId: user._id,
        searchId: args.searchId,
        status: campaignResponse.status,
        errorCode: error.code,
        details: error.details,
      });

      throw new Error(error.userMessage);
    }

    let campaign: { id: string; name?: string };
    try {
      campaign = (await campaignResponse.json()) as { id: string; name?: string };
    } catch (parseError) {
      console.error("Instantly: Failed to parse campaign response", {
        userId: user._id,
        searchId: args.searchId,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new Error(
        "Campaign may have been created but we couldn't read the response. " +
        "Please check your Instantly dashboard and try again if needed."
      );
    }

    if (!campaign.id) {
      console.error("Instantly: Campaign created but no ID returned", {
        userId: user._id,
        searchId: args.searchId,
        response: campaign,
      });
      throw new Error(
        "Campaign was created but Instantly didn't return a campaign ID. " +
        "Please check your Instantly dashboard."
      );
    }

    const campaignId: string = campaign.id;

    console.log("Instantly: Campaign created successfully", {
      userId: user._id,
      campaignId,
      campaignName: campaign.name || campaignName,
    });

    // Push leads in batches with improved error tracking
    let pushedCount = 0;
    let failedCount = 0;
    const batchErrors: string[] = [];

    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = leads.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(leads.length / BATCH_SIZE);

      try {
        const leadsPayload = buildLeadsPayload(campaignId, batch);

        // Use fetchWithRetry but with fewer retries for batch operations
        const leadsResponse = await fetchWithRetry(
          `${INSTANTLY_BASE_URL}/leads`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(leadsPayload),
          },
          `push leads batch ${batchNumber}/${totalBatches}`,
          2 // Max 2 retries for batches to avoid excessive delays
        );

        if (leadsResponse.ok) {
          pushedCount += batch.length;
          console.log(`Instantly: Batch ${batchNumber}/${totalBatches} pushed successfully`, {
            batchSize: batch.length,
            totalPushed: pushedCount,
          });
        } else {
          const errorText = await leadsResponse.text();
          const error = parseInstantlyError(leadsResponse.status, errorText, `push leads batch ${batchNumber}`);

          failedCount += batch.length;
          batchErrors.push(`Batch ${batchNumber}: ${error.details?.slice(0, 100) || "Unknown error"}`);

          console.error(`Instantly: Batch ${batchNumber}/${totalBatches} failed`, {
            status: leadsResponse.status,
            errorCode: error.code,
            details: error.details,
            batchSize: batch.length,
          });
        }
      } catch (error) {
        failedCount += batch.length;
        const errorMessage = error instanceof Error ? error.message : String(error);
        batchErrors.push(`Batch ${batchNumber}: ${errorMessage.slice(0, 100)}`);

        console.error(`Instantly: Batch ${batchNumber}/${totalBatches} error`, {
          error: errorMessage,
          batchSize: batch.length,
        });

        // If we get a non-retryable error (like auth failure), stop processing
        if (errorMessage.includes("API key") || errorMessage.includes("permission")) {
          console.error("Instantly: Stopping batch processing due to auth error");
          break;
        }
      }

      // Rate limit delay between batches (but not after the last batch)
      if (i + BATCH_SIZE < leads.length) {
        await sleep(RATE_LIMIT_DELAY_MS * Math.min(batch.length, 10));
      }
    }

    // Create campaign tracking record even if some leads failed
    await ctx.runMutation(internal.instantly.internal.createCampaignRecord, {
      userId: user._id,
      searchId: args.searchId,
      instantlyCampaignId: campaignId,
      instantlyCampaignName: campaign.name || campaignName,
      senderEmail: args.senderEmail,
      leadsCount: pushedCount,
      autoPushed: false,
    });

    console.log("Instantly: Push completed", {
      userId: user._id,
      campaignId,
      pushedCount,
      failedCount,
      totalLeads: leads.length,
    });

    return {
      success: pushedCount > 0,
      campaignId,
      campaignName: campaign.name || campaignName,
      pushedCount,
      failedCount,
      errors: batchErrors.length > 0 ? batchErrors.slice(0, 5) : undefined, // Limit to 5 errors
    };
  },
});

// Types for auto-push result
type AutoPushSuccess = {
  success: true;
  campaignId: string;
  campaignName: string;
  pushedCount: number;
  failedCount: number;
};

type AutoPushFailure = {
  success: false;
  reason: AutoPushFailureReason;
  error?: string;
  userMessage?: string;
};

type AutoPushFailureReason =
  | "already_pushed"
  | "search_not_ready"
  | "no_leads"
  | "no_api_key"
  | "campaign_creation_failed"
  | "leads_push_failed"
  | "error";

type AutoPushResult = AutoPushSuccess | AutoPushFailure;

/**
 * Get user-friendly message for auto-push failure reasons
 */
function getAutoPushFailureMessage(reason: AutoPushFailureReason, details?: string): string {
  const messages: Record<AutoPushFailureReason, string> = {
    already_pushed: "This search has already been pushed to Instantly.",
    search_not_ready: "The search is not ready for auto-push. It may still be processing.",
    no_leads: "No leads with email addresses found in this search.",
    no_api_key: "No valid Instantly API key found. Please add your API V2 key in Settings.",
    campaign_creation_failed: `Failed to create campaign in Instantly${details ? `: ${details}` : "."}`,
    leads_push_failed: "Campaign was created but some leads failed to push.",
    error: `An error occurred during auto-push${details ? `: ${details}` : "."}`,
  };
  return messages[reason];
}

// Internal action for auto-push (called by search orchestrator)
export const autoPushToInstantly = internalAction({
  args: {
    searchId: v.id("searches"),
    userId: v.id("users"),
    senderEmail: v.string(),
  },
  handler: async (ctx, args): Promise<AutoPushResult> => {
    const logPrefix = `[Auto-push ${args.searchId}]`;

    try {
      console.log(`${logPrefix} Starting auto-push`, {
        userId: args.userId,
        senderEmail: args.senderEmail,
      });

      // Check for existing campaign (duplicate prevention)
      const existingCampaign = await ctx.runQuery(
        internal.instantly.queries.getCampaignBySearch,
        { searchId: args.searchId }
      );

      if (existingCampaign) {
        console.log(`${logPrefix} Skipped: Already pushed`);
        return {
          success: false,
          reason: "already_pushed",
          userMessage: getAutoPushFailureMessage("already_pushed"),
        };
      }

      // Get search details
      const search = await ctx.runQuery(internal.search.internal.getSearchInternal, {
        searchId: args.searchId,
      });

      if (!search || search.status !== "completed") {
        console.log(`${logPrefix} Skipped: Search not ready`, {
          found: !!search,
          status: search?.status,
        });
        return {
          success: false,
          reason: "search_not_ready",
          userMessage: getAutoPushFailureMessage("search_not_ready"),
        };
      }

      // Get leads
      const leads = await ctx.runQuery(
        internal.instantly.queries.getLeadsForPush,
        { searchId: args.searchId }
      );

      if (leads.length === 0) {
        console.log(`${logPrefix} Skipped: No leads with emails`);
        return {
          success: false,
          reason: "no_leads",
          userMessage: getAutoPushFailureMessage("no_leads"),
        };
      }

      // Get decrypted API key
      let apiKey: string;
      try {
        const keyResult = (await ctx.runAction(
          internal.userApiKeys.actions.getDecryptedApiKey,
          {
            userId: args.userId,
            provider: "instantly",
            purpose: "auto_push_campaign",
          }
        )) as { apiKey: string };
        apiKey = keyResult.apiKey;
      } catch (keyError) {
        console.error(`${logPrefix} Failed to get API key`, {
          error: keyError instanceof Error ? keyError.message : String(keyError),
        });
        return {
          success: false,
          reason: "no_api_key",
          error: keyError instanceof Error ? keyError.message : String(keyError),
          userMessage: getAutoPushFailureMessage("no_api_key"),
        };
      }

      const campaignName = search.name || `Genni Search - ${args.searchId}`;

      // Build and create campaign with retry logic
      const campaignPayload = buildCampaignPayload(
        campaignName,
        args.senderEmail,
        leads
      );

      console.log(`${logPrefix} Creating campaign`, {
        campaignName,
        leadCount: leads.length,
      });

      let campaignResponse: Response;
      try {
        campaignResponse = await fetchWithRetry(
          `${INSTANTLY_BASE_URL}/campaigns`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(campaignPayload),
          },
          "auto-push create campaign"
        );
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.error(`${logPrefix} Campaign creation failed (fetch error)`, {
          error: errorMessage,
        });
        return {
          success: false,
          reason: "campaign_creation_failed",
          error: errorMessage,
          userMessage: getAutoPushFailureMessage("campaign_creation_failed", errorMessage),
        };
      }

      if (!campaignResponse.ok) {
        const errorText = await campaignResponse.text();
        const error = parseInstantlyError(campaignResponse.status, errorText, "auto-push create campaign");

        console.error(`${logPrefix} Campaign creation failed`, {
          status: campaignResponse.status,
          errorCode: error.code,
          details: error.details,
        });

        return {
          success: false,
          reason: "campaign_creation_failed",
          error: error.details,
          userMessage: error.userMessage,
        };
      }

      let campaign: { id: string; name?: string };
      try {
        campaign = (await campaignResponse.json()) as { id: string; name?: string };
      } catch (parseError) {
        console.error(`${logPrefix} Failed to parse campaign response`, {
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        return {
          success: false,
          reason: "campaign_creation_failed",
          error: "Failed to parse campaign response",
          userMessage: "Campaign may have been created but the response was invalid.",
        };
      }

      if (!campaign.id) {
        console.error(`${logPrefix} Campaign created but no ID returned`);
        return {
          success: false,
          reason: "campaign_creation_failed",
          error: "No campaign ID in response",
          userMessage: "Campaign was created but no ID was returned. Check Instantly dashboard.",
        };
      }

      const campaignId: string = campaign.id;

      console.log(`${logPrefix} Campaign created`, {
        campaignId,
        campaignName: campaign.name || campaignName,
      });

      // Push leads in batches with improved error handling
      let pushedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        const batch = leads.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(leads.length / BATCH_SIZE);

        try {
          const leadsPayload = buildLeadsPayload(campaignId, batch);

          const leadsResponse = await fetchWithRetry(
            `${INSTANTLY_BASE_URL}/leads`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(leadsPayload),
            },
            `auto-push leads batch ${batchNumber}/${totalBatches}`,
            2 // Max 2 retries for batches
          );

          if (leadsResponse.ok) {
            pushedCount += batch.length;
          } else {
            failedCount += batch.length;
            const errorText = await leadsResponse.text();
            console.warn(`${logPrefix} Batch ${batchNumber} failed`, {
              status: leadsResponse.status,
              error: errorText.slice(0, 200),
            });
          }
        } catch (batchError) {
          failedCount += batch.length;
          const errorMessage = batchError instanceof Error ? batchError.message : String(batchError);
          console.warn(`${logPrefix} Batch ${batchNumber} error`, {
            error: errorMessage,
          });

          // Stop on auth errors
          if (errorMessage.includes("API key") || errorMessage.includes("permission")) {
            console.error(`${logPrefix} Stopping due to auth error`);
            break;
          }
        }

        // Rate limit delay
        if (i + BATCH_SIZE < leads.length) {
          await sleep(RATE_LIMIT_DELAY_MS * Math.min(batch.length, 10));
        }
      }

      // Create campaign tracking record
      await ctx.runMutation(internal.instantly.internal.createCampaignRecord, {
        userId: args.userId,
        searchId: args.searchId,
        instantlyCampaignId: campaignId,
        instantlyCampaignName: campaign.name || campaignName,
        senderEmail: args.senderEmail,
        leadsCount: pushedCount,
        autoPushed: true,
      });

      console.log(`${logPrefix} Completed`, {
        campaignId,
        pushedCount,
        failedCount,
        totalLeads: leads.length,
      });

      return {
        success: true,
        campaignId,
        campaignName: campaign.name || campaignName,
        pushedCount,
        failedCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${logPrefix} Unexpected error`, { error: errorMessage });

      return {
        success: false,
        reason: "error",
        error: errorMessage,
        userMessage: getAutoPushFailureMessage("error", errorMessage),
      };
    }
  },
});
