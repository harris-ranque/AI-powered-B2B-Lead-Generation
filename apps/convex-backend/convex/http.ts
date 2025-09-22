import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import Stripe from "stripe";

const http = httpRouter();

const encoder = new TextEncoder();

function base64UrlEncode(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlEncodeString(data: string): string {
  return base64UrlEncode(encoder.encode(data));
}

function base64UrlDecodeToString(data: string): string {
  const padded = data.padEnd(data.length + ((4 - (data.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function randomNonce(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

interface ExportTokenPayload {
  uid: string;
  iat: number;
  exp: number;
  aud?: string;
  n?: string;
  iss?: string;
  ver?: number;
  ori?: string;
}

async function verifyExportToken(
  token: string,
  secret: string,
  expectedAudience: string,
  requestOrigin?: string,
): Promise<{ valid: boolean; payload?: ExportTokenPayload } | { valid: false }> {
  if (!token.startsWith("v2.")) {
    return { valid: false };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [, payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) {
    return { valid: false };
  }

  const expectedSignature = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(signatureB64, expectedSignature)) {
    return { valid: false };
  }

  let payload: ExportTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return { valid: false };
  }

  if (payload.aud && payload.aud !== expectedAudience) {
    return { valid: false };
  }

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false };
  }

  if (!payload.uid) {
    return { valid: false };
  }

  if (payload.ori && requestOrigin && payload.ori !== requestOrigin) {
    return { valid: false };
  }

  return { valid: true, payload };
}

// In-memory cache for public config to avoid hitting queries on every request
let publicConfigCache: { body: string; etag: string; expiresAt: number } | null =
  null;
const PUBLIC_CONFIG_TTL_MS = 60 * 1000; // 60s server-side TTL

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
        const tokenData = Buffer.from(token, "base64")
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
      let leads: any[] = [];

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

        leads = await ctx.runQuery(
          internal.leads.internal.getSearchLeadsInternal,
          {
            searchId: searchId as any,
          },
        );
      } else {
        leads = await ctx.runQuery(
          internal.leads.internal.getUserLeadsInternal,
          {
            userId: resolvedUserId as Id<"users">,
          },
        );
      }

      if (!leads || leads.length === 0) {
        return new Response("No leads found for export", {
          status: 404,
          headers: baseHeaders,
        });
      }

      // Generate CSV
      const csvHeaders = [
        "Business Name",
        "Address",
        "Phone",
        "Website",
        "Email",
        "Rating",
        "Review Count",
        "Category",
        "Status",
        "Relevance Score",
        "Notes",
        "Search ID",
        "Created At",
      ];

      const csvRows = leads.map((lead: any) => [
        `"${(lead.businessName || "").replace(/"/g, '""')}"`,
        `"${(lead.address || "").replace(/"/g, '""')}"`,
        `"${(lead.phone || "").replace(/"/g, '""')}"`,
        `"${(lead.website || "").replace(/"/g, '""')}"`,
        `"${(lead.email || "").replace(/"/g, '""')}"`,
        lead.rating || "",
        lead.reviewCount || "",
        `"${(lead.category || "").replace(/"/g, '""')}"`,
        lead.status,
        lead.relevanceScore || "",
        `"${(lead.notes || "").replace(/"/g, '""')}"`,
        lead.searchId,
        new Date(lead.createdAt).toISOString(),
      ]);

      const csvContent = [csvHeaders.join(","), ...csvRows.map((row: any) => row.join(","))].join("\n");

      return new Response(csvContent, {
        headers: {
          ...baseHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": searchId
            ? `attachment; filename="leads_${searchId}.csv"`
            : `attachment; filename="leads_${userId}.csv"`,
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
      const etag = `"${Buffer.from(responseBody).toString("base64").slice(0, 12)}"`;

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
  path: "/stripe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET is not set");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    let event: Stripe.Event;
    try {
      const body = await request.text();
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2025-07-30.basil" as any,
      });
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return new Response("Webhook signature verification failed", {
        status: 400,
      });
    }

    try {
      // Handle Stripe webhook - simplified version
      // For now, just return success - webhook handling can be implemented later
      return new Response(JSON.stringify({ received: true, type: event.type }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.error("Webhook processing failed:", error);
      return new Response("Webhook processing failed", { status: 500 });
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
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedKey =
        process.env.LANGGRAPH_API_KEY ?? process.env.API_KEY ?? undefined;
      const userAgent = request.headers.get("User-Agent");

      if (!authHeader || !expectedKey) {
        console.error("Missing authorization header or API key not configured");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (authHeader !== `Bearer ${expectedKey}`) {
        console.error("Invalid API key provided");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (userAgent && !userAgent.includes("langgraph-worker")) {
        console.warn("Unexpected user agent for LangGraph webhook:", userAgent);
      }

      const payload = (await request.json()) as unknown;

      if (!payload || typeof payload !== "object" || !("request_id" in payload)) {
        return new Response(
          JSON.stringify({ error: "Missing request_id in payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const result = await ctx.runMutation(
        internal.langgraph.webhooks.handleEmailGenerationCompleted,
        {
          payload: payload as any,
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
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedKey =
        process.env.LANGGRAPH_API_KEY ?? process.env.API_KEY ?? undefined;
      const userAgent = request.headers.get("User-Agent");

      if (!authHeader || !expectedKey) {
        console.error("Missing authorization header or API key not configured");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (authHeader !== `Bearer ${expectedKey}`) {
        console.error("Invalid API key provided");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (userAgent && !userAgent.includes("langgraph-worker")) {
        console.warn("Unexpected user agent for LangGraph webhook:", userAgent);
      }

      const payload = (await request.json()) as unknown;

      if (
        !payload ||
        typeof payload !== "object" ||
        (!("request_id" in payload) && !("lead_id" in payload))
      ) {
        return new Response(
          JSON.stringify({ error: "Missing request_id or lead_id in payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const result = await ctx.runMutation(
        internal.langgraph.webhooks.handleAnalysisCompleted,
        {
          payload: payload as any,
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
