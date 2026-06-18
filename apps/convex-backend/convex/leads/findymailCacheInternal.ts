import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import {
  FINDYMAIL_CACHE_TTL_MS,
  normalizeCacheKeyPart,
} from "../lib/prospectRanking";

export const getCachedNameSearch = internalQuery({
  args: {
    domain: v.string(),
    name: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const domain = normalizeCacheKeyPart(args.domain);
    const normalizedName = normalizeCacheKeyPart(args.name);
    const normalizedTitle = args.title
      ? normalizeCacheKeyPart(args.title)
      : undefined;

    const candidates = await ctx.db
      .query("findymailNameSearchCache")
      .withIndex("by_domain_name", (q) =>
        q.eq("domain", domain).eq("normalizedName", normalizedName),
      )
      .collect();

    const now = Date.now();
    const match = candidates.find((entry) => {
      if (entry.expiresAt <= now) {
        return false;
      }
      if (!normalizedTitle) {
        return true;
      }
      return entry.normalizedTitle === normalizedTitle;
    });

    if (!match) {
      return null;
    }

    return {
      email: match.email,
      status: match.status,
      errorMessage: match.errorMessage,
      lastCheckedAt: match.lastCheckedAt,
      expiresAt: match.expiresAt,
    };
  },
});

export const upsertCachedNameSearch = internalMutation({
  args: {
    domain: v.string(),
    name: v.string(),
    title: v.optional(v.string()),
    email: v.optional(v.string()),
    status: v.union(
      v.literal("found"),
      v.literal("not_found"),
      v.literal("error"),
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const domain = normalizeCacheKeyPart(args.domain);
    const normalizedName = normalizeCacheKeyPart(args.name);
    const normalizedTitle = args.title
      ? normalizeCacheKeyPart(args.title)
      : undefined;

    const candidates = await ctx.db
      .query("findymailNameSearchCache")
      .withIndex("by_domain_name", (q) =>
        q.eq("domain", domain).eq("normalizedName", normalizedName),
      )
      .collect();

    const existing = candidates.find((entry) => {
      if (!normalizedTitle) {
        return !entry.normalizedTitle;
      }
      return entry.normalizedTitle === normalizedTitle;
    });

    const record = {
      domain,
      normalizedName,
      normalizedTitle,
      email: args.email,
      status: args.status,
      errorMessage: args.errorMessage,
      lastCheckedAt: now,
      expiresAt: now + FINDYMAIL_CACHE_TTL_MS,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
      return { updated: true, id: existing._id };
    }

    const id = await ctx.db.insert("findymailNameSearchCache", {
      ...record,
      createdAt: now,
    });
    return { updated: false, id };
  },
});
