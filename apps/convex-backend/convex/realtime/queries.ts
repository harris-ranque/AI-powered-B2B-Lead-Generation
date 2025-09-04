// DEPRECATED: Old database polling queries
// These have been replaced by the SSE (Server-Sent Events) system for real-time updates
// Kept for backward compatibility but should not be used in new code

import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../auth";

// ⚠️ DEPRECATED: Use SSE useStatusBroadcasts hook instead
export const getUserBroadcasts = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    includeDelivered: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Return empty - SSE system handles this now
    return [];
  },
});

// ⚠️ DEPRECATED: Use SSE useSearchBroadcasts hook instead  
export const getSearchStatusUpdates = query({
  args: {
    searchId: v.id("searches"),
  },
  handler: async (ctx, args) => {
    // Return empty - SSE system handles this now
    return [];
  },
});

// ⚠️ DEPRECATED: Use SSE connection status instead
export const getActiveNotificationsCount = query({
  args: {},
  handler: async (ctx) => {
    // Return 0 - SSE system handles this now
    return { count: 0 };
  },
});

// ⚠️ DEPRECATED: Use SSE system broadcasts instead
export const getSystemAnnouncements = query({
  args: {},
  handler: async (ctx) => {
    // Return empty - SSE system handles this now
    return [];
  },
});