import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import Stripe from "stripe";
import { createHmac, randomBytes } from "crypto";

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
  return randomBytes(bytes).toString("hex");
}

function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
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

  const expectedSignature = hmacSha256(secret, payloadB64);
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

type LanggraphAuthResult = { userAgent: string };

function authorizeLanggraphWebhook(
  request: Request,
): LanggraphAuthResult | Response {
  const expectedKey =
    process.env.LANGGRAPH_API_KEY ?? process.env.API_KEY ?? undefined;

  if (!expectedKey) {
    console.error("LangGraph webhook key not configured");
    return new Response(
      JSON.stringify({ error: "Webhook authentication not configured" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (authHeader !== `Bearer ${expectedKey}`) {
    console.error("Invalid LangGraph webhook API key provided");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
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
    try {
      const authResult = authorizeLanggraphWebhook(request);
      if (authResult instanceof Response) {
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

      const headerRequestId = request.headers.get("X-Request-ID");
      if (headerRequestId && headerRequestId !== requestId) {
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
    try {
      const authResult = authorizeLanggraphWebhook(request);
      if (authResult instanceof Response) {
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

      const headerRequestId = request.headers.get("X-Request-ID");
      if (headerRequestId && headerRequestId !== requestId) {
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
