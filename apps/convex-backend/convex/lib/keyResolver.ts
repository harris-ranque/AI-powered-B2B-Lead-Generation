import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decryptApiKey, SUPPORTED_PROVIDERS } from "../userApiKeys/mutations";

export type ProviderKeyMap = Partial<Record<(typeof SUPPORTED_PROVIDERS)[number], string>>;

export async function resolveUserKeys(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  options?: { includeInactive?: boolean }
): Promise<ProviderKeyMap> {
  const includeInactive = options?.includeInactive ?? false;

  const keys = await ctx.db
    .query("userApiKeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const providerKeys: ProviderKeyMap = {};

  for (const key of keys) {
    if (!includeInactive && (!key.isActive || !key.validated)) {
      continue;
    }

    try {
      providerKeys[key.provider as keyof ProviderKeyMap] = decryptApiKey(
        key.encryptedKey,
      );
    } catch (error) {
      console.warn("Failed to decrypt provider key", {
        provider: key.provider,
        userId: userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return providerKeys;
}
