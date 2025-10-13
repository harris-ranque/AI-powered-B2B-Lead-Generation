import { DatabaseWriter, mutation } from "../_generated/server";
import { v } from "convex/values";

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

export const promoteLead = mutation({
  args: {
    userId: v.string(),
    placeId: v.string(),
    email: v.string(),
    domain: v.optional(v.string()),
    meta: v.any(),
  },
  handler: async (ctx, args) => {
    const { userId, placeId, email, domain, meta } = args;
    const now = Date.now();

    const existingByPlace = await ctx.db
      .query("place_leads")
      .withIndex("by_user_place", (q) => q.eq("userId", userId).eq("placeId", placeId))
      .unique();

    if (!existingByPlace) {
      const duplicateByEmail = await ctx.db
        .query("place_leads")
        .withIndex("by_user_email", (q) => q.eq("userId", userId).eq("email", email))
        .first();

      if (duplicateByEmail) {
        console.info(
          `[place_leads] Duplicate email detected for user=${userId} email=${email}, skipping insert`,
        );
      } else {
        await ctx.db.insert("place_leads", {
          userId,
          placeId,
          email,
          domain,
          source: "google_places",
          meta,
          createdAt: now,
        });
      }
    }

    const suppression = await getSuppression(ctx.db, userId, placeId);
    if (suppression) {
      await ctx.db.patch(suppression._id, {
        status: "converted" satisfies SuppressionStatus,
        lastTriedAt: now,
      });
    } else {
      await ctx.db.insert("place_suppressions", {
        userId,
        placeId,
        status: "converted" satisfies SuppressionStatus,
        firstSeenAt: now,
        lastTriedAt: now,
      });
    }
  },
});
