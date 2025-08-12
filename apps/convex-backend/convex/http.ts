import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { WEBHOOK_EVENTS, ERROR_CODES } from "./lib/constants";

const http = httpRouter();

// Clerk webhook handler for user sync
http.route({
  path: "/webhooks/clerk",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      // Get webhook secret
      const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
      
      if (!webhookSecret) {
        console.error("CLERK_WEBHOOK_SECRET environment variable not set");
        return new Response(
          JSON.stringify({ error: "Webhook secret not configured" }),
          { 
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Get Svix headers
      const svixId = request.headers.get("svix-id");
      const svixTimestamp = request.headers.get("svix-timestamp");
      const svixSignature = request.headers.get("svix-signature");

      if (!svixId || !svixTimestamp || !svixSignature) {
        console.error("Missing required Svix headers");
        return new Response(
          JSON.stringify({ error: "Missing required headers" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const payload = await request.text();
      
      // Parse the webhook payload (simplified - no signature verification for now)
      // TODO: Add proper Svix signature verification in production
      let event;
      try {
        event = JSON.parse(payload);
      } catch (err) {
        console.error("Failed to parse webhook payload:", err);
        return new Response(
          JSON.stringify({ error: "Invalid payload" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      
      // Handle different Clerk events
      switch (event.type) {
        case "user.created":
          console.log(`Processing user.created event for user ${event.data.id}`);
          await ctx.runMutation(internal.auth.handleUserCreated, {
            clerkUser: event.data,
          });
          break;

        case "user.updated":
          console.log(`Processing user.updated event for user ${event.data.id}`);
          await ctx.runMutation(internal.auth.handleUserUpdated, {
            clerkUser: event.data,
          });
          break;

        case "user.deleted":
          console.log(`Processing user.deleted event for user ${event.data.id}`);
          await ctx.runMutation(internal.auth.handleUserDeleted, {
            clerkUserId: event.data.id,
          });
          break;

        case "session.created":
          console.log(`Processing session.created event for user ${event.data.user_id}`);
          // Handle session creation if needed
          break;

        case "session.ended":
          console.log(`Processing session.ended event for user ${event.data.user_id}`);
          // Handle session end if needed
          break;

        default:
          console.log(`Unhandled Clerk event: ${event.type}`);
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("Clerk webhook error:", error);
      return new Response(
        JSON.stringify({ error: "Webhook processing failed" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async (ctx, request: Request) => {
    return new Response(
      JSON.stringify({
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          database: "operational",
          auth: "operational",
          functions: "operational",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }),
});

// CrewAI webhook handler for email generation completion
http.route({
  path: "/webhooks/crewai/email-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      // Verify API key
      const authHeader = request.headers.get("Authorization");
      const expectedKey = process.env.CREWAI_API_KEY;
      
      if (!authHeader || !expectedKey || authHeader !== `Bearer ${expectedKey}`) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const payload = await request.json() as any;
      
      // Validate payload structure
      if (!payload.request_id || !payload.status) {
        return new Response(
          JSON.stringify({ error: "Invalid payload" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Process the webhook
      await ctx.runMutation(internal.crewai.webhooks.handleEmailGenerationWebhook, {
        requestId: payload.request_id,
        status: payload.status,
        result: payload.result,
        error: payload.error,
        processingTime: payload.processing_time,
      });

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("CrewAI webhook error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// CrewAI webhook handler for lead analysis completion
http.route({
  path: "/webhooks/crewai/analysis-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      // Verify API key
      const authHeader = request.headers.get("Authorization");
      const expectedKey = process.env.CREWAI_API_KEY;
      
      if (!authHeader || !expectedKey || authHeader !== `Bearer ${expectedKey}`) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const payload = await request.json() as any;
      
      // Process the webhook
      await ctx.runMutation(internal.crewai.webhooks.handleAnalysisWebhook, {
        requestId: payload.request_id,
        leadId: payload.lead_id,
        status: payload.status,
        analysis: payload.analysis,
        error: payload.error,
        processingTime: payload.processing_time,
      });

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("CrewAI analysis webhook error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// Stripe webhook handler
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      const signature = request.headers.get("stripe-signature");
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      
      if (!signature || !webhookSecret) {
        return new Response(
          JSON.stringify({ error: "Missing signature or secret" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const body = await request.text();
      
      // Verify webhook signature (simplified - in production use Stripe's library)
      // const isValid = verifyStripeSignature(body, signature, webhookSecret);
      // if (!isValid) {
      //   return new Response("Invalid signature", { status: 400 });
      // }

      const event = JSON.parse(body);
      
      // Handle different Stripe events
      switch (event.type) {
        case WEBHOOK_EVENTS.STRIPE.CUSTOMER_SUBSCRIPTION_CREATED:
        case WEBHOOK_EVENTS.STRIPE.CUSTOMER_SUBSCRIPTION_UPDATED:
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionUpdate, {
            subscription: event.data.object,
            eventType: event.type,
          });
          break;

        case WEBHOOK_EVENTS.STRIPE.CUSTOMER_SUBSCRIPTION_DELETED:
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionCancellation, {
            subscription: event.data.object,
          });
          break;

        case WEBHOOK_EVENTS.STRIPE.INVOICE_PAYMENT_SUCCEEDED:
          await ctx.runMutation(internal.billing.webhooks.handlePaymentSuccess, {
            invoice: event.data.object,
          });
          break;

        case WEBHOOK_EVENTS.STRIPE.INVOICE_PAYMENT_FAILED:
          await ctx.runMutation(internal.billing.webhooks.handlePaymentFailure, {
            invoice: event.data.object,
          });
          break;

        default:
          console.log(`Unhandled Stripe event: ${event.type}`);
      }

      return new Response(
        JSON.stringify({ received: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("Stripe webhook error:", error);
      return new Response(
        JSON.stringify({ error: "Webhook processing failed" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// FindyMail webhook handler (for async email enrichment)
http.route({
  path: "/webhooks/findymail/enrichment-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      // Verify API key
      const authHeader = request.headers.get("Authorization");
      const expectedKey = process.env.FINDYMAIL_WEBHOOK_SECRET;
      
      if (!authHeader || !expectedKey || authHeader !== `Bearer ${expectedKey}`) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      const payload = await request.json() as any;
      
      // Process enrichment result
      await ctx.runMutation(internal.leads.enrichment.handleEnrichmentWebhook, {
        leadId: payload.lead_id,
        status: payload.status,
        data: payload.data,
        error: payload.error,
      });

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("FindyMail webhook error:", error);
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// CORS preflight handler
http.route({
  path: "/webhooks/*",
  method: "OPTIONS",
  handler: httpAction(async (ctx, request: Request) => {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

// Generic API endpoint for external integrations
http.route({
  path: "/api/leads/export",
  method: "GET",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      // Get API key from query params or headers
      const url = new URL(request.url);
      const apiKey = url.searchParams.get("api_key") || request.headers.get("X-API-Key");
      
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "API key required" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Validate API key and get user
      const user = await ctx.runQuery(internal.auth.validateApiKey, { apiKey });
      
      if (!user) {
        return new Response(
          JSON.stringify({ error: "Invalid API key" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Get search ID from query params
      const searchId = url.searchParams.get("search_id");
      const format = url.searchParams.get("format") || "json";
      
      if (!searchId) {
        return new Response(
          JSON.stringify({ error: "search_id parameter required" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Export leads
      const exportData = await ctx.runQuery(internal.leads.queries.exportLeads, {
        userId: user._id,
        searchId,
        format,
      });

      const contentType = format === "csv" ? "text/csv" : "application/json";
      const filename = `leads_${searchId}_${new Date().toISOString().split('T')[0]}.${format}`;
      
      return new Response(exportData, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Access-Control-Allow-Origin": "*",
        },
      });

    } catch (error) {
      console.error("Export API error:", error);
      return new Response(
        JSON.stringify({ error: "Export failed" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// Public API status endpoint
http.route({
  path: "/api/status",
  method: "GET",
  handler: httpAction(async (ctx, request: Request) => {
    return new Response(
      JSON.stringify({
        status: "operational",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        endpoints: {
          "/health": "System health check",
          "/webhooks/crewai/*": "CrewAI integration webhooks",
          "/webhooks/stripe": "Stripe payment webhooks",
          "/webhooks/findymail/*": "FindyMail enrichment webhooks",
          "/api/leads/export": "Lead data export API",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }),
});

export default http;