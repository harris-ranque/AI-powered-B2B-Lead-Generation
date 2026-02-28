import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { Webhook, WebhookVerificationError } from "svix";
import {
  base64UrlEncodeString,
  base64UrlDecodeToString,
  randomNonce,
  hmacSha256,
  timingSafeEqual,
  verifyExportToken,
  bufferFromString,
  bufferFromBase64,
  type ExportTokenPayload,
} from "./lib/cryptoHelpers";

const http = httpRouter();

type LanggraphAuthResult = { userAgent: string };

type LeadDoc = {
  _id: Id<"leads">;
  businessName?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  website?: string;
  email?: string;
  phone?: string;
  category?: string;
  notes?: string;
  aiAnalysis?: {
    leadAnalysis?: Record<string, unknown>;
  };
  contactInfo?: {
    contacts?: Array<{
      name?: string;
      email?: string;
    }>;
    emails?: Array<{
      email?: string;
    }>;
  };
  emailContent?: {
    subject?: string;
    body?: string;
  };
  followUpEmails?: Array<{
    subject: string;
    body: string;
    delay_days?: number;
  }>;
  createdAt: number;
};

type LanggraphRequestDoc = {
  _id: Id<"langgraphRequests">;
  userId: Id<"users">;
  leadId?: Id<"leads">;
  requestId: string;
  status: string;
  type: string;
  outputData?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
};

type FollowUpEmail = { subject: string; body: string };

type EmailExportDetails = {
  requestId?: string;
  primarySubject?: string;
  primaryBody?: string;
  followUps: FollowUpEmail[];
  timestamp: number;
};

function firstNonEmptyString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = String(value).replace(/\r\n?/g, "\n");
  if (raw.includes("\"") || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function extractCompanyProfile(lead: LeadDoc): string {
  const analysis = lead.aiAnalysis?.leadAnalysis;
  if (!analysis || typeof analysis !== "object" || analysis === null) {
    if (typeof lead.notes === "string" && lead.notes.trim()) {
      return lead.notes.trim();
    }
    return "";
  }

  const record = analysis as Record<string, unknown>;
  const bullets: string[] = [];

  // Helper to format array values - take first 2-3 items for conciseness
  const formatArrayConcise = (arr: unknown, maxItems: number = 2): string => {
    if (!Array.isArray(arr)) return "";
    const items = arr
      .filter(item => typeof item === "string" && item.trim())
      .slice(0, maxItems);
    return items.join(", ");
  };

  // Helper to get string value
  const getString = (key: string): string => {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    return "";
  };

  // Helper to truncate long text to keep it concise
  const truncate = (text: string, maxLength: number = 100): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + "...";
  };

  // Extract and create concise bullet-point summary (prioritize most important info)

  // Company overview - truncate to keep it brief
  const overview = getString("company_overview") || getString("companyOverview") || getString("overview");
  if (overview) {
    bullets.push(`• ${truncate(overview, 120)}`);
  }

  // Industry and business model
  const industry = getString("industry_focus") || getString("industryFocus");
  const businessModel = getString("business_model") || getString("businessModel");
  if (industry && businessModel) {
    bullets.push(`• ${industry} company using ${businessModel} model`);
  } else if (industry) {
    bullets.push(`• ${industry} sector`);
  } else if (businessModel) {
    bullets.push(`• ${businessModel} business model`);
  }

  // Growth stage and size indicators
  const growthStage = getString("growth_stage") || getString("growthStage");
  if (growthStage) {
    bullets.push(`• ${growthStage}`);
  }

  // Key services/products - limit to top 2
  const keyServices = formatArrayConcise(record.key_services || record.keyServices, 2);
  if (keyServices) {
    bullets.push(`• Offers: ${keyServices}`);
  }

  // Target customers
  const targetCustomers = getString("target_customers") || getString("targetCustomers");
  if (targetCustomers) {
    bullets.push(`• Targets: ${truncate(targetCustomers, 80)}`);
  }

  // Tech stack - limit to top 2 technologies
  const techStack = formatArrayConcise(record.technology_stack || record.technologyStack, 2);
  if (techStack) {
    bullets.push(`• Tech: ${techStack}`);
  }

  // Recent news - most recent only
  const recentNewsArray = record.recent_news || record.recentNews;
  if (Array.isArray(recentNewsArray) && recentNewsArray.length > 0) {
    const latestNews = recentNewsArray[0];
    if (typeof latestNews === "string" && latestNews.trim()) {
      bullets.push(`• Recent: ${truncate(latestNews, 100)}`);
    }
  }

  // Pain points - top 2 only
  const painPoints = formatArrayConcise(record.pain_points || record.painPoints, 2);
  if (painPoints) {
    bullets.push(`• Challenges: ${painPoints}`);
  }

  // If no structured data found, try fallback to any string value
  if (bullets.length === 0) {
    const candidateKeys = [
      "company_profile", "companyProfile",
      "company_analysis", "companyAnalysis",
      "business_overview", "businessOverview",
      "summary", "description",
    ];

    for (const key of candidateKeys) {
      const value = getString(key);
      if (value) return `• ${truncate(value, 150)}`;
    }

    const fallbackValue = Object.values(record).find(
      (value) => typeof value === "string" && value.trim(),
    );
    if (typeof fallbackValue === "string") {
      return `• ${truncate(fallbackValue.trim(), 150)}`;
    }
  }

  // If still no data, try notes
  if (bullets.length === 0 && typeof lead.notes === "string" && lead.notes.trim()) {
    return `• ${truncate(lead.notes.trim(), 150)}`;
  }

  // Return bullet-point summary (newlines for CSV cell readability)
  return bullets.join("\n");
}

function deriveFirstNameFromEmail(email: string): string {
  const [localPart] = email.split("@");
  if (!localPart) {
    return "";
  }
  const segment = localPart
    .split(/[._-]+/)
    .map((part) => part.replace(/[0-9]/g, ""))
    .find((part) => part.length > 0);
  if (!segment) {
    return "";
  }
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function extractContactDetails(lead: LeadDoc): {
  firstName: string;
  fullName: string;
  email: string;
} {
  const contacts = lead.contactInfo?.contacts ?? [];
  const emails = lead.contactInfo?.emails ?? [];

  const contactWithEmail = contacts.find(
    (contact) => typeof contact?.email === "string" && contact.email.trim(),
  );
  const primaryContact = contactWithEmail ?? contacts[0];

  const emailCandidates: Array<string | undefined> = [
    lead.email,
    contactWithEmail?.email,
    primaryContact?.email,
    emails.find((entry) => typeof entry?.email === "string")?.email,
  ];

  const email = firstNonEmptyString(...emailCandidates);
  const fullName = firstNonEmptyString(primaryContact?.name);
  const firstName = fullName
    ? fullName.split(/\s+/)[0] ?? ""
    : email
      ? deriveFirstNameFromEmail(email)
      : "";

  return {
    firstName,
    fullName,
    email,
  };
}

function parseFollowUps(source: unknown): FollowUpEmail[] {
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return {
          subject: `Follow Up ${index + 1}`,
          body: "",
        };
      }
      const record = entry as Record<string, unknown>;
      const subject =
        typeof record.subject === "string"
          ? record.subject
          : `Follow Up ${index + 1}`;
      const body = typeof record.body === "string" ? record.body : "";
      return { subject, body };
    })
    .filter((item) => item.subject || item.body);
}

