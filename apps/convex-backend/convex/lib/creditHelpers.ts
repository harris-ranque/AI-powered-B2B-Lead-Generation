import { Id } from "../_generated/dataModel";

/**
 * Enterprise BYOK Credit Bypass Helper
 *
 * Determines if a user should bypass credit operations because they are an
 * enterprise user with their own validated API keys (BYOK - Bring Your Own Key).
 *
 * Enterprise users who provide all required API keys do not consume platform credits
 * since they are using their own infrastructure and API quotas.
 *
 * @param ctx - Convex context with database access
 * @param userId - User ID to check
 * @returns true if user should bypass credit operations (enterprise + all keys valid)
 */
export async function shouldBypassCredits(
  ctx: any,
  userId: Id<"users">
): Promise<boolean> {
  // Get user to check plan
  const user = await ctx.db.get(userId);
  if (!user) {
    return false;
  }

  // Only enterprise users can bypass credits
  if (user.plan !== "enterprise") {
    return false;
  }

  // Verify they have all required API keys validated and active
  const apiKeys = await ctx.db
    .query("userApiKeys")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .filter((q: any) => q.eq(q.field("isActive"), true))
    .filter((q: any) => q.eq(q.field("validated"), true))
    .collect();

  // Check for all required providers
  const hasOpenAI = apiKeys.some((key: any) => key.provider === "openai");
  const hasGoogleMaps = apiKeys.some((key: any) => key.provider === "google_maps");
  const hasFindyMail = apiKeys.some((key: any) => key.provider === "findymail");
  const hasTavily = apiKeys.some((key: any) => key.provider === "tavily");
  const hasPerplexity = apiKeys.some((key: any) => key.provider === "perplexity");

  // Only bypass credits if ALL required keys are present and validated
  const hasAllKeys = hasOpenAI && hasGoogleMaps && hasFindyMail && hasTavily && hasPerplexity;

  if (hasAllKeys) {
    console.log(`BYOK: Enterprise user ${userId} has all required API keys - bypassing credits`);
  }

  return hasAllKeys;
}
