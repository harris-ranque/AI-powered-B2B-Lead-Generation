import { GenericQueryCtx, GenericMutationCtx, GenericActionCtx } from "convex/server";
import { internalMutation } from "./_generated/server";
import { DataModel } from "./_generated/dataModel";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";

type AuthContext = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>;

/**
 * Get the current authenticated user's ID from Clerk JWT
 */
export async function getUserId(ctx: AuthContext): Promise<string | null> {
  try {
    // Get the identity from Convex auth context
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) {
      return null;
    }

    // For Clerk integration, the subject contains the Clerk user ID
    // Identity object structure: { subject: "user_xxx", issuer: "https://clerk-domain", ... }
    return identity.subject;
  } catch (error) {
    console.error("Failed to get user identity:", error);
    return null;
  }
}

/**
 * Get the current authenticated user's data from our users table
 */
export async function getCurrentUser(ctx: AuthContext): Promise<Doc<"users"> | null> {
  const clerkUserId = await getUserId(ctx);
  
  if (!clerkUserId) {
    return null;
  }

  // Actions need to use runQuery instead of direct db access
  if ('runQuery' in ctx) {
    // This is an action context
    const user = await ctx.runQuery(internal.auth.index.getUserByClerkId, {
      clerkId: clerkUserId,
    });
    return user;
  } else {
    // This is a query or mutation context with direct db access
    const queryOrMutationCtx = ctx as GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;
    const user = await queryOrMutationCtx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId))
      .unique();
    return user;
  }
}

/**
 * Require authentication - throws error if not authenticated
 */
export async function requireAuth(ctx: AuthContext): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  
  if (!user) {
    throw new Error("Authentication required");
  }
  
  return user;
}

/**
 * Require admin role - throws error if not admin
 */
export async function requireAdmin(ctx: AuthContext): Promise<Doc<"users">> {
  const user = await requireAuth(ctx);
  
  if (!user || user.role !== "admin") {
    throw new Error("Admin access required");
  }
  
  return user;
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(ctx: AuthContext): Promise<boolean> {
  const userId = await getUserId(ctx);
  return userId !== null;
}

/**
 * Get user by Clerk ID
 */
export async function getUserByClerkId(ctx: AuthContext, clerkId: string): Promise<Doc<"users"> | null> {
  // Actions need to use runQuery instead of direct db access
  if ('runQuery' in ctx) {
    // This is an action context
    const user = await ctx.runQuery(internal.auth.index.getUserByClerkId, {
      clerkId: clerkId,
    });
    return user;
  } else {
    // This is a query or mutation context with direct db access
    const queryOrMutationCtx = ctx as GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;
    return await queryOrMutationCtx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
  }
}

/**
 * Get user role for authorization
 */
export async function getUserRole(ctx: AuthContext): Promise<string | null> {
  const user = await getCurrentUser(ctx);
  return user?.role || null;
}

/**
 * Check if user has sufficient credits
 */
export async function hasCredits(ctx: AuthContext, required: number): Promise<boolean> {
  const user = await getCurrentUser(ctx);
  return user ? user.credits >= required : false;
}

/**
 * Deduct credits from user account
 */
export async function deductCredits(ctx: GenericMutationCtx<DataModel>, amount: number, description: string): Promise<boolean> {
  const user = await getCurrentUser(ctx);
  
  if (!user || user.credits < amount) {
    return false;
  }

  try {
    // Use atomic transaction system for credit deduction
    await ctx.runMutation(internal.credits.transactions.createCreditTransaction, {
      userId: user._id,
      type: "usage",
      amount: -amount,
      description,
      requireMinimumBalance: true,
    });

    return true;
  } catch (error) {
    console.error(`Failed to deduct credits: ${error}`);
    return false;
  }
}

/**
 * Legacy compatibility - maintains the same interface as Convex Auth
 */
export const auth = {
  getUserId,
  isAuthenticated,
};

// Internal webhook handlers for Clerk user sync

/**
 * Handle user created from Clerk webhook
 */
export const handleUserCreated = internalMutation({
  args: {
    clerkUser: v.any(),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const { clerkUser } = args;
    
    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUser.id))
      .unique();
    
    if (existingUser) {
      console.log(`User with Clerk ID ${clerkUser.id} already exists`);
      return existingUser._id;
    }
    
    // Create new user
    const userId = await ctx.db.insert("users", {
      clerkId: clerkUser.id,
      email: clerkUser.email_addresses?.[0]?.email_address || `clerk-${clerkUser.id}@temp.local`,
      name: `${clerkUser.first_name || ""} ${clerkUser.last_name || ""}`.trim() || clerkUser.username || "User",
      avatar: clerkUser.image_url,
      plan: "free",
      credits: 50, // Starting credits
      role: "user",
      isActive: true,
      preferences: {
        emailNotifications: true,
        language: "en",
        timezone: "UTC",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    console.log(`Created user ${userId} for Clerk ID ${clerkUser.id}`);
    return userId;
  },
});

/**
 * Handle user updated from Clerk webhook
 */
export const handleUserUpdated = internalMutation({
  args: {
    clerkUser: v.any(),
  },
  handler: async (ctx, args): Promise<Id<"users">> => {
    const { clerkUser } = args;
    
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUser.id))
      .unique();
    
    if (!existingUser) {
      console.log(`User with Clerk ID ${clerkUser.id} not found, creating new user`);
      // Create new user directly instead of using internal call
      const userId = await ctx.db.insert("users", {
        clerkId: clerkUser.id,
        email: clerkUser.email_addresses?.[0]?.email_address || `clerk-${clerkUser.id}@temp.local`,
        name: `${clerkUser.first_name || ""} ${clerkUser.last_name || ""}`.trim() || clerkUser.username || "User",
        avatar: clerkUser.image_url,
        plan: "free",
        credits: 50,
        role: "user",
        isActive: true,
        preferences: {
          emailNotifications: true,
          language: "en",
          timezone: "UTC",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return userId;
    }
    
    // Update user data
    await ctx.db.patch(existingUser._id, {
      email: clerkUser.email_addresses?.[0]?.email_address || existingUser.email,
      name: `${clerkUser.first_name || ""} ${clerkUser.last_name || ""}`.trim() || clerkUser.username || existingUser.name,
      avatar: clerkUser.image_url || existingUser.avatar,
      updatedAt: Date.now(),
    });
    
    console.log(`Updated user ${existingUser._id} for Clerk ID ${clerkUser.id}`);
    return existingUser._id;
  },
});

/**
 * Handle user deleted from Clerk webhook
 */
export const handleUserDeleted = internalMutation({
  args: {
    clerkUserId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"users"> | undefined> => {
    const { clerkUserId } = args;
    
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId))
      .unique();
    
    if (!existingUser) {
      console.log(`User with Clerk ID ${clerkUserId} not found`);
      return;
    }
    
    // Mark user as inactive instead of deleting to preserve data integrity
    await ctx.db.patch(existingUser._id, {
      isActive: false,
      updatedAt: Date.now(),
    });
    
    console.log(`Deactivated user ${existingUser._id} for Clerk ID ${clerkUserId}`);
    return existingUser._id;
  },
});