function extractEmailDetails(outputData: Record<string, unknown> | undefined): {
  primarySubject?: string;
  primaryBody?: string;
  followUps: FollowUpEmail[];
} {
  if (!outputData) {
    return { followUps: [] };
  }

  const formatted =
    outputData.formatted && typeof outputData.formatted === "object"
      ? (outputData.formatted as Record<string, unknown>)
      : undefined;

  const primaryCandidate = [
    formatted?.primary_email,
    outputData.primary_email,
  ].find((candidate) => candidate && typeof candidate === "object");

  let primarySubject: string | undefined;
  let primaryBody: string | undefined;

  if (primaryCandidate && typeof primaryCandidate === "object") {
    const record = primaryCandidate as Record<string, unknown>;
    if (typeof record.subject === "string") {
      primarySubject = record.subject;
    }
    if (typeof record.body === "string") {
      primaryBody = record.body;
    }
  }

  if (!primarySubject && typeof outputData.subject === "string") {
    primarySubject = outputData.subject;
  }
  if (!primaryBody) {
    const bodyCandidate =
      typeof outputData.body === "string"
        ? outputData.body
        : typeof outputData.content === "string"
          ? outputData.content
          : undefined;
    primaryBody = bodyCandidate;
  }

  let followUps = parseFollowUps(formatted?.follow_up_emails);

  if (followUps.length === 0) {
    followUps = parseFollowUps(
      (outputData as Record<string, unknown>).follow_up_emails,
    );
  }

  if (followUps.length === 0) {
    const camelCaseFollowUps =
      (outputData as Record<string, unknown>).followUpEmails;
    if (Array.isArray(camelCaseFollowUps)) {
      followUps = parseFollowUps(camelCaseFollowUps);
    }
  }

  return { primarySubject, primaryBody, followUps };
}

/**
 * Log webhook signature for debugging and future verification
 * Note: Full verification requires body parsing which is done separately in handlers
 */
function logWebhookSignature(request: Request): void {
  const signature = request.headers.get("X-Webhook-Signature");
  if (signature) {
    console.log("Webhook signature received", {
      signaturePrefix: signature.substring(0, 8) + "...",
      signatureLength: signature.length,
    });
  } else {
    console.warn("Webhook signature not provided (recommended for additional security)");
  }
}

function authorizeLanggraphWebhook(
  request: Request,
): LanggraphAuthResult | Response {
  const expectedKeyRaw =
    process.env.LANGGRAPH_WEBHOOK_SECRET ??
    process.env.LANGGRAPH_API_KEY ??
    process.env.API_KEY ??
    "";
  const expectedKey = expectedKeyRaw.trim();

  if (!expectedKey) {
    console.error("LangGraph webhook key not configured in environment");
    return new Response(
      JSON.stringify({
        error: "Webhook authentication not configured",
        message:
          "LANGGRAPH_WEBHOOK_SECRET or LANGGRAPH_API_KEY environment variable is required",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const rawAuthHeader = request.headers.get("Authorization");
  if (!rawAuthHeader) {
    console.error("Missing Authorization header in webhook request");
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Authorization header is required",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  const authHeader = rawAuthHeader.trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    console.error("Invalid Authorization header format - must be 'Bearer <token>'");
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Authorization header must use Bearer scheme",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  const providedKey = authHeader.slice(7).trim();
  if (!providedKey) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Missing bearer token",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  if (!timingSafeEqual(providedKey, expectedKey)) {
    console.error("Invalid LangGraph webhook API key provided", {
      receivedPrefix: providedKey.substring(0, 4) + "...",
      expectedPrefix: expectedKey.substring(0, 4) + "...",
      receivedLength: providedKey.length,
      expectedLength: expectedKey.length,
    });
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "Invalid API key",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  const userAgent = request.headers.get("User-Agent") || "";
  return { userAgent };
}

function ensureJsonRequest(request: Request): Response | null {
  const contentType = request.headers.get("Content-Type") || "";
  if (
    contentType &&
    !contentType.toLowerCase().includes("application/json") &&
    !contentType.toLowerCase().includes("text/json")
  ) {
    return new Response(JSON.stringify({ error: "Unsupported content type" }), {
      status: 415,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

/**
 * Validate payload size to prevent DoS attacks
 * Maximum: 10MB for webhook payloads
 */
function validatePayloadSize(request: Request): Response | null {
  const contentLength = request.headers.get("Content-Length");
  const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB

  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size)) {
      console.error("Invalid Content-Length header", { contentLength });
      return new Response(
        JSON.stringify({
          error: "Invalid Content-Length header",
          message: "Content-Length must be a valid number"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (size > MAX_PAYLOAD_SIZE) {
      console.error("Payload too large", {
        size,
        maxSize: MAX_PAYLOAD_SIZE,
        sizeMB: (size / 1024 / 1024).toFixed(2),
      });
      return new Response(
        JSON.stringify({
          error: "Payload too large",
          message: `Maximum payload size is ${MAX_PAYLOAD_SIZE / 1024 / 1024}MB`,
          receivedSize: `${(size / 1024 / 1024).toFixed(2)}MB`,
        }),
        {
          status: 413, // Payload Too Large
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } else {
    // If Content-Length is not provided, log a warning
    console.warn("Content-Length header not provided in webhook request");
  }

  return null;
}

// In-memory cache for public config to avoid hitting queries on every request
let publicConfigCache: { body: string; etag: string; expiresAt: number } | null =
  null;
const PUBLIC_CONFIG_TTL_MS = 60 * 1000; // 60s server-side TTL

// Simple in-memory rate limiter for webhook endpoints
// Key: IP address or identifier, Value: array of request timestamps
const rateLimitStore = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

/**
 * Check rate limit for a given identifier (IP address or request ID prefix)
 * Returns null if within limits, or Response with 429 status if exceeded
 */
function checkRateLimit(identifier: string): Response | null {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Get existing timestamps for this identifier
  let timestamps = rateLimitStore.get(identifier) || [];

  // Remove timestamps outside the current window
  timestamps = timestamps.filter(ts => ts > windowStart);

  // Check if rate limit exceeded
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestTimestamp = timestamps[0];
    const retryAfterMs = oldestTimestamp! + RATE_LIMIT_WINDOW_MS - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    console.warn("Rate limit exceeded", {
      identifier,
      requestCount: timestamps.length,
      limit: RATE_LIMIT_MAX_REQUESTS,
      retryAfterSeconds,
    });

    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: `Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per minute`,
        retryAfter: retryAfterSeconds,
      }),
      {
        status: 429, // Too Many Requests
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor((oldestTimestamp! + RATE_LIMIT_WINDOW_MS) / 1000)),
        },
      }
    );
  }

  // Add current timestamp and update store
  timestamps.push(now);
  rateLimitStore.set(identifier, timestamps);

  // Cleanup old entries periodically (every 100 requests)
  if (Math.random() < 0.01) {
    cleanupRateLimitStore();
  }

  return null;
}

/**
 * Clean up old entries from rate limit store to prevent memory leaks
 */
function cleanupRateLimitStore(): void {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  for (const [identifier, timestamps] of rateLimitStore.entries()) {
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(identifier);
    } else {
      rateLimitStore.set(identifier, validTimestamps);
    }
  }
}

// SSE endpoints removed - using Convex's native real-time subscriptions instead

const EXPORT_AUDIENCE = "exports";

// Issue signed export token (short-lived) using Clerk auth
http.route({
  path: "/api/exports/issue-token",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const requestOrigin = request.headers.get("origin") || undefined;
    const allowedOrigin = requestOrigin || process.env.APP_URL || "*";
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        Vary: "Origin",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }),
});

http.route({
  path: "/api/exports/issue-token",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestOrigin = request.headers.get("origin") || undefined;
    const allowedOrigin = requestOrigin || process.env.APP_URL || "*";
    const headersBase = {
      "Access-Control-Allow-Origin": allowedOrigin,
      Vary: "Origin",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    } as Record<string, string>;

    try {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: headersBase,
        });
      }

      const user = await ctx.runQuery(
        internal.users.internal.getUserByClerkIdInternal,
        {
          clerkId: identity.subject,
        },
      );

      if (!user) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 401,
          headers: headersBase,
        });
      }

      if (user.isActive === false) {
        return new Response(JSON.stringify({ error: "User inactive" }), {
          status: 403,
          headers: headersBase,
        });
      }

      const secret =
        process.env.EXPORT_TOKEN_SECRET || process.env.SSE_TOKEN_SECRET;
      if (!secret) {
        return new Response(
          JSON.stringify({ error: "Export token secret not configured" }),
          {
            status: 500,
            headers: headersBase,
          },
        );
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const payload: ExportTokenPayload = {
        uid: String(user._id),
        iat: nowSec,
        exp: nowSec + 10 * 60,
        aud: EXPORT_AUDIENCE,
        n: randomNonce(),
        iss: "convex",
        ver: 2,
        ori: requestOrigin || undefined,
      };

      const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
      const signature = await hmacSha256(secret, payloadB64);
      const token = `v2.${payloadB64}.${signature}`;

      return new Response(
        JSON.stringify({ token, expiresAt: payload.exp * 1000 }),
        {
          status: 200,
          headers: headersBase,
        },
      );
    } catch (error) {
      console.error("Failed to issue export token", error);
      return new Response(JSON.stringify({ error: "Token issuance failed" }), {
        status: 500,
        headers: headersBase,
      });
    }
  }),
});

