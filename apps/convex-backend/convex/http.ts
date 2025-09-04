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
  path: "/api/events/:userId",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const userId = url.pathname.split('/').pop();
    
    if (!userId) {
      return new Response("User ID required", { status: 400 });
    }

    // Rate limiting check
    const now = Date.now();
    const attemptData = connectionAttempts.get(userId);
    
    if (attemptData) {
      if (now - attemptData.lastAttempt < RATE_LIMIT_WINDOW) {
        if (attemptData.count >= MAX_ATTEMPTS_PER_WINDOW) {
          return new Response("Too many connection attempts", { status: 429 });
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
      return new Response("Maximum connections exceeded", { status: 429 });
    }

    // Enhanced authentication with basic token validation
    const authToken = url.searchParams.get('token');
    
    if (!authToken) {
      return new Response("Authentication token required", { status: 401 });
    }

    // Basic token validation - decode and verify structure
    try {
      const tokenData = atob(authToken).split(':');
      if (tokenData.length !== 2 || tokenData[0] !== userId) {
        return new Response("Invalid authentication token", { status: 401 });
      }
      
      const tokenTimestamp = parseInt(tokenData[1]);
      const tokenAge = Date.now() - tokenTimestamp;
      
      // Token expires after 1 hour
      if (tokenAge > 60 * 60 * 1000) {
        return new Response("Authentication token expired", { status: 401 });
      }
    } catch (error) {
      return new Response("Invalid authentication token format", { status: 401 });
    }

    // Verify user exists and is active
    try {
      const user = await ctx.runQuery(internal.users.internal.getUserInternal, {
        userId: userId as Id<"users">,
      });
      
      if (!user || !user.isActive) {
        return new Response("User not found or inactive", { status: 401 });
      }
      
    } catch (error) {
      console.error("User verification failed:", error);
      return new Response("Authentication failed", { status: 401 });
    }

    // Set up SSE headers
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:3000",
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
  path: "/api/test-events/:userId",
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
      "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:3000",
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
  path: "/api/events/:userId", 
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": process.env.APP_URL || "http://localhost:3000",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }),
});

export default http;