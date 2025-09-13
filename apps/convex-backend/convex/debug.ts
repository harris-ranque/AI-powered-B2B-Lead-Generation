import { query } from "./_generated/server";

// Debug query to test authentication without throwing errors
export const debugAuth = query({
  args: {},
  handler: async (ctx) => {
    try {
      // Get the identity directly from Convex auth context
      const identity = await ctx.auth.getUserIdentity();

      if (!identity) {
        return {
          status: "no_identity",
          identity: null,
          hasAuth: false,
          message: "No identity found in auth context",
        };
      }

      // Log the identity structure for debugging
      console.log("Identity received:", JSON.stringify(identity, null, 2));

      // Check if we can find the user in our database
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
        .unique();

      return {
        status: "success",
        identity: {
          subject: identity.subject,
          issuer: identity.issuer,
          tokenIdentifier: identity.tokenIdentifier,
        },
        hasAuth: true,
        userExists: !!user,
        userId: user?._id,
        message: user ? "User found in database" : "User not found in database",
      };
    } catch (error) {
      console.error("Debug auth error:", error);
      return {
        status: "error",
        identity: null,
        hasAuth: false,
        error: error instanceof Error ? error.message : String(error),
        message: "Error occurred during auth check",
      };
    }
  },
});