// Leads export endpoint (CSV) - backend-only export
http.route({
  path: "/api/exports/leads.csv",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const userIdParam = (url.searchParams.get("userId") || "").trim();
    const token = url.searchParams.get("token");
    const searchIdParam = url.searchParams.get("searchId");

    // Set CORS headers
    const requestOrigin = request.headers.get("origin") || undefined;
    const allowedOrigin = requestOrigin || process.env.APP_URL || "*";
    const baseHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      Vary: "Origin",
    } as Record<string, string>;

    if (!token) {
      return new Response("Missing token", {
        status: 401,
        headers: baseHeaders,
      });
    }

    let resolvedUserId: string | undefined;

    if (token.startsWith("v2.")) {
      const secret =
        process.env.EXPORT_TOKEN_SECRET || process.env.SSE_TOKEN_SECRET;
      if (!secret) {
        return new Response("Export token secret not configured", {
          status: 500,
          headers: baseHeaders,
        });
      }

      const verification = await verifyExportToken(
        token,
        secret,
        EXPORT_AUDIENCE,
        requestOrigin,
      );

      if (!verification.valid || !verification.payload) {
        return new Response("Invalid authentication token", {
          status: 401,
          headers: baseHeaders,
        });
      }

      resolvedUserId = verification.payload.uid;

      if (userIdParam && userIdParam !== resolvedUserId) {
        return new Response("User mismatch", {
          status: 403,
          headers: baseHeaders,
        });
      }
    } else {
      if (!userIdParam) {
        return new Response("Missing userId", {
          status: 401,
          headers: baseHeaders,
        });
      }

      try {
        const tokenData = bufferFromBase64(token)
          .toString("utf8")
          .split(":");
        if (tokenData.length !== 3 || tokenData[0] !== userIdParam) {
          return new Response("Invalid authentication token", {
            status: 401,
            headers: baseHeaders,
          });
        }
        const tokenTimestamp = parseInt(tokenData[1]!);
        const tokenAge = Date.now() - tokenTimestamp;
        if (isNaN(tokenTimestamp) || tokenAge > 60 * 60 * 1000) {
          return new Response("Authentication token expired", {
            status: 401,
            headers: baseHeaders,
          });
        }
        resolvedUserId = userIdParam;
      } catch (e) {
        return new Response("Invalid authentication token format", {
          status: 401,
          headers: baseHeaders,
        });
      }
    }

    if (!resolvedUserId) {
      return new Response("Unable to resolve user", {
        status: 401,
        headers: baseHeaders,
      });
    }

    // Verify user exists
    const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
      userId: resolvedUserId as Id<"users">,
    });
    if (!user) {
      return new Response("User not found", {
        status: 401,
        headers: baseHeaders,
      });
    }

    if (user.isActive === false) {
      return new Response("User inactive", {
        status: 403,
        headers: baseHeaders,
      });
    }

    try {
      // Get leads data
      const searchId = searchIdParam as Id<"searches"> | undefined;
      let leads: LeadDoc[] = [];

      if (searchId) {
        const search = await ctx.runQuery(
          internal.search.internal.getSearchInternal,
          {
            searchId: searchId as any,
          },
        );

        if (!search || String(search.userId) !== resolvedUserId) {
          return new Response("Search not found or access denied", {
            status: 403,
            headers: baseHeaders,
          });
        }

        leads = (await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          {
            searchId: searchId as any,
          },
        )) as LeadDoc[];
      } else {
        // Collect all user leads with pagination to avoid 16MB limit
        let allLeads: LeadDoc[] = [];
        let cursor: string | undefined = undefined;
        let isDone = false;

        while (!isDone) {
          const result = (await ctx.runQuery(
            internal.leads.internal.getUserLeadsInternal,
            {
              userId: resolvedUserId as Id<"users">,
              cursor,
            },
          )) as { leads: LeadDoc[]; cursor: string; isDone: boolean };

          allLeads = allLeads.concat(result.leads);
          cursor = result.cursor;
          isDone = result.isDone;

          // Safety limit: max 50,000 leads per export
          if (allLeads.length >= 50000) {
            console.warn(`Export truncated at 50,000 leads for user ${resolvedUserId}`);
            break;
          }
        }

        leads = allLeads;
      }

      if (!leads || leads.length === 0) {
        return new Response("No leads found for export", {
          status: 404,
          headers: baseHeaders,
        });
      }

      // Filter out leads without email addresses and failed analyses - only export actionable leads.
      // Prefer the same email resolution logic used by CSV row rendering so legacy records with
      // lead.email or contact-level emails are still exportable.
      const totalBeforeFilter = leads.length;
      leads = leads.filter((lead) => {
        const resolvedContact = extractContactDetails(lead);
        const hasEmail = resolvedContact.email.trim().length > 0;
        const analysisFailed = (lead as any).analysisStatus === "failed";
        return hasEmail && !analysisFailed;
      });

      if (leads.length === 0) {
        return new Response(
          `No leads with email addresses found for export (${totalBeforeFilter} leads discovered but none had contact emails)`,
          {
            status: 404,
            headers: baseHeaders,
          },
        );
      }

      const userId = resolvedUserId as Id<"users">;
      const leadIdSet = new Set(leads.map((lead) => String(lead._id)));

      const emailRequests = (await ctx.runQuery(
        internal.langgraph.internal.getUserEmailGenerationRequests,
        {
          userId,
          leadIds: leads.map((lead) => lead._id),
        },
      )) as LanggraphRequestDoc[];

      const emailDetailsByLead = new Map<string, EmailExportDetails>();

      for (const request of emailRequests) {
        if (!request.leadId || request.status !== "completed") {
          continue;
        }

        const leadKey = String(request.leadId);
        if (!leadIdSet.has(leadKey)) {
          continue;
        }

        const timestamp = request.completedAt ?? request.createdAt ?? 0;
        const existing = emailDetailsByLead.get(leadKey);
        if (existing && existing.timestamp >= timestamp) {
          continue;
        }

        const outputData = request.outputData as Record<string, unknown> | undefined;
        const parsed = extractEmailDetails(outputData);

        emailDetailsByLead.set(leadKey, {
          requestId: request.requestId,
          primarySubject: parsed.primarySubject,
          primaryBody: parsed.primaryBody,
          followUps: parsed.followUps,
          timestamp,
        });
      }

      const csvHeaders = [
        "id",
        "company_name",
        "website",
        "company_profile",
        "first_name",
        "full_name",
        "email",
        "phone",
        "category",
        "subject_line_1",
        "body_line_1",
        "created_at",
        "subject_follow_up_1",
        "body_follow_up_1",
        "subject_follow_up_2",
        "body_follow_up_2",
        // Raw Perplexity research data
        "full_research_report",
        "perplexity_citations",
        "research_confidence_score",
        // Lead tier classification
        "lead_tier",
        // Removed follow_up_3 - now limited to 2 follow-ups
      ];

      const csvRows = leads.map((lead) => {
        const leadKey = String(lead._id);
        const emailDetails = emailDetailsByLead.get(leadKey);

        // Get follow-up emails from langgraphRequests outputData OR from lead.followUpEmails
        let followUps = emailDetails?.followUps ?? [];

        // If no follow-ups from langgraphRequests, try lead.followUpEmails
        if (followUps.length === 0 && (lead as any).followUpEmails) {
          const leadFollowUps = (lead as any).followUpEmails;
          if (Array.isArray(leadFollowUps)) {
            followUps = parseFollowUps(leadFollowUps);
          }
        }

        const defaultFollowUp: FollowUpEmail = { subject: "", body: "" };
        const followUp1: FollowUpEmail = followUps[0] ?? defaultFollowUp;
        const followUp2: FollowUpEmail = followUps[1] ?? defaultFollowUp;
        // Removed followUp3 - now limited to 2 follow-ups

        const contactDetails = extractContactDetails(lead);
        const companyProfile = extractCompanyProfile(lead);
        const primarySubject =
          firstNonEmptyString(
            emailDetails?.primarySubject,
            lead.emailContent?.subject,
          );
        const primaryBody =
          firstNonEmptyString(emailDetails?.primaryBody, lead.emailContent?.body);

        // Extract raw Perplexity research data from aiAnalysis
        const aiAnalysis = (lead as any).aiAnalysis;
        const leadAnalysis = aiAnalysis?.leadAnalysis;
        const fullResearchReport =
          leadAnalysis?.research_metadata?.comprehensive_report ||
          leadAnalysis?.comprehensive_report || "";
        const perplexityCitations = JSON.stringify(
          leadAnalysis?.research_metadata?.citations || []
        );
        const researchConfidenceScore =
          leadAnalysis?.research_metadata?.confidence_score || "";

        const rowValues: unknown[] = [
          leadKey,
          lead.businessName ?? "",
          lead.website ?? "",
          companyProfile,
          contactDetails.firstName,
          contactDetails.fullName,
          contactDetails.email,
          lead.phone ?? "",
          lead.category ?? "",
          primarySubject,
          primaryBody,
          new Date(lead.createdAt).toISOString(),
          followUp1.subject,
          followUp1.body,
          followUp2.subject,
          followUp2.body,
          // Raw Perplexity research data
          fullResearchReport,
          perplexityCitations,
          researchConfidenceScore,
          // Lead tier classification
          (lead as any).leadTier ?? "",
          // Removed followUp3 - now limited to 2 follow-ups
        ];

        return rowValues.map(escapeCsvValue).join(",");
      });

      const csvContent = [csvHeaders.join(","), ...csvRows].join("\n");

      return new Response(csvContent, {
        headers: {
          ...baseHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": searchId
            ? `attachment; filename="leads_${searchId}.csv"`
            : `attachment; filename="leads_${resolvedUserId}.csv"`,
        },
      });
    } catch (error) {
      console.error("Export error:", error);
      return new Response("Export failed", {
        status: 500,
        headers: baseHeaders,
      });
    }
  }),
});

