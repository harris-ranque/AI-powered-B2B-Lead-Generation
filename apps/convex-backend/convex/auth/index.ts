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
    // For now, return null - API key system will be implemented later
    return null;
  },
});

// User webhook handlers for Clerk integration
export const handleUserCreated = internalMutation({
  args: { 
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create new user in database
    const userInsert: any = {
      clerkId: args.clerkId,
      email: args.email,
      credits: 100, // Welcome credits
      plan: "free" as const,
      role: "user" as const,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Only add optional fields if they exist
    if (args.name) userInsert.name = args.name;
    if (args.avatar) userInsert.avatar = args.avatar;
    
    const userId = await ctx.db.insert("users", userInsert);
    
    return userId;
  },
});

export const handleUserUpdated = internalMutation({
  args: { 
    clerkId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    
    if (user) {
      const updateData: any = {
        updatedAt: Date.now(),
      };
      
      if (args.email) updateData.email = args.email;
      if (args.name) updateData.name = args.name;
      if (args.avatar) updateData.avatar = args.avatar;
      
      await ctx.db.patch(user._id, updateData);
    }
  },
});

export const handleUserDeleted = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    
    if (user) {
      await ctx.db.delete(user._id);
    }
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