import { DatabaseWriter, mutation } from "../_generated/server";
import { v } from "convex/values";
import { mapWithConcurrency } from "../utils/async";

const MEMBERSHIP_CONCURRENCY = 64;
const CHUNK_SIZE = 300;

type SuppressionStatus = "skipped" | "no_email" | "converted";

async function getSuppression(
  db: DatabaseWriter,
  userId: string,
  placeId: string,
) {
  return db
    .query("place_suppressions")
    .withIndex("by_user_place", (q) => q.eq("userId", userId).eq("placeId", placeId))
    .unique();
}

export const filterAndMarkUnseen = mutation({
  args: {
    userId: v.string(),
    placeIds: v.array(v.string()),
  },
  handler: async (ctx, { userId, placeIds }) => {
    if (placeIds.length === 0) {
      return [] as string[];
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const rawId of placeIds) {
      const trimmed = rawId.trim();
      if (!trimmed) {
        continue;
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        deduped.push(trimmed);
      }
    }

    const unseen: string[] = [];

    for (let offset = 0; offset < deduped.length; offset += CHUNK_SIZE) {
      const slice = deduped.slice(offset, offset + CHUNK_SIZE);
      const lookups = await mapWithConcurrency(
        slice,
        MEMBERSHIP_CONCURRENCY,
        async (placeId) => ({
          placeId,
          existing: await getSuppression(ctx.db, userId, placeId),
        }),
      );

      for (const { placeId, existing } of lookups) {
        if (!existing) {
          const now = Date.now();
          try {
            await ctx.db.insert("place_suppressions", {
              userId,
              placeId,
              status: "skipped" satisfies SuppressionStatus,
              firstSeenAt: now,
            });
          } catch (error) {
            // If another concurrent request inserted the row first, treat it as seen.
            console.warn(
              `[place_suppressions] insert race for user=${userId} place=${placeId}:`,
              error,
            );
            const retryExisting = await getSuppression(ctx.db, userId, placeId);
            if (retryExisting) {
              continue;
            }
            throw error;
          }
          unseen.push(placeId);
        }
      }
    }

    return unseen;
  },
});

export const releasePendingSkips = mutation({
  args: {
    userId: v.string(),
    placeIds: v.array(v.string()),
  },
  handler: async (ctx, { userId, placeIds }) => {
    if (placeIds.length === 0) {
      return 0;
    }

    let released = 0;

    for (let offset = 0; offset < placeIds.length; offset += CHUNK_SIZE) {
      const slice = placeIds.slice(offset, offset + CHUNK_SIZE);
      const lookups = await mapWithConcurrency(
        slice,
        MEMBERSHIP_CONCURRENCY,
        async (placeId) => ({
          placeId,
          existing: await getSuppression(ctx.db, userId, placeId),
        }),
      );

      for (const { existing } of lookups) {
        if (
          existing &&
          existing.status === "skipped" &&
          existing.lastTriedAt === undefined
        ) {
          await ctx.db.delete(existing._id);
          released += 1;
        }
      }
    }

    return released;
  },
});

export const markNoEmail = mutation({
  args: {
    userId: v.string(),
    placeId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { userId, placeId, reason }) => {
    const suppression = await getSuppression(ctx.db, userId, placeId);
    const now = Date.now();

    if (suppression) {
      await ctx.db.patch(suppression._id, {
        status: "no_email" satisfies SuppressionStatus,
        lastTriedAt: now,
        reason,
      });
      return;
    }

    await ctx.db.insert("place_suppressions", {
      userId,
      placeId,
      status: "no_email" satisfies SuppressionStatus,
      firstSeenAt: now,
      lastTriedAt: now,
      reason,
    });
  },
});
