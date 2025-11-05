import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

const DEFAULT_BATCH_SIZE = 100;
const CLERK_API_BASE_URL = process.env.CLERK_API_BASE_URL ?? "https://api.clerk.com/v1";

type ClerkEmailAddress = {
  id: string;
  email_address: string;
};

type ClerkUser = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  image_url?: string | null;
  updated_at?: number;
};

const buildAuthHeader = (secretKey: string) => ({
  Authorization: `Bearer ${secretKey}`,
});

function getPrimaryEmail(user: ClerkUser): ClerkEmailAddress | undefined {
  if (!user.email_addresses || user.email_addresses.length === 0) {
    return undefined;
  }

  if (user.primary_email_address_id) {
    return user.email_addresses.find(
      (email) => email.id === user.primary_email_address_id,
    );
  }

  return user.email_addresses[0];
}

export const syncClerkUsers = action({
  args: {
    migrationToken: v.string(),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sharedSecret = process.env.CLERK_SYNC_TOKEN;
    if (!sharedSecret) {
      throw new Error(
        "CLERK_SYNC_TOKEN environment variable is not configured on this deployment.",
      );
    }

    if (args.migrationToken !== sharedSecret) {
      throw new Error("Invalid migration token provided.");
    }

    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      throw new Error(
        "CLERK_SECRET_KEY environment variable is required to sync Clerk users.",
      );
    }

    const limit = Math.max(
      1,
      Math.min(args.batchSize ?? DEFAULT_BATCH_SIZE, 500),
    );

    const dryRun = args.dryRun ?? true;

    let offset = 0;
    let totalProcessed = 0;
    let created = 0;
    let updated = 0;
    let missingEmail = 0;
    let unchanged = 0;
    const errors: Array<{ clerkId: string; error: string }> = [];

    while (true) {
      const response = await fetch(
        `${CLERK_API_BASE_URL}/users?limit=${limit}&offset=${offset}`,
        {
          headers: {
            ...buildAuthHeader(clerkSecretKey),
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch Clerk users (status ${response.status}): ${errorText}`,
        );
      }

      const users: ClerkUser[] = await response.json();
      if (users.length === 0) {
        break;
      }

      for (const user of users) {
        totalProcessed += 1;

        try {
          const primaryEmail = getPrimaryEmail(user);
          if (!primaryEmail) {
            missingEmail += 1;
            continue;
          }

          const fullName = [user.first_name, user.last_name]
            .filter((part) => typeof part === "string" && part.trim())
            .join(" ")
            .trim();

          const displayName =
            fullName ||
            primaryEmail.email_address.split("@")[0] ||
            user.id;

          const existingUser = await ctx.runQuery(
            internal.users.internal.getUserByClerkIdInternal,
            { clerkId: user.id },
          );

          const baseArgs = {
            clerkId: user.id,
            email: primaryEmail.email_address,
            name: displayName,
            avatar: user.image_url ?? undefined,
          };

          if (!existingUser) {
            if (!dryRun) {
              await ctx.runMutation(
                internal.users.internal.createUserInternal,
                baseArgs,
              );
            }
            created += 1;
            continue;
          }

          const needsUpdate =
            existingUser.email !== baseArgs.email ||
            (baseArgs.name && existingUser.name !== baseArgs.name) ||
            (baseArgs.avatar && existingUser.avatar !== baseArgs.avatar);

          if (needsUpdate) {
            if (!dryRun) {
              await ctx.runMutation(
                internal.users.internal.updateUserByClerkIdInternal,
                baseArgs,
              );
            }
            updated += 1;
          } else {
            unchanged += 1;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          errors.push({
            clerkId: user.id,
            error: message,
          });
        }
      }

      if (users.length < limit) {
        break;
      }

      offset += users.length;
    }

    return {
      dryRun,
      totalProcessed,
      created,
      updated,
      missingEmail,
      unchanged,
      errors,
    };
  },
});
