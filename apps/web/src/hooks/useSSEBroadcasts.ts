import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "./useUser";
import type { Id } from "@genni/convex-types/dataModel";
import { createLogger } from "@/utils/logger";

const logger = createLogger('useSSEBroadcasts');

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
  priority?: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
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
  const [messages, setMessages] = useState<SSEBroadcastMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<SSEConnectionStatus>({
    connected: false,
    reconnecting: false,
    connectionAttempts: 0
  });
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 2000;

  // Connect to SSE endpoint
  const connect = useCallback(() => {
    if (!user?._id || eventSourceRef.current) {
      return;
    }

    const convexUrl = import.meta.env.VITE_CONVEX_URL;
    if (!convexUrl) {
      logger.error('VITE_CONVEX_URL not configured');
      return;
    }

    // Convert Convex URL to HTTP endpoint URL
    const baseUrl = convexUrl.replace('https://', 'https://').replace('.convex.cloud', '.convex.site');
    
    // Generate a simple token (for now, use user ID - this should be enhanced with proper JWT)
    const token = btoa(user._id + ':' + Date.now());
    const sseUrl = `${baseUrl}/api/events/${user._id}?token=${token}`;

    logger.info('Connecting to SSE endpoint', { url: sseUrl });

    try {
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        logger.info('SSE connection opened');
        setConnectionStatus(prev => ({
          ...prev,
          connected: true,
          reconnecting: false,
          lastConnected: Date.now(),
          error: undefined
        }));
      };

      eventSource.onmessage = (event) => {
        try {
          const message: SSEBroadcastMessage = JSON.parse(event.data);
          logger.debug('SSE message received', { type: message.type, messageId: message.messageId });

          // Handle different message types
          if (message.type === 'heartbeat') {
            // Just update connection status
            setConnectionStatus(prev => ({
              ...prev,
              lastConnected: Date.now()
            }));
            return;
          }

          if (message.type === 'connection') {
            logger.info('SSE connection confirmed');
            return;
          }

          // Add message to list (keep last 50 messages)
          setMessages(prev => {
            const newMessages = [message, ...prev].slice(0, 50);
            return newMessages;
          });

        } catch (error) {
          logger.error('Failed to parse SSE message', { error, data: event.data });
        }
      };

      eventSource.onerror = (error) => {
        logger.error('SSE connection error', error);
        setConnectionStatus(prev => ({
          ...prev,
          connected: false,
          error: 'Connection error'
        }));

        // Close current connection
        eventSource.close();
        eventSourceRef.current = null;

        // Schedule reconnect if not too many attempts
        if (connectionStatus.connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
          setConnectionStatus(prev => ({
            ...prev,
            reconnecting: true,
            connectionAttempts: prev.connectionAttempts + 1
          }));

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, RECONNECT_DELAY * Math.pow(2, connectionStatus.connectionAttempts));
        } else {
          logger.error('Max reconnection attempts reached');
          setConnectionStatus(prev => ({
            ...prev,
            reconnecting: false,
            error: 'Max reconnection attempts reached'
          }));
        }
      };

    } catch (error) {
      logger.error('Failed to create SSE connection', error);
      setConnectionStatus(prev => ({
        ...prev,
        error: 'Failed to initialize connection'
      }));
    }
  }, [user?._id, connectionStatus.connectionAttempts]);

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
      connectionAttempts: 0
    });

    logger.info('SSE connection closed');
  }, []);

  // Auto-connect when user is available
  useEffect(() => {
    if (user?._id) {
      connect();
    } else {
      disconnect();
    }

    return disconnect;
  }, [user?._id, connect, disconnect]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    disconnect();
    setConnectionStatus(prev => ({ ...prev, connectionAttempts: 0 }));
    setTimeout(() => connect(), 1000);
  }, [connect, disconnect]);

  // Filter messages by type
  const getMessagesByType = useCallback((type: string) => {
    return messages.filter(msg => msg.type === type || msg.type === `queued_${type}`);
  }, [messages]);

  // Get pipeline messages for a specific search
  const getPipelineMessages = useCallback((searchId?: Id<"searches">) => {
    return messages.filter(msg => 
      msg.type.includes('pipeline_update') && 
      (!searchId || msg.data?.searchId === searchId)
    );
  }, [messages]);

  // Get latest message of a type
  const getLatestMessage = useCallback((type: string) => {
    const filtered = getMessagesByType(type);
    return filtered.length > 0 ? filtered[0] : null;
  }, [getMessagesByType]);

  // Get urgent messages
  const urgentMessages = messages.filter(msg => 
    msg.priority === 'urgent' || msg.priority === 'critical'
  );

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Clear messages of a specific type
  const clearMessagesByType = useCallback((type: string) => {
    setMessages(prev => prev.filter(msg => msg.type !== type && msg.type !== `queued_${type}`));
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
  const currentStage = latestUpdate?.data?.stage || 'pending';
  
  return {
    messages: searchMessages,
    latestUpdate,
    currentProgress,
    currentStage,
    isConnected: connectionStatus.connected,
    hasUpdates: searchMessages.length > 0,
  };
}