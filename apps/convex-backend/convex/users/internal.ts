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

    // Create new user with default settings (no free credits)
    const userId = await ctx.db.insert("users", {
      clerkId: args.clerkId,
      email: args.email,
      name: args.name,
      avatar: args.avatar,
      role: "user",
      plan: "free",
      credits: 0, // No free credits - users must purchase
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

    // Create initial incomplete business profile
    await ctx.db.insert("businessProfiles", {
      userId,
      companyName: "",
      industry: "",
      valueProposition: "",
      services: [],
      targetMarkets: [],
      keyDifferentiators: [],
      contactInfo: {
        name: args.name,
        email: args.email,
      },
      isComplete: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create welcome notification
    await ctx.db.insert("notifications", {
      userId,
      type: "system_alert",
      title: "Welcome to Genni!",
      message: "Complete your business profile to unlock AI-powered lead generation. Purchase credits to start generating personalized outreach emails!",
      data: {},
      read: false,
      sent: false,
      createdAt: Date.now(),
    });

    console.log(`User created with profile: ${userId} (${args.email})`);
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

    // Credit consumption priority: subscription credits first, then purchased credits
    const subscriptionCredits = user.subscriptionCredits || 0;
    const purchasedCredits = user.credits || 0;
    const totalAvailable = subscriptionCredits + purchasedCredits;

    if (totalAvailable < args.amount) {
      throw new Error("Insufficient credits");
    }

    // Calculate how much to deduct from each credit pool
    const fromSubscription = Math.min(subscriptionCredits, args.amount);
    const fromPurchased = args.amount - fromSubscription;

    // New balances after deduction
    const newSubscriptionBalance = subscriptionCredits - fromSubscription;
    const newPurchasedBalance = purchasedCredits - fromPurchased;
    const newTotalBalance = newSubscriptionBalance + newPurchasedBalance;

    await ctx.db.insert("creditTransactions", {
      userId: args.userId,
      type: "usage",
      amount: args.amount,
      description: args.description,
      balanceAfter: newTotalBalance,
      relatedEntity: args.relatedEntity,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.userId, {
      credits: newPurchasedBalance,
      subscriptionCredits: newSubscriptionBalance,
      updatedAt: Date.now(),
    });

    // Update subscription credit allocation usage tracking if subscription credits were used
    if (fromSubscription > 0) {
      const activeAllocation = await ctx.db
        .query("subscriptionCreditAllocations")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", args.userId).eq("status", "active")
        )
        .first();

      if (activeAllocation) {
        await ctx.db.patch(activeAllocation._id, {
          creditsUsed: activeAllocation.creditsUsed + fromSubscription,
        });
      }
    }

    return {
      success: true,
      balance: newTotalBalance,
      breakdown: {
        fromSubscription,
        fromPurchased,
        subscriptionRemaining: newSubscriptionBalance,
        purchasedRemaining: newPurchasedBalance,
      },
    };
  },
});

// Internal query to get user by email without auth check
export const getUserByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
  },
});

// Alias for subscriptions module compatibility
export const getUserByEmail = getUserByEmailInternal;
export const getUserByClerkId = getUserByClerkIdInternal;

// Internal mutation to create user for custom subscription (no Clerk ID initially)
export const createUserForSubscription = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (existingUser) {
      console.log(`User already exists with email: ${args.email}`);
      return existingUser._id;
    }

    // Create new user without Clerk ID (will be linked when they sign up)
    const userId = await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      role: "user",
      plan: "free", // Will be updated to "custom" when subscription activates
      credits: 0,
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

    // Create initial incomplete business profile
    await ctx.db.insert("businessProfiles", {
      userId,
      companyName: "",
      industry: "",
      valueProposition: "",
      services: [],
      targetMarkets: [],
      keyDifferentiators: [],
      contactInfo: {
        name: args.name,
        email: args.email,
      },
      isComplete: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    console.log(`User created for subscription: ${userId} (${args.email})`);
    return userId;
  },
});

// Internal mutation to update Stripe customer ID on user
export const updateStripeCustomerId = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: Date.now(),
    });
    console.log(`Stripe customer ID updated for user: ${args.userId}`);
    return { success: true };
  },
});
