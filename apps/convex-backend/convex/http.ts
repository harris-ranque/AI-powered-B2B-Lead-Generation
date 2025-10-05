import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import Stripe from "stripe";
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
  if (analysis && typeof analysis === "object" && analysis !== null) {
    const record = analysis as Record<string, unknown>;
    const candidateKeys = [
      "company_overview",
      "companyOverview",
      "company_profile",
      "companyProfile",
      "company_analysis",
      "companyAnalysis",
      "business_overview",
      "businessOverview",
      "summary",
      "description",
      "overview",
    ];

    for (const key of candidateKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    const fallbackValue = Object.values(record).find(
      (value) => typeof value === "string" && value.trim(),
    );
    if (typeof fallbackValue === "string") {
      return fallbackValue.trim();
    }
  }

  if (typeof lead.notes === "string" && lead.notes.trim()) {
    return lead.notes.trim();
  }

  return "";
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
        leads = (await ctx.runQuery(
          internal.leads.internal.getUserLeadsInternal,
          {
            userId: resolvedUserId as Id<"users">,
          },
        )) as LeadDoc[];
      }

      if (!leads || leads.length === 0) {
        return new Response("No leads found for export", {
          status: 404,
          headers: baseHeaders,
        });
      }

      const userId = resolvedUserId as Id<"users">;
      const leadIdSet = new Set(leads.map((lead) => String(lead._id)));

      const emailRequests = (await ctx.db
        .query("langgraphRequests")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("type"), "email_generation"))
        .collect()) as LanggraphRequestDoc[];

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
        "request_id",
        "company_name",
        "country",
        "city",
        "state",
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
        "subject_follow_up_3",
        "body_follow_up_3",
      ];

      const csvRows = leads.map((lead) => {
        const leadKey = String(lead._id);
        const emailDetails = emailDetailsByLead.get(leadKey);
        const followUps = emailDetails?.followUps ?? [];
        const [followUp1, followUp2, followUp3] = [0, 1, 2].map(
          (index) => followUps[index] ?? { subject: "", body: "" },
        );

        const contactDetails = extractContactDetails(lead);
        const companyProfile = extractCompanyProfile(lead);
        const primarySubject =
          firstNonEmptyString(
            emailDetails?.primarySubject,
            lead.emailContent?.subject,
          );
        const primaryBody =
          firstNonEmptyString(emailDetails?.primaryBody, lead.emailContent?.body);

        const location = lead.location ?? {};

        const rowValues: unknown[] = [
          leadKey,
          emailDetails?.requestId ?? "",
          lead.businessName ?? "",
          location.country ?? "",
          location.city ?? "",
          location.state ?? "",
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
          followUp3.subject,
          followUp3.body,
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

// Stripe webhook handler
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const signature = request.headers.get("stripe-signature");
      if (!signature) {
        console.error("Missing Stripe signature header");
        return new Response("Missing signature", { status: 400 });
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
      if (!webhookSecret || !stripeSecretKey) {
        console.error("Stripe webhook secret or API key not configured");
        return new Response("Stripe integration not configured", {
          status: 500,
        });
      }

      const rawBody = await request.text();
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2023-10-16" as Stripe.LatestApiVersion,
      });

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err) {
        console.error("Stripe signature verification failed", err);
        return new Response("Invalid signature", { status: 400 });
      }

      console.log(`Stripe webhook received: ${event.type}`);

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          await ctx.runMutation(
            internal.billing.webhooks.handleCheckoutCompleted,
            {
              sessionId: session.id,
              customerId: String(session.customer || ""),
              subscriptionId:
                typeof session.subscription === "string"
                  ? session.subscription
                  : session.subscription?.id,
              mode: session.mode || "",
              metadata: session.metadata || {},
            },
          );
          break;
        }

        case "customer.subscription.created": {
          const sub = event.data.object as Stripe.Subscription;
          const item = sub.items?.data?.[0];
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionCreated, {
            subscriptionId: sub.id,
            customerId: String(sub.customer),
            status: sub.status,
            priceId: item?.price?.id,
            currentPeriodStart:
              ((sub as any).current_period_start || 0) * 1000,
            currentPeriodEnd: ((sub as any).current_period_end || 0) * 1000,
            trialStart: (sub as any).trial_start
              ? (sub as any).trial_start * 1000
              : undefined,
            trialEnd: (sub as any).trial_end
              ? (sub as any).trial_end * 1000
              : undefined,
            metadata: (sub as any).metadata || {},
            interval: item?.price?.recurring?.interval || undefined,
          } as any);
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const item = sub.items?.data?.[0];
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionUpdated, {
            subscriptionId: sub.id,
            customerId: String(sub.customer),
            status: sub.status,
            priceId: item?.price?.id,
            currentPeriodStart:
              ((sub as any).current_period_start || 0) * 1000,
            currentPeriodEnd: ((sub as any).current_period_end || 0) * 1000,
            cancelAtPeriodEnd: (sub as any).cancel_at_period_end || false,
            cancelAt: (sub as any).cancel_at
              ? (sub as any).cancel_at * 1000
              : undefined,
            canceledAt: (sub as any).canceled_at
              ? (sub as any).canceled_at * 1000
              : undefined,
            metadata: (sub as any).metadata || {},
            interval: item?.price?.recurring?.interval || undefined,
          } as any);
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionDeleted, {
            subscriptionId: sub.id,
            customerId: String(sub.customer),
          });
          break;
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          await ctx.runMutation(internal.billing.webhooks.handlePaymentSucceeded, {
            invoiceId: String((invoice as any).id || ""),
            subscriptionId:
              typeof (invoice as any).subscription === "string"
                ? (invoice as any).subscription
                : (invoice as any).subscription?.id,
            customerId: String((invoice as any).customer || ""),
            amount: (invoice as any).amount_paid || 0,
            currency: (invoice as any).currency || "usd",
            paidAt: (invoice as any).status_transitions?.paid_at
              ? (invoice as any).status_transitions.paid_at * 1000
              : undefined,
          });
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          await ctx.runMutation(internal.billing.webhooks.handlePaymentFailed, {
            invoiceId: String((invoice as any).id || ""),
            subscriptionId:
              typeof (invoice as any).subscription === "string"
                ? (invoice as any).subscription
                : (invoice as any).subscription?.id,
            customerId: String((invoice as any).customer || ""),
            amount: (invoice as any).amount_due || 0,
            currency: (invoice as any).currency || "usd",
            attemptCount: (invoice as any).attempt_count || 0,
            nextPaymentAttempt: (invoice as any).next_payment_attempt
              ? (invoice as any).next_payment_attempt * 1000
              : undefined,
          });
          break;
        }

        default: {
          console.log(`Unhandled Stripe event type: ${event.type}`);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Stripe webhook error:", error);
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
        return new Response("Missing required Svix headers", { status: 400 });
      }

      const body = await request.text();
      // Handle Clerk webhook - simplified version
      // For now, just return success - webhook handling can be implemented later

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

export default http;
