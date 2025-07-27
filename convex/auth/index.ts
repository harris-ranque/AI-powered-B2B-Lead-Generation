import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Validate API key for external access
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

    // Update last used timestamp
    await ctx.db.patch(apiKeyRecord._id, {
      lastUsed: Date.now(),
      usageCount: apiKeyRecord.usageCount + 1,
    });

    // Get the user associated with this API key
    // For now, we'll assume the API key belongs to a specific user
    // In a more complex system, you might have service-to-service keys
    const users = await ctx.db.query("users").collect();
    const user = users.find(u => u.email === "api@leadeternity.com"); // Mock user for API access

    return user;
  },
});