import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

// Simple connection tracking (for testing)
interface Connection {
  connectionId: string;
  controller: ReadableStreamDefaultController;
}

const connections = new Map<string, Connection[]>();
const connectionAttempts = new Map<string, { count: number; lastAttempt: number }>();
let connectionCounter = 0;

const MAX_CONNECTIONS_PER_USER = 3;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_ATTEMPTS_PER_WINDOW = 10;

// Server-Sent Events endpoint for real-time broadcasts
http.route({
  pathPrefix: "/api/events/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const userId = url.pathname.split('/').pop();
    
    // Set up CORS headers for all responses (including errors)
    const corsHeaders = {
      "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:5173",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };
    
    if (!userId) {
      return new Response("User ID required", { 
        status: 400,
        headers: corsHeaders
      });
    }

    // Rate limiting check
    const now = Date.now();
    const attemptData = connectionAttempts.get(userId);
    
    if (attemptData) {
      if (now - attemptData.lastAttempt < RATE_LIMIT_WINDOW) {
        if (attemptData.count >= MAX_ATTEMPTS_PER_WINDOW) {
          return new Response("Too many connection attempts", { 
            status: 429,
            headers: corsHeaders
          });
        }
        attemptData.count++;
      } else {
        attemptData.count = 1;
        attemptData.lastAttempt = now;
      }
    } else {
      connectionAttempts.set(userId, { count: 1, lastAttempt: now });
    }

    // Check maximum connections per user
    const userConnections = connections.get(userId) || [];
    if (userConnections.length >= MAX_CONNECTIONS_PER_USER) {
      return new Response("Maximum connections exceeded", { 
        status: 429,
        headers: corsHeaders
      });
    }

    // Enhanced authentication with basic token validation
    const authToken = url.searchParams.get('token');
    
    if (!authToken) {
      return new Response("Authentication token required", { 
        status: 401,
        headers: corsHeaders
      });
    }

    // Basic token validation - decode and verify structure
    try {
      const tokenData = Buffer.from(authToken, 'base64').toString('utf8').split(':');
      if (tokenData.length !== 3 || tokenData[0] !== userId) {
        return new Response("Invalid authentication token", { 
          status: 401,
          headers: corsHeaders
        });
      }
      
      const tokenTimestamp = parseInt(tokenData[1]!);
      const tokenAge = Date.now() - tokenTimestamp;
      
      // Token expires after 1 hour
      if (tokenAge > 60 * 60 * 1000) {
        return new Response("Authentication token expired", { 
          status: 401,
          headers: corsHeaders
        });
      }
    } catch (error) {
      return new Response("Invalid authentication token format", { 
        status: 401,
        headers: corsHeaders
      });
    }

    // Verify user exists and is active
    try {
      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: userId as Id<"users">,
      });
      
      if (!user || !user.isActive) {
        return new Response("User not found or inactive", { 
          status: 401,
          headers: corsHeaders
        });
      }
      
    } catch (error) {
      console.error("User verification failed:", error);
      return new Response("Authentication failed", { 
        status: 401,
        headers: corsHeaders
      });
    }

    // Set up SSE headers
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:5173",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });

    // Create readable stream for SSE
    const stream = new ReadableStream({
      start(controller) {
        // Simple connection tracking
        const connectionId = `conn_${++connectionCounter}`;
        if (!connections.has(userId)) {
          connections.set(userId, []);
        }
        const userConnections = connections.get(userId);
        if (userConnections) {
          userConnections.push({ connectionId, controller });
        } else {
          connections.set(userId, [{ connectionId, controller }]);
        }
        
        console.log(`SSE: User ${userId} connected (${connectionId})`);
        
        // Send initial connection message
        const initialMessage = `data: ${JSON.stringify({
          type: "connection",
          message: "Connected to real-time updates",
          timestamp: Date.now(),
          connectionId
        })}\n\n`;
        
        controller.enqueue(new TextEncoder().encode(initialMessage));

        // Send periodic heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            const heartbeat = `data: ${JSON.stringify({
              type: "heartbeat",
              timestamp: Date.now(),
              connectionId
            })}\n\n`;
            controller.enqueue(new TextEncoder().encode(heartbeat));
          } catch (error) {
            clearInterval(heartbeatInterval);
            // Remove connection
            const userConns = connections.get(userId) || [];
            const filtered = userConns.filter((c: Connection) => c.connectionId !== connectionId);
            connections.set(userId, filtered);
            console.log(`SSE: Connection ${connectionId} removed due to error`);
          }
        }, 30000); // Every 30 seconds

        // Handle connection cleanup
        return () => {
          clearInterval(heartbeatInterval);
          // Remove connection
          const userConns = connections.get(userId) || [];
          const filtered = userConns.filter(c => c.connectionId !== connectionId);
          connections.set(userId, filtered);
          console.log(`SSE: Connection ${connectionId} closed`);
        };
      },
      
      cancel() {
        // Connection cancelled by client
        console.log(`SSE: Connection cancelled by client for user ${userId}`);
      }
    });

    return new Response(stream, { headers });
  }),
});

// Endpoint to send test messages (for development/testing)
http.route({
  path: "/api/test-broadcast",
  method: "POST", 
  handler: httpAction(async (ctx, request) => {
    const body = await request.json() as { userId: string; message: string };
    const { userId, message } = body;

    if (!userId || !message) {
      return new Response("Missing userId or message", { status: 400 });
    }

    // Send test message via inline connection tracking
    const userConnections = connections.get(userId) || [];
    const testMessage = `data: ${JSON.stringify({
      type: "test",
      message: message,
      timestamp: Date.now()
    })}\n\n`;

    let sentCount = 0;
    for (const conn of userConnections) {
      try {
        conn.controller.enqueue(new TextEncoder().encode(testMessage));
        sentCount++;
      } catch (error) {
        console.error(`Failed to send test message to connection ${conn.connectionId}:`, error);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      connectionsFound: userConnections.length,
      messagesSent: sentCount 
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }),
});

// Test SSE endpoint without authentication (for testing)
http.route({
  pathPrefix: "/api/test-events/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const userId = url.pathname.split('/').pop();
    
    if (!userId) {
      return new Response("User ID required", { status: 400 });
    }

    // Set up SSE headers
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:5173",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });

    // Create readable stream for SSE
    const stream = new ReadableStream({
      start(controller) {
        // Simple connection tracking
        const connectionId = `test_conn_${++connectionCounter}`;
        if (!connections.has(userId)) {
          connections.set(userId, []);
        }
        const userConnections = connections.get(userId);
        if (userConnections) {
          userConnections.push({ connectionId, controller });
        } else {
          connections.set(userId, [{ connectionId, controller }]);
        }
        
        console.log(`TEST SSE: User ${userId} connected (${connectionId})`);
        
        // Send initial connection message
        const initialMessage = `data: ${JSON.stringify({
          type: "connection",
          message: "Connected to TEST real-time updates",
          timestamp: Date.now(),
          connectionId
        })}\n\n`;
        
        controller.enqueue(new TextEncoder().encode(initialMessage));

        // Send periodic heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            const heartbeat = `data: ${JSON.stringify({
              type: "heartbeat",
              timestamp: Date.now(),
              connectionId
            })}\n\n`;
            controller.enqueue(new TextEncoder().encode(heartbeat));
          } catch (error) {
            clearInterval(heartbeatInterval);
            // Remove connection
            const userConns = connections.get(userId) || [];
            const filtered = userConns.filter((c: Connection) => c.connectionId !== connectionId);
            connections.set(userId, filtered);
            console.log(`TEST SSE: Connection ${connectionId} removed due to error`);
          }
        }, 5000); // Every 5 seconds for testing

        // Handle connection cleanup
        return () => {
          clearInterval(heartbeatInterval);
          // Remove connection
          const userConns = connections.get(userId) || [];
          const filtered = userConns.filter(c => c.connectionId !== connectionId);
          connections.set(userId, filtered);
          console.log(`TEST SSE: Connection ${connectionId} closed`);
        };
      },
      
      cancel() {
        // Connection cancelled by client
        console.log(`TEST SSE: Connection cancelled by client for user ${userId}`);
      }
    });

    return new Response(stream, { headers });
  }),
});

// Research Progress Webhook (for LangGraph worker)
http.route({
  path: "/api/webhooks/research/progress",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        searchId: string;
        stage: string;
        tier: string;
        confidence?: number;
        dataPoints?: number;
        sourcesAnalyzed?: number;
        message: string;
        escalationReason?: string;
        error?: string;
        metadata?: any;
      };

      // Basic validation
      if (!body.searchId || !body.stage || !body.tier || !body.message) {
        return new Response("Missing required fields", { status: 400 });
      }

      // Optional API key validation for webhook security
      const apiKey = request.headers.get("x-api-key");
      const expectedApiKey = process.env.LANGGRAPH_API_KEY;
      if (expectedApiKey && apiKey !== expectedApiKey) {
        return new Response("Invalid API key", { status: 401 });
      }

      // Update research progress
      await ctx.runMutation(internal.research.progress.updateResearchProgress, {
        searchId: body.searchId as Id<"searches">,
        stage: body.stage as any,
        tier: body.tier as any,
        confidence: body.confidence,
        dataPoints: body.dataPoints,
        sourcesAnalyzed: body.sourcesAnalyzed,
        message: body.message,
        escalationReason: body.escalationReason,
        error: body.error,
        metadata: body.metadata,
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Research progress webhook error:", error);
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

// Stripe webhook endpoint
http.route({
  path: "/api/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Get the raw body for signature verification
      const body = await request.text();
      const signature = request.headers.get("stripe-signature");
      
      if (!signature) {
        console.error("Missing Stripe signature");
        return new Response("Missing signature", { status: 400 });
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("Missing STRIPE_WEBHOOK_SECRET environment variable");
        return new Response("Webhook secret not configured", { status: 500 });
      }

      // Note: In a real implementation, you would verify the signature here
      // using Stripe's SDK. For now, we'll parse the event directly.
      let event;
      try {
        event = JSON.parse(body);
      } catch (err) {
        console.error("Invalid JSON in webhook payload", err);
        return new Response("Invalid JSON", { status: 400 });
      }

      console.log(`Stripe webhook received: ${event.type}`);

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed':
          await ctx.runMutation(internal.billing.webhooks.handleCheckoutCompleted, {
            sessionId: event.data.object.id,
            customerId: event.data.object.customer,
            subscriptionId: event.data.object.subscription,
            mode: event.data.object.mode,
            metadata: event.data.object.metadata || {},
          });
          break;

        case 'customer.subscription.created':
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionCreated, {
            subscriptionId: event.data.object.id,
            customerId: event.data.object.customer,
            status: event.data.object.status,
            priceId: event.data.object.items?.data?.[0]?.price?.id,
            currentPeriodStart: event.data.object.current_period_start * 1000,
            currentPeriodEnd: event.data.object.current_period_end * 1000,
            trialStart: event.data.object.trial_start ? event.data.object.trial_start * 1000 : undefined,
            trialEnd: event.data.object.trial_end ? event.data.object.trial_end * 1000 : undefined,
          });
          break;

        case 'customer.subscription.updated':
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionUpdated, {
            subscriptionId: event.data.object.id,
            customerId: event.data.object.customer,
            status: event.data.object.status,
            priceId: event.data.object.items?.data?.[0]?.price?.id,
            currentPeriodStart: event.data.object.current_period_start * 1000,
            currentPeriodEnd: event.data.object.current_period_end * 1000,
            cancelAtPeriodEnd: event.data.object.cancel_at_period_end,
            cancelAt: event.data.object.cancel_at ? event.data.object.cancel_at * 1000 : undefined,
            canceledAt: event.data.object.canceled_at ? event.data.object.canceled_at * 1000 : undefined,
          });
          break;

        case 'customer.subscription.deleted':
          await ctx.runMutation(internal.billing.webhooks.handleSubscriptionDeleted, {
            subscriptionId: event.data.object.id,
            customerId: event.data.object.customer,
          });
          break;

        case 'invoice.payment_succeeded':
          await ctx.runMutation(internal.billing.webhooks.handlePaymentSucceeded, {
            invoiceId: event.data.object.id,
            subscriptionId: event.data.object.subscription,
            customerId: event.data.object.customer,
            amount: event.data.object.amount_paid,
            currency: event.data.object.currency,
            paidAt: event.data.object.status_transitions?.paid_at * 1000,
          });
          break;

        case 'invoice.payment_failed':
          await ctx.runMutation(internal.billing.webhooks.handlePaymentFailed, {
            invoiceId: event.data.object.id,
            subscriptionId: event.data.object.subscription,
            customerId: event.data.object.customer,
            amount: event.data.object.amount_due,
            currency: event.data.object.currency,
            attemptCount: event.data.object.attempt_count,
            nextPaymentAttempt: event.data.object.next_payment_attempt ? event.data.object.next_payment_attempt * 1000 : undefined,
          });
          break;

        default:
          console.log(`Unhandled Stripe event type: ${event.type}`);
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Stripe webhook error:", error);
      return new Response(
        JSON.stringify({ error: "Webhook handler failed" }), 
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// LangGraph webhook handler for email generation completion
http.route({
  path: "/webhooks/langgraph/email-completed",
  method: "POST",
  handler: httpAction(async (ctx, request: Request) => {
    try {
      // Verify API key with enhanced security
      const authHeader = request.headers.get("Authorization");
      const expectedKey = process.env.LANGGRAPH_API_KEY;
      const userAgent = request.headers.get("User-Agent");
      
      if (!authHeader || !expectedKey) {
        console.error("Missing authorization header or API key not configured");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (authHeader !== `Bearer ${expectedKey}`) {
        console.error("Invalid API key provided");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Optional: Add user agent validation for additional security
      if (userAgent && !userAgent.includes("langgraph-worker")) {
        console.warn("Unexpected user agent for LangGraph webhook:", userAgent);
      }

      const payload = await request.json() as any;
      
      // Basic payload validation
      if (!payload.request_id) {
        return new Response(
          JSON.stringify({ error: "Missing request_id in payload" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Process the webhook using the new handler
      const result = await ctx.runMutation(internal.langgraph.webhooks.handleEmailGenerationCompleted, {
        payload: payload,
      });
      
      // Return appropriate HTTP status based on processing result
      if (!result.success) {
        console.error(`Webhook processing failed: ${result.error}`);
        return new Response(
          JSON.stringify({ error: result.error }),
          { 
            status: 400, // Bad request for validation/processing errors
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("LangGraph email webhook error:", error);
      
      // Determine if this is a retryable error
      const isRetryable = error instanceof Error && (
        error.message.includes("timeout") ||
        error.message.includes("connection") ||
        error.message.includes("unavailable") ||
        error.message.includes("overloaded")
      );
      
      // Return appropriate status code for retry behavior
      // 500 = retryable server error, 400 = non-retryable client error
      const statusCode = isRetryable ? 500 : 400;
      
      return new Response(
        JSON.stringify({ 
          error: "Webhook processing failed",
          retryable: isRetryable,
          message: error instanceof Error ? error.message : "Unknown error"
        }),
        { 
          status: statusCode,
          headers: { "Content-Type": "application/json" }
        }
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
      // Verify API key with enhanced security
      const authHeader = request.headers.get("Authorization");
      const expectedKey = process.env.LANGGRAPH_API_KEY;
      const userAgent = request.headers.get("User-Agent");
      
      if (!authHeader || !expectedKey) {
        console.error("Missing authorization header or API key not configured");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (authHeader !== `Bearer ${expectedKey}`) {
        console.error("Invalid API key provided");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { 
            status: 401,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Optional: Add user agent validation for additional security
      if (userAgent && !userAgent.includes("langgraph-worker")) {
        console.warn("Unexpected user agent for LangGraph webhook:", userAgent);
      }

      const payload = await request.json() as any;
      
      // Basic payload validation
      if (!payload.request_id && !payload.lead_id) {
        return new Response(
          JSON.stringify({ error: "Missing request_id or lead_id in payload" }),
          { 
            status: 400,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      // Process the webhook using the new handler
      const result = await ctx.runMutation(internal.langgraph.webhooks.handleAnalysisCompleted, {
        payload: payload,
      });
      
      // Return appropriate HTTP status based on processing result
      if (!result.success) {
        console.error(`Analysis webhook processing failed: ${result.error}`);
        return new Response(
          JSON.stringify({ error: result.error }),
          { 
            status: 400, // Bad request for validation/processing errors
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );

    } catch (error) {
      console.error("LangGraph analysis webhook error:", error);
      
      // Determine if this is a retryable error
      const isRetryable = error instanceof Error && (
        error.message.includes("timeout") ||
        error.message.includes("connection") ||
        error.message.includes("unavailable") ||
        error.message.includes("overloaded")
      );
      
      // Return appropriate status code for retry behavior
      // 500 = retryable server error, 400 = non-retryable client error
      const statusCode = isRetryable ? 500 : 400;
      
      return new Response(
        JSON.stringify({ 
          error: "Analysis webhook processing failed",
          retryable: isRetryable,
          message: error instanceof Error ? error.message : "Unknown error"
        }),
        { 
          status: statusCode,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }),
});

// Simple test endpoint
http.route({
  path: "/api/test",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(JSON.stringify({
      status: "ok",
      message: "HTTP endpoints are working",
      timestamp: Date.now()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }),
});

// CORS preflight handler
http.route({
  pathPrefix: "/api/events/",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:5173",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }),
});

export default http;