import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { shouldBypassCredits } from "../lib/creditHelpers";

// Internal query to get user without auth check
export const getUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Internal query to get user by Clerk ID without auth check
export const getUserByClerkIdInternal = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
  },
});

// Internal mutation to create user (for Clerk webhook)
export const createUserInternal = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (existingUser) {
      console.log(`User already exists with clerkId: ${args.clerkId}`);
      return existingUser._id;
    }

    // Create new user with default credits and settings
    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      avatar: args.avatar,
      role: "user",
      plan: "free",
      credits: 10, // Free tier starting credits
      isActive: true,
      preferences: {
        emailNotifications: true,
        language: "en",
        timezone: "UTC",
        theme: "neon-pulse",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create welcome notification
    await ctx.db.insert("notifications", {
      userId,
      type: "system_alert",
      title: "Welcome to Genni!",
      message: "You've received 10 free credits to get started. Start generating personalized emails today!",
      data: { creditsGranted: 10 },
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    console.log(`User created: ${userId} (${args.email})`);
    return userId;
  },
});

// Internal mutation to update user by Clerk ID (for Clerk webhook)
export const updateUserByClerkIdInternal = internalMutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (!user) {
      console.error(`User not found for update: ${args.clerkId}`);
      throw new Error("User not found");
    }

    const updateData: any = {
      email: args.email,
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updateData.name = args.name;
    }
    if (args.avatar !== undefined) {
      updateData.avatar = args.avatar;
    }

    await ctx.db.patch(user._id, updateData);
    console.log(`User updated: ${user._id} (${args.email})`);
    return user._id;
  },
});

// Internal mutation to delete user by Clerk ID (for Clerk webhook)
export const deleteUserByClerkIdInternal = internalMutation({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (!user) {
      console.error(`User not found for deletion: ${args.clerkId}`);
      return { success: false, message: "User not found" };
    }

    // Soft delete by deactivating the account
    await ctx.db.patch(user._id, {
      isActive: false,
      email: `deleted_${Date.now()}_${user.email}`, // Prevent email conflicts
      updatedAt: Date.now(),
    });

    console.log(`User soft-deleted: ${user._id}`);
    return { success: true, userId: user._id };
  },
});

// Internal mutation to deduct credits by userId (for scheduled/system actions)
export const deductCreditsInternal = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    description: v.string(),
    relatedEntity: v.optional(
      v.object({
        type: v.string(),
        id: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found for credit deduction");
    }

    // BYOK: Skip credit deduction for enterprise users with own API keys
    const bypassCredits = await shouldBypassCredits(ctx, args.userId);
    if (bypassCredits) {
      console.log(
        `BYOK: Skipping internal credit deduction for enterprise user ${args.userId} - ${args.description}`
      );
      return {
        success: true,
        bypassed: true,
        balance: user.credits || 0,
      };
    }

    const currentBalance = user.credits || 0;
    if (currentBalance < args.amount) {
      throw new Error("Insufficient credits");
    }

    const newBalance = currentBalance - args.amount;

    await ctx.db.insert("creditTransactions", {
      userId: args.userId,
      type: "usage",
      amount: args.amount,
      description: args.description,
      balanceAfter: newBalance,
      relatedEntity: args.relatedEntity,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.userId, {
      credits: newBalance,
      updatedAt: Date.now(),
    });

    // Optional: low-balance notification could be added here if needed

    return { success: true, balance: newBalance };
  },
});