// OPTIONS for CORS
http.route({
  path: "/api/exports/leads.csv",
  method: "OPTIONS",
  handler: httpAction(async (ctx, request) => {
    const requestOrigin = request.headers.get("origin") || undefined;
    const allowedOrigin = requestOrigin || process.env.APP_URL || "*";
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        Vary: "Origin",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }),
});

// Public app configuration endpoint with caching
http.route({
  path: "/api/config",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestOrigin = request.headers.get("origin") || undefined;
    const allowedOrigin = requestOrigin || process.env.APP_URL || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      Vary: "Origin",
    };

    try {
      const now = Date.now();

      // Check cache first
      if (
        publicConfigCache &&
        now < publicConfigCache.expiresAt &&
        request.headers.get("if-none-match") === publicConfigCache.etag
      ) {
        return new Response(null, {
          status: 304,
          headers: {
            ...corsHeaders,
            ETag: publicConfigCache.etag,
            "Cache-Control": "public, max-age=60",
          },
        });
      }

      if (publicConfigCache && now < publicConfigCache.expiresAt) {
        return new Response(publicConfigCache.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            ETag: publicConfigCache.etag,
            "Cache-Control": "public, max-age=60",
          },
        });
      }

      // Fetch fresh config
      const config = await ctx.runQuery(api.admin.queries.getSystemConfiguration, {});

      const responseBody = JSON.stringify(config);
      const etag = `"${bufferFromString(responseBody).toString("base64").slice(0, 12)}"`;

      // Update cache
      publicConfigCache = {
        body: responseBody,
        etag,
        expiresAt: now + PUBLIC_CONFIG_TTL_MS,
      };

      return new Response(responseBody, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ETag: etag,
          "Cache-Control": "public, max-age=60",
        },
      });
    } catch (error) {
      console.error("Config fetch error:", error);
      return new Response(JSON.stringify({ error: "Failed to fetch config" }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }
  }),
});

// OPTIONS for CORS
http.route({
  path: "/api/config",
  method: "OPTIONS",
  handler: httpAction(async (ctx, request) => {
    const requestOrigin = request.headers.get("origin") || undefined;
    const allowedOrigin = requestOrigin || process.env.APP_URL || "*";
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        Vary: "Origin",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }),
});

/**
 * FastSpring webhook handler
 * Verifies HMAC SHA256 signature and routes events to appropriate handlers
 *
 * Events handled:
 * - order.completed (credits and subscription orders)
 * - subscription.activated (new subscription active)
 * - subscription.charge.completed (recurring payment success)
 * - subscription.updated (plan changes, prorations)
 * - subscription.canceled (cancellation initiated)
 * - subscription.deactivated (subscription ended)
 * - subscription.charge.failed (payment failure)
 */
