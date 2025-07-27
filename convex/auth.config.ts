import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      // Check if user already exists
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .unique();

      if (existingUser) {
        // Update existing user
        await ctx.db.patch(existingUser._id, {
          name: args.name ?? existingUser.name,
          avatar: args.image ?? existingUser.avatar,
          updatedAt: Date.now(),
        });
        return existingUser._id;
      }

      // Create new user with default settings
      const userId = await ctx.db.insert("users", {
        email: args.email,
        name: args.name,
        avatar: args.image,
        plan: "free",
        credits: 50, // Free trial credits
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

      // Send welcome notification
      await ctx.db.insert("notifications", {
        userId,
        type: "system_alert",
        title: "Welcome to Genni!",
        message: "You've been given 50 free credits to get started. Complete your business profile to unlock the full potential of our AI-powered lead generation.",
        data: { credits: 50 },
        read: false,
        sent: false,
        createdAt: Date.now(),
      });

      return userId;
    },
  },
});