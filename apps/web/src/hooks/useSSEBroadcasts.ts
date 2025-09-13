import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useUser } from "./useUser";
import type { Id } from "@genni/convex-types/dataModel";
import { createLogger } from "@/utils/logger";

const logger = createLogger("useSSEBroadcasts");

export interface SSEBroadcastMessage {
  type: string;
  message: string;
  data?: {
    searchId?: Id<"searches">;
    stage?: string;
    progress?: number;
    title?: string;
    category?: string;
    entityType?: string;
    entityId?: string;
    wasQueued?: boolean;
    queuedAt?: number;
    [key: string]: unknown;
  };
  priority?: "low" | "normal" | "high" | "urgent" | "critical";
  timestamp: number;
  messageId?: string;
  error?: string;
}

export interface SSEConnectionStatus {
  connected: boolean;
  reconnecting: boolean;
  lastConnected?: number;
  connectionAttempts: number;
  error?: string;
}

/**
 * Real-time SSE hook for pipeline and system broadcasts
 * Replaces database polling with true real-time updates
 */
export function useSSEBroadcasts() {
  const { user } = useUser();
  const { getToken, isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const [messages, setMessages] = useState<SSEBroadcastMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<SSEConnectionStatus>(
    {
      connected: false,
      reconnecting: false,
      connectionAttempts: 0,
    },
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 2000;

  // Connect to SSE endpoint
  const connect = useCallback(async () => {
    if (!user?._id || eventSourceRef.current) {
      return;
    }

    const convexUrl = import.meta.env.VITE_CONVEX_URL;
    if (!convexUrl) {
      logger.error("VITE_CONVEX_URL not configured");
      return;
    }

    // Convert Convex URL to HTTP endpoint URL
    // Parse the URL properly to handle different environments
    let baseUrl: string;
    try {
      const url = new URL(convexUrl);
      // For Convex cloud deployments, use the .convex.site domain for HTTP endpoints
      if (url.hostname.endsWith(".convex.cloud")) {
        baseUrl = convexUrl.replace(".convex.cloud", ".convex.site");
      } else {
        // For local development or other environments, use as-is
        baseUrl = convexUrl;
      }
    } catch (e) {
      logger.error("Invalid Convex URL", { convexUrl, error: e });
      return;
    }

    // Obtain a server-signed short-lived token (Option A)
    // Use Clerk to authenticate the request to Convex HTTP endpoint
    const token = await (async () => {
      try {
        if (!clerkLoaded || !isSignedIn) {
          logger.warn("Clerk not ready or not signed in; cannot issue SSE token");
          return null;
        }
        const jwt = await getToken();
        if (!jwt) {
          logger.error("Failed to get Clerk JWT for SSE token issuance");
          return null;
        }
        const resp = await fetch(`${baseUrl}/api/sse/issue-token`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        });
        if (!resp.ok) {
          const text = await resp.text();
          logger.error("SSE token issuance failed", { status: resp.status, text });
          return null;
        }
        const json = (await resp.json()) as { token?: string };
        if (!json.token) {
          logger.error("SSE token missing in response");
          return null;
        }
        return json.token;
      } catch (e) {
        logger.error("Error issuing SSE token", { error: e });
        return null;
      }
    })();

    if (!token) {
      setConnectionStatus((prev) => ({
        ...prev,
        connected: false,
        error: "Failed to obtain SSE token",
      }));
      return;
    }
    const sseUrl = `${baseUrl}/api/events/${user._id}?token=${encodeURIComponent(token)}`;

    logger.info("Connecting to SSE endpoint", { url: sseUrl });

    try {
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        logger.info("SSE connection opened");
        setConnectionStatus((prev) => ({
          ...prev,
          connected: true,
          reconnecting: false,
          lastConnected: Date.now(),
          error: undefined,
        }));
      };

      eventSource.onmessage = (event) => {
        try {
          const message: SSEBroadcastMessage = JSON.parse(event.data);
          logger.debug("SSE message received", {
            type: message.type,
            messageId: message.messageId,
          });

          // Handle different message types
          if (message.type === "heartbeat") {
            // Just update connection status
            setConnectionStatus((prev) => ({
              ...prev,
              lastConnected: Date.now(),
            }));
            return;
          }

          if (message.type === "connection") {
            logger.info("SSE connection confirmed");
            return;
          }

          // Add message to list (keep last 50 messages)
          setMessages((prev) => {
            const newMessages = [message, ...prev].slice(0, 50);
            return newMessages;
          });
        } catch (error) {
          logger.error("Failed to parse SSE message", {
            error,
            data: event.data,
          });
        }
      };

      eventSource.onerror = (error) => {
        logger.error("SSE connection error", error);
        setConnectionStatus((prev) => ({
          ...prev,
          connected: false,
          error: "Connection error",
        }));

        // Close current connection
        eventSource.close();
        eventSourceRef.current = null;

        // Schedule reconnect if not too many attempts
        setConnectionStatus((prev) => {
          const newAttempts = prev.connectionAttempts + 1;
          if (newAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectTimeoutRef.current = setTimeout(
              () => {
                connect();
              },
              RECONNECT_DELAY * Math.pow(2, newAttempts),
            );
            return {
              ...prev,
              reconnecting: true,
              connectionAttempts: newAttempts,
            };
          }
          return {
            ...prev,
            reconnecting: false,
            connectionAttempts: newAttempts,
          };
        });
      };
    } catch (error) {
      logger.error("Failed to create SSE connection", error);
      setConnectionStatus((prev) => ({
        ...prev,
        error: "Failed to initialize connection",
      }));
    }
  }, [user?._id, clerkLoaded, getToken, isSignedIn]); // Removed connectionStatus.connectionAttempts to avoid circular dependency

  // Disconnect from SSE
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setConnectionStatus({
      connected: false,
      reconnecting: false,
      connectionAttempts: 0,
    });

    logger.info("SSE connection closed");
  }, []);

  // Auto-connect when user is available
  useEffect(() => {
    if (user?._id && clerkLoaded && isSignedIn) {
      // fire and forget
      void connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [user?._id, clerkLoaded, isSignedIn, connect, disconnect]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    disconnect();
    setConnectionStatus((prev) => ({ ...prev, connectionAttempts: 0 }));
    setTimeout(() => connect(), 1000);
  }, [connect, disconnect]);

  // Filter messages by type
  const getMessagesByType = useCallback(
    (type: string) => {
      return messages.filter(
        (msg) => msg.type === type || msg.type === `queued_${type}`,
      );
    },
    [messages],
  );

  // Get pipeline messages for a specific search
  const getPipelineMessages = useCallback(
    (searchId?: Id<"searches">) => {
      return messages.filter(
        (msg) =>
          msg.type.includes("pipeline_update") &&
          (!searchId || msg.data?.searchId === searchId),
      );
    },
    [messages],
  );

  // Get latest message of a type
  const getLatestMessage = useCallback(
    (type: string) => {
      const filtered = getMessagesByType(type);
      return filtered.length > 0 ? filtered[0] : null;
    },
    [getMessagesByType],
  );

  // Get urgent messages
  const urgentMessages = messages.filter(
    (msg) => msg.priority === "urgent" || msg.priority === "critical",
  );

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Clear messages of a specific type
  const clearMessagesByType = useCallback((type: string) => {
    setMessages((prev) =>
      prev.filter((msg) => msg.type !== type && msg.type !== `queued_${type}`),
    );
  }, []);

  return {
    // Messages
    messages,
    urgentMessages,

    // Connection
    connectionStatus,
    isConnected: connectionStatus.connected,
    isReconnecting: connectionStatus.reconnecting,

    // Actions
    reconnect,
    disconnect,
    clearMessages,
    clearMessagesByType,

    // Filtering
    getMessagesByType,
    getPipelineMessages,
    getLatestMessage,

    // Compatibility with existing useStatusBroadcasts
    broadcasts: messages,
    isLoading: false,
    hasUrgent: urgentMessages.length > 0,
  };
}

/**
 * Hook specifically for pipeline updates of a search
 */
export function useSearchSSEUpdates(searchId?: Id<"searches">) {
  const { getPipelineMessages, connectionStatus } = useSSEBroadcasts();

  const searchMessages = getPipelineMessages(searchId);
  const latestUpdate = searchMessages.length > 0 ? searchMessages[0] : null;

  // Get current progress from latest message
  const currentProgress = latestUpdate?.data?.progress || 0;
  const currentStage = latestUpdate?.data?.stage || "pending";

  return {
    messages: searchMessages,
    latestUpdate,
    currentProgress,
    currentStage,
    isConnected: connectionStatus.connected,
    hasUpdates: searchMessages.length > 0,
  };
}
