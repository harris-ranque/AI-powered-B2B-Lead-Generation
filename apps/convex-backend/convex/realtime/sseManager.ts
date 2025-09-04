import { v4 as uuidv4 } from 'uuid';

export interface BroadcastMessage {
  type: string;
  message: string;
  data?: any;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | 'critical';
  timestamp: number;
  messageId?: string;
}

interface UserConnection {
  connectionId: string;
  controller: ReadableStreamDefaultController;
  connectedAt: number;
  lastActivity: number;
}

interface QueuedMessage extends BroadcastMessage {
  messageId: string;
  queuedAt: number;
}

export class SSEConnectionManager {
  private connections: Map<string, UserConnection[]> = new Map();
  private messageQueues: Map<string, QueuedMessage[]> = new Map();
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly QUEUE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Add a new SSE connection for a user
   */
  addConnection(userId: string, controller: ReadableStreamDefaultController): string {
    const connectionId = uuidv4();
    const connection: UserConnection = {
      connectionId,
      controller,
      connectedAt: Date.now(),
      lastActivity: Date.now()
    };

    // Initialize user connections array if needed
    if (!this.connections.has(userId)) {
      this.connections.set(userId, []);
    }

    // Add connection
    this.connections.get(userId)!.push(connection);

    console.log(`SSE: User ${userId} connected (${connectionId}). Active connections: ${this.connections.get(userId)!.length}`);

    // Send any queued messages to the newly connected user
    this.replayQueuedMessages(userId, controller);

    return connectionId;
  }

  /**
   * Remove a connection (or all connections for a user)
   */
  removeConnection(userId: string, connectionId?: string): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections) return;

    if (connectionId) {
      // Remove specific connection
      const index = userConnections.findIndex(conn => conn.connectionId === connectionId);
      if (index !== -1) {
        userConnections.splice(index, 1);
        console.log(`SSE: Connection ${connectionId} removed for user ${userId}`);
      }
      
      // Clean up empty user entry
      if (userConnections.length === 0) {
        this.connections.delete(userId);
      }
    } else {
      // Remove all connections for user
      userConnections.forEach(conn => {
        try {
          conn.controller.close();
        } catch (error) {
          // Ignore close errors
        }
      });
      this.connections.delete(userId);
      console.log(`SSE: All connections removed for user ${userId}`);
    }
  }

  /**
   * Broadcast a message to a specific user
   */
  broadcast(userId: string, message: BroadcastMessage): boolean {
    const userConnections = this.connections.get(userId);
    
    if (!userConnections || userConnections.length === 0) {
      // User is offline - queue the message
      this.queueMessage(userId, message);
      return false;
    }

    // Send to all active connections for this user
    const messageText = this.formatSSEMessage(message);
    let successfulSends = 0;
    const connectionsToRemove: string[] = [];

    for (const connection of userConnections) {
      try {
        connection.controller.enqueue(new TextEncoder().encode(messageText));
        connection.lastActivity = Date.now();
        successfulSends++;
      } catch (error) {
        console.error(`SSE: Failed to send to connection ${connection.connectionId}:`, error);
        connectionsToRemove.push(connection.connectionId);
      }
    }

    // Remove failed connections
    connectionsToRemove.forEach(connectionId => {
      this.removeConnection(userId, connectionId);
    });

    console.log(`SSE: Broadcasted to user ${userId} - ${successfulSends}/${userConnections.length} successful`);
    return successfulSends > 0;
  }

  /**
   * Broadcast to multiple users
   */
  broadcastToUsers(userIds: string[], message: BroadcastMessage): void {
    userIds.forEach(userId => this.broadcast(userId, message));
  }

  /**
   * Queue a message for offline user
   */
  private queueMessage(userId: string, message: BroadcastMessage): void {
    if (!this.messageQueues.has(userId)) {
      this.messageQueues.set(userId, []);
    }

    const queue = this.messageQueues.get(userId)!;
    const queuedMessage: QueuedMessage = {
      ...message,
      messageId: message.messageId || uuidv4(),
      queuedAt: Date.now()
    };

    // Add to queue (prioritize urgent messages)
    if (message.priority === 'critical' || message.priority === 'urgent') {
      queue.unshift(queuedMessage);
    } else {
      queue.push(queuedMessage);
    }

    // Trim queue if too large
    if (queue.length > this.MAX_QUEUE_SIZE) {
      const removed = queue.splice(0, queue.length - this.MAX_QUEUE_SIZE);
      console.log(`SSE: Trimmed ${removed.length} old messages from queue for user ${userId}`);
    }

    console.log(`SSE: Queued message for offline user ${userId}. Queue size: ${queue.length}`);
  }

  /**
   * Replay queued messages when user reconnects
   */
  private replayQueuedMessages(userId: string, controller: ReadableStreamDefaultController): void {
    const queue = this.messageQueues.get(userId);
    if (!queue || queue.length === 0) return;

    console.log(`SSE: Replaying ${queue.length} queued messages for user ${userId}`);

    // Send queued messages
    for (const message of queue) {
      try {
        const messageText = this.formatSSEMessage({
          ...message,
          type: `queued_${message.type}`, // Mark as queued message
          data: {
            ...message.data,
            wasQueued: true,
            queuedAt: message.queuedAt
          }
        });
        controller.enqueue(new TextEncoder().encode(messageText));
      } catch (error) {
        console.error(`SSE: Failed to replay message ${message.messageId}:`, error);
        break; // Stop replaying if connection fails
      }
    }

    // Clear the queue after successful replay
    this.messageQueues.delete(userId);
  }

  /**
   * Format message for SSE protocol
   */
  private formatSSEMessage(message: BroadcastMessage): string {
    const data = JSON.stringify({
      ...message,
      messageId: message.messageId || uuidv4()
    });

    return `data: ${data}\n\n`;
  }

  /**
   * Cleanup expired queued messages
   */
  cleanupExpiredMessages(): void {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [userId, queue] of this.messageQueues.entries()) {
      const originalLength = queue.length;
      
      // Remove expired messages
      const filtered = queue.filter(msg => 
        (now - msg.queuedAt) < this.QUEUE_TTL
      );

      this.messageQueues.set(userId, filtered);
      const cleaned = originalLength - filtered.length;
      totalCleaned += cleaned;

      // Remove empty queues
      if (filtered.length === 0) {
        this.messageQueues.delete(userId);
      }
    }

    if (totalCleaned > 0) {
      console.log(`SSE: Cleaned up ${totalCleaned} expired messages`);
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    activeConnections: number;
    connectedUsers: number;
    queuedMessages: number;
    usersWithQueues: number;
  } {
    let activeConnections = 0;
    for (const connections of this.connections.values()) {
      activeConnections += connections.length;
    }

    let queuedMessages = 0;
    for (const queue of this.messageQueues.values()) {
      queuedMessages += queue.length;
    }

    return {
      activeConnections,
      connectedUsers: this.connections.size,
      queuedMessages,
      usersWithQueues: this.messageQueues.size
    };
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId: string): boolean {
    const connections = this.connections.get(userId);
    return connections && connections.length > 0 || false;
  }

  /**
   * Get user's queue size
   */
  getQueueSize(userId: string): number {
    const queue = this.messageQueues.get(userId);
    return queue ? queue.length : 0;
  }
}