http.route({
  path: "/webhooks/fastspring",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Get the signature from FastSpring header
      const signature = request.headers.get("X-FS-Signature");
      if (!signature) {
        console.error("Missing FastSpring signature header");
        return new Response("Missing signature", { status: 400 });
      }

      const webhookSecret = process.env.FASTSPRING_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("FastSpring webhook secret not configured");
        return new Response("FastSpring integration not configured", {
          status: 500,
        });
      }

      const rawBody = await request.text();

      // Verify HMAC SHA256 signature using Web Crypto API
      // FastSpring sends signature as base64-encoded HMAC-SHA256
      const encoder = new TextEncoder();
      const keyData = encoder.encode(webhookSecret);
      const messageData = encoder.encode(rawBody);

      // Import the key for HMAC
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      // Sign the message
      const signatureArrayBuffer = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        messageData
      );

      // Convert to base64
      const expectedSignature = btoa(
        String.fromCharCode(...new Uint8Array(signatureArrayBuffer))
      );

      // Use constant-time comparison to prevent timing attacks
      if (signature.length !== expectedSignature.length) {
        console.error("FastSpring signature verification failed", {
          receivedLength: signature.length,
          expectedLength: expectedSignature.length,
        });
        return new Response("Invalid signature", { status: 401 });
      }

      // Character-by-character comparison (constant time for equal lengths)
      let mismatch = 0;
      for (let i = 0; i < signature.length; i++) {
        mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
      }
      if (mismatch !== 0) {
        console.error("FastSpring signature verification failed");
        return new Response("Invalid signature", { status: 401 });
      }

      // Parse the webhook payload
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        console.error("Failed to parse FastSpring webhook payload", err);
        return new Response("Invalid JSON body", { status: 400 });
      }

      // FastSpring sends events array in the payload
      const events = payload.events || [payload];

      for (const event of events) {
        const eventType = event.type || event.event;
        const eventData = event.data || event;

        console.log(`FastSpring webhook received: ${eventType}`, {
          id: event.id,
          live: event.live,
        });

        switch (eventType) {
          case "order.completed": {
            // Extract order details
            const order = eventData.order || eventData;
            const account = eventData.account || order.account || {};
            const items = order.items || [];

            await ctx.runMutation(
              internal.billing.webhooks.handleOrderCompleted,
              {
                orderId: order.id || event.id,
                orderReference: order.reference || order.id,
                accountId: account.id || "",
                accountEmail: account.contact?.email || account.email || "",
                total: order.total || order.totalInPayoutCurrency || 0,
                currency: order.currency || "USD",
                items: items.map((item: any) => ({
                  product: item.product || item.productPath || "",
                  quantity: item.quantity || 1,
                  price: item.price || item.subtotal || 0,
                  subscription: item.subscription || undefined,
                })),
                tags: order.tags || eventData.tags || {},
              }
            );
            break;
          }

          case "subscription.activated": {
            const subscription = eventData.subscription || eventData;
            const account = eventData.account || subscription.account || {};

            await ctx.runMutation(
              internal.billing.webhooks.handleSubscriptionActivated,
              {
                subscriptionId: subscription.id || subscription.subscription,
                accountId: account.id || "",
                accountEmail: account.contact?.email || account.email || "",
                product: subscription.product || subscription.productPath || "",
                state: subscription.state || "active",
                nextChargeDate: subscription.nextChargeDate
                  ? Math.floor(new Date(subscription.nextChargeDate).getTime() / 1000)
                  : undefined,
                price: subscription.price || subscription.priceValue || 0,
                currency: subscription.currency || "USD",
                intervalUnit: subscription.intervalUnit,
                intervalLength: subscription.intervalLength,
                tags: subscription.tags || eventData.tags || {},
              }
            );
            break;
          }

          case "subscription.charge.completed": {
            const subscription = eventData.subscription || eventData;
            const account = eventData.account || subscription.account || {};
            const order = eventData.order || {};

            await ctx.runMutation(
              internal.billing.webhooks.handleSubscriptionChargeCompleted,
              {
                subscriptionId: subscription.id || subscription.subscription,
                accountId: account.id || "",
                orderId: order.id || event.id || "",
                orderReference: order.reference || order.id || "",
                product: subscription.product || subscription.productPath || "",
                price: subscription.price || order.total || 0,
                currency: subscription.currency || order.currency || "USD",
                nextChargeDate: subscription.nextChargeDate
                  ? Math.floor(new Date(subscription.nextChargeDate).getTime() / 1000)
                  : undefined,
                tags: subscription.tags || eventData.tags || {},
              }
            );
            break;
          }

          case "subscription.updated": {
            const subscription = eventData.subscription || eventData;
            const account = eventData.account || subscription.account || {};

            await ctx.runMutation(
              internal.billing.webhooks.handleSubscriptionUpdated,
              {
                subscriptionId: subscription.id || subscription.subscription,
                accountId: account.id || "",
                product: subscription.product || subscription.productPath || "",
                state: subscription.state || "active",
                price: subscription.price || subscription.priceValue || 0,
                currency: subscription.currency || "USD",
                nextChargeDate: subscription.nextChargeDate
                  ? Math.floor(new Date(subscription.nextChargeDate).getTime() / 1000)
                  : undefined,
                intervalUnit: subscription.intervalUnit,
                intervalLength: subscription.intervalLength,
                tags: subscription.tags || eventData.tags || {},
              }
            );
            break;
          }

          case "subscription.canceled": {
            const subscription = eventData.subscription || eventData;
            const account = eventData.account || subscription.account || {};

            await ctx.runMutation(
              internal.billing.webhooks.handleSubscriptionCanceled,
              {
                subscriptionId: subscription.id || subscription.subscription,
                accountId: account.id || "",
                product: subscription.product || subscription.productPath || "",
                canceledDate: subscription.canceledDate
                  ? Math.floor(new Date(subscription.canceledDate).getTime() / 1000)
                  : undefined,
                deactivationDate: subscription.deactivationDate
                  ? Math.floor(new Date(subscription.deactivationDate).getTime() / 1000)
                  : undefined,
                tags: subscription.tags || eventData.tags || {},
              }
            );
            break;
          }

          case "subscription.deactivated": {
            const subscription = eventData.subscription || eventData;
            const account = eventData.account || subscription.account || {};

            await ctx.runMutation(
              internal.billing.webhooks.handleSubscriptionDeactivated,
              {
                subscriptionId: subscription.id || subscription.subscription,
                accountId: account.id || "",
                product: subscription.product || subscription.productPath || "",
                tags: subscription.tags || eventData.tags || {},
              }
            );
            break;
          }

          case "subscription.charge.failed": {
            const subscription = eventData.subscription || eventData;
            const account = eventData.account || subscription.account || {};

            await ctx.runMutation(
              internal.billing.webhooks.handleSubscriptionChargeFailed,
              {
                subscriptionId: subscription.id || subscription.subscription,
                accountId: account.id || "",
                product: subscription.product || subscription.productPath || "",
                reason: eventData.reason || subscription.failureReason,
                retryDate: subscription.nextRetryDate
                  ? Math.floor(new Date(subscription.nextRetryDate).getTime() / 1000)
                  : undefined,
                tags: subscription.tags || eventData.tags || {},
              }
            );
            break;
          }

          default: {
            console.log(`Unhandled FastSpring event type: ${eventType}`);
          }
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("FastSpring webhook error:", error);
      return new Response(JSON.stringify({ error: "Webhook handler failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

// Clerk webhook handler
http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const svixHeaders = {
        "svix-id": request.headers.get("svix-id"),
        "svix-timestamp": request.headers.get("svix-timestamp"),
        "svix-signature": request.headers.get("svix-signature"),
      };

      if (!svixHeaders["svix-id"] || !svixHeaders["svix-timestamp"] || !svixHeaders["svix-signature"]) {
        console.error("Missing required Svix headers");
        return new Response("Missing required Svix headers", { status: 400 });
      }

      const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("CLERK_WEBHOOK_SECRET not configured");
        return new Response("Webhook secret not configured", { status: 500 });
      }

      const body = await request.text();

      // Verify webhook signature using Svix
      const wh = new Webhook(webhookSecret);

      let evt: any;
      try {
        evt = wh.verify(body, {
          "svix-id": svixHeaders["svix-id"]!,
          "svix-timestamp": svixHeaders["svix-timestamp"]!,
          "svix-signature": svixHeaders["svix-signature"]!,
        });
      } catch (err) {
        if (err instanceof WebhookVerificationError) {
          console.error("Clerk webhook signature verification failed", {
            error: err.message,
            svixId: svixHeaders["svix-id"],
          });
          return new Response("Invalid signature", { status: 400 });
        }
        console.error("Clerk webhook signature verification error", err);
        return new Response("Signature verification failed", { status: 400 });
      }

      console.log(`Clerk webhook received: ${evt.type}`);

      // Handle different Clerk event types
      switch (evt.type) {
        case "user.created": {
          const { id, email_addresses, first_name, last_name, image_url } = evt.data;
          const primaryEmail = email_addresses?.find((e: any) => e.id === evt.data.primary_email_address_id);
          const email = primaryEmail?.email_address || "";

          // Check if user already exists
          const existingUser = await ctx.runQuery(
            internal.users.internal.getUserByClerkIdInternal,
            { clerkId: id }
          );

          if (!existingUser) {
            // Create new user in Convex
            await ctx.runMutation(internal.users.internal.createUserInternal, {
              clerkId: id,
              email: email,
              name: [first_name, last_name].filter(Boolean).join(" ") || email.split("@")[0],
              avatar: image_url || undefined,
            });
            console.log(`User created: ${id} (${email})`);
          } else {
            console.log(`User already exists: ${id}`);
          }
          break;
        }

        case "user.updated": {
          const { id, email_addresses, first_name, last_name, image_url } = evt.data;
          const primaryEmail = email_addresses?.find((e: any) => e.id === evt.data.primary_email_address_id);
          const email = primaryEmail?.email_address || "";

          await ctx.runMutation(internal.users.internal.updateUserByClerkIdInternal, {
            clerkId: id,
            email: email,
            name: [first_name, last_name].filter(Boolean).join(" ") || undefined,
            avatar: image_url || undefined,
          });
          console.log(`User updated: ${id}`);
          break;
        }

        case "user.deleted": {
          const { id } = evt.data;
          await ctx.runMutation(internal.users.internal.deleteUserByClerkIdInternal, {
            clerkId: id,
          });
          console.log(`User deleted: ${id}`);
          break;
        }

        case "session.created":
        case "session.ended":
          // Optional: handle session events if needed
          console.log(`Session event: ${evt.type}`);
          break;

        default:
          console.log(`Unhandled Clerk event type: ${evt.type}`);
      }

      return new Response("Webhook processed successfully");
    } catch (error) {
      console.error("Clerk webhook processing failed:", error);
      return new Response("Webhook processing failed", { status: 500 });
    }
  }),
});

