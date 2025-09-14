import { v } from "convex/values";
import { api } from "./_generated/api";

// Get current user from context (can return null if not authenticated)
export async function getCurrentUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  // Check if this is an action context (no direct db access)
  if (ctx.runQuery) {
    // For actions: use runQuery to call the getCurrentUserData query
    return await ctx.runQuery(api.users.queries.getCurrentUserData, {});
  }

  // For queries/mutations: use direct database access
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q: any) => q.eq("clerkId", identity.subject))
    .unique();

  return user;
}

// Require authentication (throws if not authenticated)
export async function requireAuth(ctx: any) {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

// Require admin role (throws if not admin)
export async function requireAdmin(ctx: any) {
  const user = await requireAuth(ctx);
  if (user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return user;
}

// Legacy auth export for compatibility
export const auth = {
  getUserId: async (ctx: any) => {
    const user = await getCurrentUser(ctx);
    return user?._id || null;
  },
};
