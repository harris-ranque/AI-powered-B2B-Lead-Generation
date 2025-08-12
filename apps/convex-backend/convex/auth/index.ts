import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { auth as clerkAuth, getCurrentUser, requireAuth, requireAdmin } from "../auth";

// Re-export Clerk auth functions for backward compatibility
export const auth = clerkAuth;
export { getCurrentUser, requireAuth, requireAdmin };

// Helper function for actions to get user by Clerk ID
export const getUserByClerkId = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    return user;
  },
});

// Validate API key for external access (read-only)
export const validateApiKey = internalQuery({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    // In a real implementation, you would hash the API key
    // For now, we'll do a simple lookup
    const apiKeyRecord = await ctx.db
      .query("apiKeys")
      .filter((q) => 
        q.and(
          q.eq(q.field("keyHash"), args.apiKey), // In production, hash this
          q.eq(q.field("isActive"), true)
        )
      )
      .unique();

    if (!apiKeyRecord) {
      return null;
    }

    // Get the user associated with this API key
    // For now, we'll assume the API key belongs to a specific user
    // In a more complex system, you might have service-to-service keys
    const users = await ctx.db.query("users").collect();
    const user = users.find(u => u.email === "api@genni.com"); // Mock user for API access

    return user;
  },
});

// Update API key usage (mutation)
export const updateApiKeyUsage = internalMutation({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const apiKeyRecord = await ctx.db
      .query("apiKeys")
      .filter((q) => 
        q.and(
          q.eq(q.field("keyHash"), args.apiKey),
          q.eq(q.field("isActive"), true)
        )
      )
      .unique();

    if (apiKeyRecord) {
      await ctx.db.patch(apiKeyRecord._id, {
        lastUsed: Date.now(),
        usageCount: apiKeyRecord.usageCount + 1,
      });
    }
  },
});