// LangGraph webhook handler for email generation completion
http.route({
  path: "/webhooks/langgraph/email-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    // Extract correlation headers for logging (use different name to avoid shadowing)
    const headerRequestId = request.headers.get("X-Request-ID") || "unknown";
    const workerTimestamp = request.headers.get("X-Worker-Timestamp") || "unknown";

    console.log(`[Webhook:email-completed] Received request`, {
      requestId: headerRequestId,
      workerTimestamp,
      url: request.url,
    });

    // Check rate limit before processing (use request ID prefix as identifier)
    const rateLimitError = checkRateLimit(`webhook:${headerRequestId.split('_')[0]}`);
    if (rateLimitError) {
      console.warn(`[Webhook:email-completed] Rate limit exceeded`, { requestId: headerRequestId });
      return rateLimitError;
    }

    // Log webhook signature for security auditing
    logWebhookSignature(request);

    try {
      // Validate payload size before authentication
      const sizeError = validatePayloadSize(request);
      if (sizeError) {
        console.error(`[Webhook:email-completed] Payload too large`, { requestId: headerRequestId });
        return sizeError;
      }

      const authResult = authorizeLanggraphWebhook(request);
      if (authResult instanceof Response) {
        console.error(`[Webhook:email-completed] Authentication failed`, {
          requestId: headerRequestId,
          status: authResult.status,
        });
        return authResult;
      }

      if (
        authResult.userAgent &&
        !authResult.userAgent.toLowerCase().includes("langgraph-worker")
      ) {
        console.warn(
          "Unexpected user agent for LangGraph webhook:",
          authResult.userAgent,
        );
      }

      const contentTypeError = ensureJsonRequest(request);
      if (contentTypeError) {
        return contentTypeError;
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch (error) {
        console.error("Failed to parse LangGraph email webhook payload", error);
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!payload || typeof payload !== "object") {
        return new Response(JSON.stringify({ error: "Invalid payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payloadRecord = payload as Record<string, unknown>;
      const requestId = payloadRecord.request_id;
      if (typeof requestId !== "string" || requestId.length === 0) {
        return new Response(
          JSON.stringify({ error: "Missing request_id in payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // headerRequestId already extracted at function start
      if (headerRequestId !== "unknown" && headerRequestId !== requestId) {
        console.warn(
          "LangGraph webhook request_id mismatch",
          {
            headerRequestId,
            payloadRequestId: requestId,
          },
        );
      }

      const result = await ctx.runMutation(
        internal.langgraph.webhooks.handleEmailGenerationCompleted,
        {
          payload: payloadRecord as any,
        },
      );

      if (!result.success) {
        console.error(`Webhook processing failed: ${result.error}`);
        return new Response(JSON.stringify({ error: result.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("LangGraph email webhook error:", error);

      const isRetryable =
        error instanceof Error &&
        (error.message.includes("timeout") ||
          error.message.includes("connection") ||
          error.message.includes("unavailable") ||
          error.message.includes("overloaded"));

      const statusCode = isRetryable ? 500 : 400;

      return new Response(
        JSON.stringify({
          error: "Webhook processing failed",
          retryable: isRetryable,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }),
});

// LangGraph webhook handler for lead analysis completion
http.route({
  path: "/webhooks/langgraph/analysis-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    // Extract correlation headers for logging (use different name to avoid shadowing)
    const headerRequestId = request.headers.get("X-Request-ID") || "unknown";
    const headerLeadId = request.headers.get("X-Lead-ID") || "unknown";
    const workerTimestamp = request.headers.get("X-Worker-Timestamp") || "unknown";

    console.log(`[Webhook:analysis-completed] Received request`, {
      requestId: headerRequestId,
      leadId: headerLeadId,
      workerTimestamp,
      url: request.url,
    });

    // Check rate limit before processing (use request ID prefix as identifier)
    const rateLimitError = checkRateLimit(`webhook:${headerRequestId.split('_')[0]}`);
    if (rateLimitError) {
      console.warn(`[Webhook:analysis-completed] Rate limit exceeded`, {
        requestId: headerRequestId,
        leadId: headerLeadId,
      });
      return rateLimitError;
    }

    // Log webhook signature for security auditing
    logWebhookSignature(request);

    try {
      // Validate payload size before authentication
      const sizeError = validatePayloadSize(request);
      if (sizeError) {
        console.error(`[Webhook:analysis-completed] Payload too large`, {
          requestId: headerRequestId,
          leadId: headerLeadId,
        });
        return sizeError;
      }

      const authResult = authorizeLanggraphWebhook(request);
      if (authResult instanceof Response) {
        console.error(`[Webhook:analysis-completed] Authentication failed`, {
          requestId: headerRequestId,
          leadId: headerLeadId,
          status: authResult.status,
        });
        return authResult;
      }

      if (
        authResult.userAgent &&
        !authResult.userAgent.toLowerCase().includes("langgraph-worker")
      ) {
        console.warn(
          "Unexpected user agent for LangGraph analysis webhook:",
          authResult.userAgent,
        );
      }

      const contentTypeError = ensureJsonRequest(request);
      if (contentTypeError) {
        return contentTypeError;
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch (error) {
        console.error("Failed to parse LangGraph analysis webhook payload", error);
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!payload || typeof payload !== "object") {
        return new Response(JSON.stringify({ error: "Invalid payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payloadRecord = payload as Record<string, unknown>;
      const requestId = payloadRecord.request_id;
      const leadId = payloadRecord.lead_id;
      if (typeof requestId !== "string" || typeof leadId !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing request_id or lead_id in payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // headerRequestId already extracted at function start
      if (headerRequestId !== "unknown" && headerRequestId !== requestId) {
        console.warn(
          "LangGraph analysis webhook request_id mismatch",
          {
            headerRequestId,
            payloadRequestId: requestId,
          },
        );
      }

      const result = await ctx.runMutation(
        internal.langgraph.webhooks.handleAnalysisCompleted,
        {
          payload: payloadRecord as any,
        },
      );

      if (!result.success) {
        console.error(`Analysis webhook processing failed: ${result.error}`);
        return new Response(JSON.stringify({ error: result.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("LangGraph analysis webhook error:", error);

      const isRetryable =
        error instanceof Error &&
        (error.message.includes("timeout") ||
          error.message.includes("connection") ||
          error.message.includes("unavailable") ||
          error.message.includes("overloaded"));

      const statusCode = isRetryable ? 500 : 400;

      return new Response(
        JSON.stringify({
          error: "Webhook processing failed",
          retryable: isRetryable,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }),
});

// LangGraph webhook handler for batch progress updates (sent every 10 leads)
http.route({
  path: "/webhooks/langgraph/batch-progress",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    const headerBatchId = request.headers.get("X-Batch-ID") || "unknown";
    const workerTimestamp = request.headers.get("X-Worker-Timestamp") || "unknown";

    console.log(`[Webhook:batch-progress] Received request`, {
      batchId: headerBatchId,
      workerTimestamp,
      url: request.url,
    });

    // Check rate limit (batch progress is frequent, use batch ID)
    const rateLimitError = checkRateLimit(`webhook:batch-progress:${headerBatchId}`);
    if (rateLimitError) {
      console.warn(`[Webhook:batch-progress] Rate limit exceeded`, { batchId: headerBatchId });
      return rateLimitError;
    }

    logWebhookSignature(request);

    try {
      const sizeError = validatePayloadSize(request);
      if (sizeError) {
        console.error(`[Webhook:batch-progress] Payload too large`, { batchId: headerBatchId });
        return sizeError;
      }

      const authResult = authorizeLanggraphWebhook(request);
      if (authResult instanceof Response) {
        console.error(`[Webhook:batch-progress] Authentication failed`, {
          batchId: headerBatchId,
          status: authResult.status,
        });
        return authResult;
      }

      const contentTypeError = ensureJsonRequest(request);
      if (contentTypeError) {
        return contentTypeError;
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch (error) {
        console.error("Failed to parse batch progress webhook payload", error);
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!payload || typeof payload !== "object") {
        return new Response(JSON.stringify({ error: "Invalid payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payloadRecord = payload as Record<string, unknown>;
      const batchId = payloadRecord.batchId;
      if (typeof batchId !== "string" || batchId.length === 0) {
        return new Response(
          JSON.stringify({ error: "Missing batchId in payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const result = await ctx.runMutation(
        internal.langgraph.webhooks.handleBatchProgress,
        {
          payload: payloadRecord as any,
        },
      );

      // Non-critical webhook - always return success
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Batch progress webhook error:", error);

      // Non-critical webhook - return 200 to prevent retries
      return new Response(
        JSON.stringify({
          success: true,
          warning: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }),
});

// LangGraph webhook handler for batch completion
http.route({
  path: "/webhooks/langgraph/batch-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    const headerBatchId = request.headers.get("X-Batch-ID") || "unknown";
    const workerTimestamp = request.headers.get("X-Worker-Timestamp") || "unknown";

    console.log(`[Webhook:batch-completed] Received request`, {
      batchId: headerBatchId,
      workerTimestamp,
      url: request.url,
    });

    // Check rate limit
    const rateLimitError = checkRateLimit(`webhook:batch-completed:${headerBatchId}`);
    if (rateLimitError) {
      console.warn(`[Webhook:batch-completed] Rate limit exceeded`, { batchId: headerBatchId });
      return rateLimitError;
    }

    logWebhookSignature(request);

    try {
      const sizeError = validatePayloadSize(request);
      if (sizeError) {
        console.error(`[Webhook:batch-completed] Payload too large`, { batchId: headerBatchId });
        return sizeError;
      }

      const authResult = authorizeLanggraphWebhook(request);
      if (authResult instanceof Response) {
        console.error(`[Webhook:batch-completed] Authentication failed`, {
          batchId: headerBatchId,
          status: authResult.status,
        });
        return authResult;
      }

      const contentTypeError = ensureJsonRequest(request);
      if (contentTypeError) {
        return contentTypeError;
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch (error) {
        console.error("Failed to parse batch completion webhook payload", error);
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!payload || typeof payload !== "object") {
        return new Response(JSON.stringify({ error: "Invalid payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payloadRecord = payload as Record<string, unknown>;
      const batchId = payloadRecord.batchId;
      if (typeof batchId !== "string" || batchId.length === 0) {
        return new Response(
          JSON.stringify({ error: "Missing batchId in payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const result = await ctx.runMutation(
        internal.langgraph.webhooks.handleBatchCompleted,
        {
          payload: payloadRecord as any,
        },
      );

      if (!result.success) {
        console.error(`Batch completion processing failed: ${result.error}`);
        return new Response(JSON.stringify({ error: result.error }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          processedSuccessfully: result.processedSuccessfully,
          processingErrors: result.processingErrors,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      console.error("Batch completion webhook error:", error);

      const isRetryable =
        error instanceof Error &&
        (error.message.includes("timeout") ||
          error.message.includes("connection") ||
          error.message.includes("unavailable") ||
          error.message.includes("overloaded"));

      const statusCode = isRetryable ? 500 : 400;

      return new Response(
        JSON.stringify({
          error: "Webhook processing failed",
          retryable: isRetryable,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: statusCode,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }),
});

// ============================================================================
// STRIPE WEBHOOKS
// ============================================================================

/**
 * Stripe webhook endpoint for custom subscription events.
 *
 * Handles:
 * - checkout.session.completed: Subscription activation
 * - invoice.paid: Monthly renewal
 * - invoice.payment_failed: Payment failure handling
 * - customer.subscription.updated: Status changes
 * - customer.subscription.deleted: Cancellation
 * - payment_intent.succeeded: Extra credit purchases
 */
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      console.error("[Stripe Webhook] Missing stripe-signature header");
      return new Response(
        JSON.stringify({ error: "Missing stripe-signature header" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get raw body for signature verification
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch (error) {
      console.error("[Stripe Webhook] Failed to read request body:", error);
      return new Response(
        JSON.stringify({ error: "Failed to read request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // CRITICAL: Verify Stripe webhook signature before processing
    // This prevents attackers from forging webhook events
    const verificationResult = await ctx.runAction(
      internal.billing.stripe.webhooks.verifyAndParseWebhook,
      {
        payload: rawBody,
        signature: signature,
      }
    );

    if (!verificationResult.success || !verificationResult.event) {
      console.error("[Stripe Webhook] Signature verification failed:", verificationResult.error);
      return new Response(
        JSON.stringify({ error: "Invalid signature", details: verificationResult.error }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const event = verificationResult.event as unknown as {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };

    console.log(`[Stripe Webhook] Verified event: ${event.type}`, {
      eventId: event.id,
    });

    // ATOMIC IDEMPOTENCY: Try to claim the event for processing
    // This uses a mutation (not query) to atomically check-and-claim,
    // preventing race conditions where two concurrent requests both process the same event.
    const claimResult = await ctx.runMutation(
      internal.billing.stripe.webhooks.tryClaimEvent,
      { eventId: event.id, eventType: event.type }
    );

    if (!claimResult.claimed) {
      console.log(`[Stripe Webhook] Event already claimed/processed, skipping: ${event.id}`, {
        eventType: event.type,
        previousResult: claimResult.result,
      });
      return new Response(
        JSON.stringify({
          received: true,
          type: event.type,
          status: "already_processed",
          previousResult: claimResult.result,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    try {
      // Route to appropriate handler based on event type
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          // Extract subscription period dates if the subscription object is expanded
          // Otherwise the handler will use a 30-day fallback (corrected by invoice.paid)
          const subscriptionData = session.subscription as
            | string
            | { id: string; current_period_start: number; current_period_end: number }
            | null;
          const subscriptionId =
            typeof subscriptionData === "string"
              ? subscriptionData
              : subscriptionData?.id || "";
          const currentPeriodStart =
            typeof subscriptionData === "object" && subscriptionData
              ? subscriptionData.current_period_start
              : undefined;
          const currentPeriodEnd =
            typeof subscriptionData === "object" && subscriptionData
              ? subscriptionData.current_period_end
              : undefined;

          await ctx.runMutation(
            internal.billing.stripe.webhooks.handleCheckoutCompleted,
            {
              sessionId: session.id as string,
              subscriptionId,
              customerId: session.customer as string,
              paymentMethodType: (session.payment_method_types as string[])?.[0],
              metadata: session.metadata,
              currentPeriodStart,
              currentPeriodEnd,
            }
          );
          break;
        }

        case "invoice.paid": {
          const invoice = event.data.object;
          // Skip if no subscription (one-time payment)
          if (!invoice.subscription) break;

          await ctx.runMutation(
            internal.billing.stripe.webhooks.handleInvoicePaid,
            {
              invoiceId: invoice.id as string,
              subscriptionId: invoice.subscription as string,
              customerId: invoice.customer as string,
              amountPaid: invoice.amount_paid as number,
              periodStart: invoice.period_start as number,
              periodEnd: invoice.period_end as number,
            }
          );
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          if (!invoice.subscription) break;

          await ctx.runMutation(
            internal.billing.stripe.webhooks.handleInvoicePaymentFailed,
            {
              invoiceId: invoice.id as string,
              subscriptionId: invoice.subscription as string,
              customerId: invoice.customer as string,
              attemptCount: invoice.attempt_count as number,
              nextAttemptAt: invoice.next_payment_attempt as number | undefined,
            }
          );
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;
          await ctx.runMutation(
            internal.billing.stripe.webhooks.handleSubscriptionUpdated,
            {
              subscriptionId: subscription.id as string,
              status: subscription.status as string,
              cancelAtPeriodEnd: subscription.cancel_at_period_end as boolean,
              currentPeriodEnd: subscription.current_period_end as number,
              defaultPaymentMethod: subscription.default_payment_method as string | undefined,
            }
          );
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          await ctx.runMutation(
            internal.billing.stripe.webhooks.handleSubscriptionDeleted,
            {
              subscriptionId: subscription.id as string,
              customerId: subscription.customer as string,
            }
          );
          break;
        }

        case "payment_intent.succeeded": {
          const paymentIntent = event.data.object;
          // Only handle if it's an extra credit purchase (check metadata)
          const metadata = paymentIntent.metadata as Record<string, string> | undefined;
          if (metadata?.type === "extra_credits") {
            await ctx.runMutation(
              internal.billing.stripe.webhooks.handleExtraCreditPayment,
              {
                paymentIntentId: paymentIntent.id as string,
                metadata: paymentIntent.metadata,
              }
            );
          }
          break;
        }

        default:
          // Log unhandled events for monitoring
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
          // Mark as skipped (still processed to prevent re-processing)
          await ctx.runMutation(
            internal.billing.stripe.webhooks.markEventProcessed,
            {
              eventId: event.id,
              eventType: event.type,
              result: "skipped",
            }
          );
      }

      // IDEMPOTENCY: Mark event as successfully processed
      // This must happen AFTER the handler succeeds to ensure atomicity
      if (event.type !== "checkout.session.completed" &&
          event.type !== "invoice.paid" &&
          event.type !== "invoice.payment_failed" &&
          event.type !== "customer.subscription.updated" &&
          event.type !== "customer.subscription.deleted" &&
          event.type !== "payment_intent.succeeded") {
        // Already marked as skipped in default case above
      } else {
        await ctx.runMutation(
          internal.billing.stripe.webhooks.markEventProcessed,
          {
            eventId: event.id,
            eventType: event.type,
            result: "success",
          }
        );
      }

      return new Response(
        JSON.stringify({ received: true, type: event.type }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } catch (error) {
      console.error(`[Stripe Webhook] Handler error for ${event.type}:`, error);

      // Return 200 for most errors to prevent Stripe from retrying
      // Only return 500 for transient errors that should be retried
      const isRetryable =
        error instanceof Error &&
        (error.message.includes("timeout") ||
          error.message.includes("connection") ||
          error.message.includes("unavailable"));

      if (isRetryable) {
        // DON'T mark as processed for retryable errors - let Stripe retry
        return new Response(
          JSON.stringify({
            error: "Temporary error - please retry",
            message: error instanceof Error ? error.message : "Unknown error",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      // Mark as failed for non-retryable errors to prevent infinite loops
      await ctx.runMutation(
        internal.billing.stripe.webhooks.markEventProcessed,
        {
          eventId: event.id,
          eventType: event.type,
          result: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );

      return new Response(
        JSON.stringify({
          received: true,
          warning: error instanceof Error ? error.message : "Handler error",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }),
});

export default http;
